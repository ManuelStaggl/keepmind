// SPDX-License-Identifier: Apache-2.0
//
// In-process sentence embedder (transformers.js + onnxruntime-node).
//
// Replaces the out-of-process chroma-mcp embedder. Loads an int8-quantized
// sentence model once per worker process (lazy), produces 384-dim mean-pooled +
// L2-normalized float32 embeddings, and unloads the ORT session after an idle
// window to keep the worker RSS low between bursts.
//
// The default model is multilingual — see DEFAULT_MODEL_ID for why, and for what
// that costs. Both the former all-MiniLM-L6-v2 and the current
// multilingual-e5-small are 384-dimensional, so the vec0 schema is unaffected by
// the switch; only the vectors themselves have to be rebuilt.

import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { join } from 'path';
import { DATA_DIR } from '../../shared/paths.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { logger } from '../../utils/logger.js';
import { pluginRequire } from '../../shared/plugin-node-modules.js';

export const EMBED_DIM = 384;

// Multilingual by default since 3.3.0. all-MiniLM-L6-v2 is English-only, which
// made the vector path unable to cross a language boundary: observations are
// titled and summarised in English while the questions asked of them are often
// not. Measured on one real store, same data, same meaning — "theme switch crash
// WPF" returned 6 on-point observations, "Warum stürzt die Oberfläche beim
// Wechsel des Farbschemas ab" returned 0. German queries were silently falling
// back to keyword hits.
//
// multilingual-e5-small is also 384-dimensional, so the vec0 schema
// (float[384]) is unchanged and no migration is needed — only a re-embed, which
// works for the entire existing corpus because the source text lives in SQLite.
// It costs a larger model (~120 MB int8 vs ~24 MB) and slower inference; that
// buys symmetric retrieval in both directions with no per-query translation.
const DEFAULT_MODEL_ID = 'Xenova/multilingual-e5-small';
const DEFAULT_DTYPE = 'int8';

/**
 * Whether a text is being embedded as a stored document or as a search query.
 *
 * The e5 family is trained asymmetrically and REQUIRES these prefixes; omitting
 * them measurably degrades retrieval, and — worse — mixing them (documents
 * stored with a prefix, queries sent without) puts the two sides in subtly
 * different regions of the space. Symmetric models ignore the distinction, so
 * the prefix is applied only for models that ask for it.
 */
export type EmbedKind = 'query' | 'passage';
const DEFAULT_IDLE_UNLOAD_MS = 5 * 60_000;
// Inference micro-batch. Attention memory is O(batch · heads · seqLen²), so a
// large caller batch (e.g. the backfill's 100) padded to ~256 tokens allocates
// GBs of onnxruntime scratch per run. Embedding in small micro-batches caps the
// resident tensor to O(microBatch · seqLen²) regardless of the caller's batch.
const DEFAULT_MICRO_BATCH = 16;

function setting(key: string, fallback: string): string {
  try {
    const value = SettingsDefaultsManager.get(key as never) as unknown as string | undefined;
    return value && String(value).trim() ? String(value) : fallback;
  } catch {
    return fallback;
  }
}

// transformers.js (+ onnxruntime-node) ships native .node binaries and CANNOT be
// inlined into the worker bundle — it must resolve from node_modules at runtime.
// On installs without the plugin's native deps (e.g. Bun absent / auto-install
// blocked by a corporate proxy) it is missing. A top-level `import` here crashed
// the ENTIRE worker on boot with `Cannot find module '@huggingface/transformers'`
// before any handler ran. Deferring the require to first real use lets the worker
// boot; a missing dep degrades the embedder to unavailable (semantic search falls
// back to keyword/FTS) instead of taking the daemon down.
// Resolved through plugin-node-modules rather than a bundle-relative
// createRequire: the tree now lives in the plugin data directory, which survives
// the host restoring the plugin root from git.
type TransformersModule = {
  pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<unknown>;
  env: Record<string, unknown>;
};
let transformersModule: TransformersModule | null = null;
function loadTransformers(): TransformersModule {
  if (transformersModule) return transformersModule;
  const mod = pluginRequire<TransformersModule>('@huggingface/transformers');
  // Cache the model on disk under our data dir so it downloads once (not under
  // node_modules/.cache) and is served offline after. Configured here at first
  // real use rather than at module load.
  mod.env.cacheDir = join(DATA_DIR, 'vector-db', 'models');
  mod.env.allowRemoteModels = true;
  transformersModule = mod;
  return mod;
}

export class EmbedderService {
  private static _instance: EmbedderService | null = null;
  static instance(): EmbedderService {
    return (this._instance ??= new EmbedderService());
  }

  private readonly modelId = setting('KEEPMIND_EMBED_MODEL', DEFAULT_MODEL_ID);
  private readonly dtype = setting('KEEPMIND_EMBED_DTYPE', DEFAULT_DTYPE);
  private readonly idleUnloadMs = (() => {
    const raw = Number(setting('KEEPMIND_EMBED_IDLE_MS', String(DEFAULT_IDLE_UNLOAD_MS)));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_UNLOAD_MS;
  })();
  private readonly microBatch = (() => {
    const raw = Number(setting('KEEPMIND_EMBED_BATCH', String(DEFAULT_MICRO_BATCH)));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MICRO_BATCH;
  })();

  private pipe: FeatureExtractionPipeline | null = null;
  private loading: Promise<FeatureExtractionPipeline> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  // Serializes all inference so at most one padded batch tensor is resident at a
  // time — even when concurrent callers (backfill projects, a live query) embed
  // at once through this process singleton.
  private inferenceChain: Promise<unknown> = Promise.resolve();

  // Derived from the model id rather than exposed as its own setting: a separate
  // switch could drift out of sync with the model, and a prefix applied to the
  // wrong model is silent — it just retrieves worse.
  private readonly needsPrefix = /(^|[/-])e5([-/]|$)/i.test(this.modelId);

  /**
   * Identifies the vector space this embedder produces. Stored alongside the
   * index so a model change is DETECTED instead of silently mixing two spaces —
   * which looks exactly like "search suddenly finds nothing".
   */
  identity(): string {
    return `${this.modelId}|${this.dtype}|${EMBED_DIM}`;
  }

  /** True when the ORT session is currently resident (model loaded). */
  isWarm(): boolean {
    return this.pipe !== null;
  }

  private decorate(texts: string[], kind: EmbedKind): string[] {
    if (!this.needsPrefix) return texts;
    const prefix = kind === 'query' ? 'query: ' : 'passage: ';
    return texts.map((t) => prefix + t);
  }

  private async getPipe(): Promise<FeatureExtractionPipeline> {
    if (this.pipe) return this.pipe;
    if (this.loading) return this.loading;
    // Lazy-require the native transformers module (see loadTransformers above).
    // A missing dep throws here and is handled by warmup()/embed() callers, which
    // degrade to keyword search rather than crash the worker.
    const { pipeline } = loadTransformers();
    const t0 = Date.now();
    this.loading = pipeline('feature-extraction', this.modelId, { dtype: this.dtype as never })
      .then((p) => {
        this.pipe = p as FeatureExtractionPipeline;
        this.loading = null;
        logger.info('EMBEDDER', 'Embedding pipeline ready', {
          model: this.modelId,
          dtype: this.dtype,
          ms: Date.now() - t0,
        });
        return this.pipe;
      })
      .catch((e) => {
        this.loading = null;
        logger.error('EMBEDDER', 'Pipeline load failed', { model: this.modelId, dtype: this.dtype }, e as Error);
        throw e;
      });
    return this.loading;
  }

  /**
   * Eagerly load the pipeline (e.g. at worker boot for health). Best-effort:
   * swallows errors so a download hiccup never blocks startup — the next
   * embed() retries.
   */
  async warmup(): Promise<void> {
    try {
      await this.getPipe();
      this.touchIdle();
    } catch {
      /* best-effort */
    }
  }

  /**
   * Embed one or many strings → Float32Array[] of length 384 (mean-pooled,
   * L2-normalized).
   *
   * `kind` defaults to 'passage' because every stored document goes through
   * here; search paths must pass 'query' explicitly.
   */
  async embed(texts: string | string[], kind: EmbedKind = 'passage'): Promise<Float32Array[]> {
    const raw = Array.isArray(texts) ? texts : [texts];
    if (raw.length === 0) return [];
    const list = this.decorate(raw, kind);

    const run = async (): Promise<Float32Array[]> => {
      const pipe = await this.getPipe();
      this.touchIdle();
      const rows: Float32Array[] = [];
      // Split into micro-batches so the padded attention tensor stays small
      // (peak RAM ∝ microBatch · seqLen², not list.length · seqLen²).
      for (let i = 0; i < list.length; i += this.microBatch) {
        const sub = list.slice(i, i + this.microBatch);
        const out = await pipe(sub, { pooling: 'mean', normalize: true });
        const data = out.data as Float32Array;
        for (let j = 0; j < sub.length; j++) {
          // Copy each row out of the shared backing buffer so callers own a
          // standalone Float32Array (slice() copies; subarray() would alias).
          rows.push(data.slice(j * EMBED_DIM, (j + 1) * EMBED_DIM));
        }
        // Release the transformers.js tensor's backing buffer between micro-
        // batches so onnxruntime scratch does not accumulate across the loop.
        (out as unknown as { dispose?: () => void }).dispose?.();
      }
      return rows;
    };

    // Chain onto the serialization queue: run only after the previous inference
    // settles, and let the next caller wait on this one.
    const result = this.inferenceChain.then(run, run);
    this.inferenceChain = result.then(() => undefined, () => undefined);
    return result;
  }

  async embedOne(text: string, kind: EmbedKind = 'passage'): Promise<Float32Array> {
    return (await this.embed([text], kind))[0];
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { void this.unload(); }, this.idleUnloadMs);
    this.idleTimer.unref?.();
  }

  /** Free the ORT session + model RAM. The pipeline rebuilds (warm) on next embed. */
  async unload(): Promise<void> {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const p = this.pipe;
    this.pipe = null;
    try {
      await (p as unknown as { dispose?: () => Promise<void> })?.dispose?.();
      logger.debug('EMBEDDER', 'Pipeline unloaded (idle)', {});
    } catch (e) {
      logger.debug('EMBEDDER', 'dispose failed (best-effort)', {}, e as Error);
    }
  }
}
