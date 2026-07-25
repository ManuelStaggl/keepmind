import { EventEmitter } from 'events';
import type { PendingMessage, PendingMessageWithId } from '../worker-types.js';
import { logger } from '../../utils/logger.js';

// Just under the 5-minute Anthropic prompt-cache TTL: keeping the observer
// subprocess alive slightly longer than the old 3 min means a follow-up turn
// after a short pause pays a cache READ (~0.1x) on the accumulated conversation
// prefix instead of a full cache WRITE (~1.25x) after a cold restart (perf plan
// L2). Still well below the point where an idle process wastes meaningful RAM.
const IDLE_TIMEOUT_MS = 4.5 * 60 * 1000;

interface BufferedMessage {
  id: number;
  message: PendingMessage;
  claimed: boolean;
  enqueuedAt: number;
}

export interface DrainOptions {
  sessionDbId: number;
  signal: AbortSignal;
  onIdleTimeout?: () => void;
  idleTimeoutMs?: number;
}

/**
 * Per-session in-RAM observation buffer. This replaces the durable
 * `pending_messages` SQLite queue (and the BullMQ engine that mirrored it).
 *
 * Why in-RAM and not durable: a buffered message is one tool-use fragment fed
 * to a stateful, non-deterministic reducer (the memory agent batches N
 * tool-uses into M observations using in-memory conversation context). The old
 * durable queue persisted the fragments but threw away the reducer state, so
 * "replaying" pending rows after a crash regenerated different/duplicate
 * observations or looped forever — that was the retry storm. The Claude Code
 * transcript JSONL is the real durable source of truth, and transcript replay
 * is the recovery path. So this buffer deliberately holds work only for the
 * worker process lifetime: no 'processing' state to resurrect on restart, no
 * startup sweep, no respawn-on-pending. If the worker dies, the buffer is gone
 * and recovery is a transcript replay.
 *
 * confirm()/resetClaimed() exist only as in-process control flow within a
 * single live generator pass (drop a stored batch; re-yield a batch that
 * couldn't be stored yet because the memory session id wasn't captured). They
 * never cross a process boundary.
 */
export class SessionMessageBuffer {
  private readonly buffers = new Map<number, BufferedMessage[]>();
  private readonly events = new Map<number, EventEmitter>();
  private readonly seenToolUseIds = new Map<number, Set<string>>();
  private nextId = 1;

  constructor(private readonly onMutate?: () => void) {}

  /**
   * Append a message. Returns the assigned id, or 0 if suppressed as a
   * duplicate. Dedup matches the old partial UNIQUE(content_session_id,
   * tool_use_id) index: only observations that carry a toolUseId are deduped,
   * and only against others in the same session for this worker's lifetime.
   */
  enqueue(sessionDbId: number, message: PendingMessage): number {
    const toolUseId = message.toolUseId;
    if (toolUseId) {
      const seen = this.getSeen(sessionDbId);
      if (seen.has(toolUseId)) {
        return 0;
      }
      seen.add(toolUseId);
    }

    const id = this.nextId++;
    this.getList(sessionDbId).push({ id, message, claimed: false, enqueuedAt: Date.now() });
    this.onMutate?.();
    this.signal(sessionDbId);
    return id;
  }

  /** Remove a stored message by id. Returns 1 if found, 0 otherwise. */
  confirm(messageId: number): number {
    for (const list of this.buffers.values()) {
      const idx = list.findIndex(m => m.id === messageId);
      if (idx !== -1) {
        list.splice(idx, 1);
        this.onMutate?.();
        return 1;
      }
    }
    return 0;
  }

  /** Un-claim all messages for a session so the iterator re-yields them. */
  resetClaimed(sessionDbId: number): number {
    const list = this.buffers.get(sessionDbId);
    if (!list) return 0;
    let reset = 0;
    for (const m of list) {
      if (m.claimed) {
        m.claimed = false;
        reset++;
      }
    }
    if (reset > 0) {
      this.onMutate?.();
      this.signal(sessionDbId);
    }
    return reset;
  }

  /** Drop everything buffered for a session. */
  clear(sessionDbId: number): number {
    const cleared = this.buffers.get(sessionDbId)?.length ?? 0;
    this.buffers.delete(sessionDbId);
    // Mirror dispose(): drop the dedup set too. Otherwise a clear() not followed
    // by dispose() leaves seenToolUseIds intact, so a later enqueue carrying a
    // previously-seen toolUseId is silently suppressed (returns 0) and lost.
    this.seenToolUseIds.delete(sessionDbId);
    if (cleared > 0) {
      this.onMutate?.();
    }
    return cleared;
  }

  /** Forget a session entirely (buffer, dedup set, event emitter). */
  dispose(sessionDbId: number): void {
    this.buffers.delete(sessionDbId);
    this.seenToolUseIds.delete(sessionDbId);
    this.events.get(sessionDbId)?.removeAllListeners();
    this.events.delete(sessionDbId);
  }

  getPendingCount(sessionDbId: number): number {
    return this.buffers.get(sessionDbId)?.length ?? 0;
  }

  getTotalDepth(): number {
    let total = 0;
    for (const list of this.buffers.values()) {
      total += list.length;
    }
    return total;
  }

  peekTypes(sessionDbId: number): Array<{ message_type: string; tool_name: string | null }> {
    return (this.buffers.get(sessionDbId) ?? []).map(m => ({
      message_type: m.message.type,
      tool_name: m.message.tool_name ?? null
    }));
  }

  /**
   * Drain buffered messages as they arrive. Yields one unclaimed message at a
   * time; when the buffer is empty it waits on the per-session event emitter
   * until a new message is enqueued, the abort signal fires, or the idle
   * timeout elapses (which triggers onIdleTimeout and ends the iterator so the
   * SDK subprocess is killed).
   */
  async *drain(options: DrainOptions): AsyncIterableIterator<PendingMessageWithId> {
    const { sessionDbId, signal, onIdleTimeout, idleTimeoutMs = IDLE_TIMEOUT_MS } = options;
    let lastActivityTime = Date.now();

    while (!signal.aborted) {
      const claimed = this.claimNext(sessionDbId);
      if (claimed) {
        lastActivityTime = Date.now();
        yield {
          ...claimed.message,
          _persistentId: claimed.id,
          _originalTimestamp: claimed.enqueuedAt
        };
        continue;
      }

      const received = await this.waitForMessage(sessionDbId, signal, idleTimeoutMs);
      if (!received && !signal.aborted) {
        const idleDuration = Date.now() - lastActivityTime;
        if (idleDuration >= idleTimeoutMs) {
          logger.info('SESSION', 'Idle timeout reached, triggering abort to kill subprocess', {
            sessionDbId,
            idleDurationMs: idleDuration,
            thresholdMs: idleTimeoutMs
          });
          onIdleTimeout?.();
          return;
        }
      } else {
        lastActivityTime = Date.now();
      }
    }
  }

  private claimNext(sessionDbId: number): BufferedMessage | null {
    const list = this.buffers.get(sessionDbId);
    if (!list) return null;
    const next = list.find(m => !m.claimed);
    if (!next) return null;
    next.claimed = true;
    this.onMutate?.();
    return next;
  }

  /**
   * Claim up to `max` further unclaimed OBSERVATION messages, in buffer order,
   * for coalescing into a single compression turn (perf plan L1). Stops at the
   * first unclaimed non-observation (e.g. summarize) so ordering and the
   * summarize turn are preserved. Returns them in the same shape drain() yields;
   * callers MUST track the returned _persistentIds for confirm/reset just like
   * drained messages.
   */
  claimAdditionalObservations(sessionDbId: number, max: number): PendingMessageWithId[] {
    if (max <= 0) return [];
    const list = this.buffers.get(sessionDbId);
    if (!list) return [];
    const claimed: PendingMessageWithId[] = [];
    for (const m of list) {
      if (m.claimed) continue;
      if (m.message.type !== 'observation') break; // don't reorder past a summarize
      m.claimed = true;
      claimed.push({ ...m.message, _persistentId: m.id, _originalTimestamp: m.enqueuedAt });
      if (claimed.length >= max) break;
    }
    if (claimed.length > 0) this.onMutate?.();
    return claimed;
  }

  /** Unclaimed observations currently waiting, i.e. what a batch could still absorb. */
  getUnclaimedObservationCount(sessionDbId: number): number {
    const list = this.buffers.get(sessionDbId);
    if (!list) return 0;
    let count = 0;
    for (const m of list) {
      if (m.claimed) continue;
      if (m.message.type !== 'observation') break; // mirrors claimAdditionalObservations
      count += 1;
    }
    return count;
  }

  /**
   * Wait briefly for sibling observations to arrive before compressing.
   *
   * Batching (`claimAdditionalObservations`) can only coalesce what is ALREADY
   * buffered. Tool uses arrive one at a time — the model thinks between them —
   * and a compression turn is fast, so the buffer was almost always empty when
   * the batch was assembled: batching never engaged and every tool use paid its
   * own turn (measured: ~4.8k turns for ~3.4k tool uses in one day, ≥65% of them
   * returning "nothing worth recording" while still paying the full conversation
   * prefix). A short linger turns the same work into a handful of batched turns.
   *
   * Returns as soon as `target` unclaimed observations are waiting, or when the
   * window elapses / the generator aborts — whichever comes first.
   */
  async waitForCoalesceWindow(options: {
    sessionDbId: number;
    target: number;
    windowMs: number;
    signal: AbortSignal;
  }): Promise<number> {
    const { sessionDbId, target, windowMs, signal } = options;
    const deadline = Date.now() + windowMs;
    let waiting = this.getUnclaimedObservationCount(sessionDbId);

    while (waiting < target && !signal.aborted) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      // Event-driven: resolves on the next enqueue rather than polling.
      await this.waitForMessage(sessionDbId, signal, remaining);
      waiting = this.getUnclaimedObservationCount(sessionDbId);
    }

    return waiting;
  }

  private waitForMessage(sessionDbId: number, signal: AbortSignal, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const events = this.getEvents(sessionDbId);
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        events.off('message', onMessage);
        signal.removeEventListener('abort', onAbort);
      };

      const onMessage = () => {
        cleanup();
        resolve(true);
      };
      const onAbort = () => {
        cleanup();
        resolve(false);
      };
      const onTimeout = () => {
        cleanup();
        resolve(false);
      };

      events.once('message', onMessage);
      signal.addEventListener('abort', onAbort, { once: true });
      timeoutId = setTimeout(onTimeout, timeoutMs);
    });
  }

  private getList(sessionDbId: number): BufferedMessage[] {
    let list = this.buffers.get(sessionDbId);
    if (!list) {
      list = [];
      this.buffers.set(sessionDbId, list);
    }
    return list;
  }

  private getSeen(sessionDbId: number): Set<string> {
    let seen = this.seenToolUseIds.get(sessionDbId);
    if (!seen) {
      seen = new Set<string>();
      this.seenToolUseIds.set(sessionDbId, seen);
    }
    return seen;
  }

  private getEvents(sessionDbId: number): EventEmitter {
    let events = this.events.get(sessionDbId);
    if (!events) {
      events = new EventEmitter();
      this.events.set(sessionDbId, events);
    }
    return events;
  }

  private signal(sessionDbId: number): void {
    this.events.get(sessionDbId)?.emit('message');
  }
}
