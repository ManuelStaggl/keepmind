// SPDX-License-Identifier: Apache-2.0
//
// In-process sentence embedder (transformers.js + onnxruntime-node).
//
// Replaces the out-of-process chroma-mcp embedder. Loads the int8-quantized
// all-MiniLM-L6-v2 model once per worker process (lazy), produces 384-dim
// mean-pooled + L2-normalized float32 embeddings, and unloads the ORT session
// after an idle window to keep the worker RSS low between bursts.
//
// Proven on win32-x64 (Node 24): Xenova/all-MiniLM-L6-v2 + dtype:'int8'
// resolves the canonical quantized model (~23.7 MB on disk), cold-load ~2 s,
// per-embed ~15-20 ms, output length 384, L2 norm ≈ 1.0.

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { join } from 'path';
import { DATA_DIR } from '../../shared/paths.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { logger } from '../../utils/logger.js';

export const EMBED_DIM = 384;

const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_DTYPE = 'int8';
const DEFAULT_IDLE_UNLOAD_MS = 5 * 60_000;

function setting(key: string, fallback: string): string {
  try {
    const value = SettingsDefaultsManager.get(key as never) as unknown as string | undefined;
    return value && String(value).trim() ? String(value) : fallback;
  } catch {
    return fallback;
  }
}

// transformers.js global env — cache the model on disk under our data dir so it
// downloads once (not under node_modules/.cache) and is served offline after.
env.cacheDir = join(DATA_DIR, 'vector-db', 'models');
env.allowRemoteModels = true;

export class EmbedderService {
  private static _instance: EmbedderService | null = null;
  static instance(): EmbedderService {
    return (this._instance ??= new EmbedderService());
  }

  private readonly modelId = setting('CLAUDE_MEM_EMBED_MODEL', DEFAULT_MODEL_ID);
  private readonly dtype = setting('CLAUDE_MEM_EMBED_DTYPE', DEFAULT_DTYPE);
  private readonly idleUnloadMs = (() => {
    const raw = Number(setting('CLAUDE_MEM_EMBED_IDLE_MS', String(DEFAULT_IDLE_UNLOAD_MS)));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_UNLOAD_MS;
  })();

  private pipe: FeatureExtractionPipeline | null = null;
  private loading: Promise<FeatureExtractionPipeline> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  /** True when the ORT session is currently resident (model loaded). */
  isWarm(): boolean {
    return this.pipe !== null;
  }

  private async getPipe(): Promise<FeatureExtractionPipeline> {
    if (this.pipe) return this.pipe;
    if (this.loading) return this.loading;
    const t0 = Date.now();
    this.loading = pipeline('feature-extraction', this.modelId, { dtype: this.dtype as never })
      .then((p) => {
        this.pipe = p as FeatureExtractionPipeline;
        this.loading = null;
        logger.info('EMBEDDER', 'MiniLM pipeline ready', {
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

  /** Embed one or many strings → Float32Array[] of length 384 (mean-pooled, L2-normalized). */
  async embed(texts: string | string[]): Promise<Float32Array[]> {
    const list = Array.isArray(texts) ? texts : [texts];
    if (list.length === 0) return [];
    const pipe = await this.getPipe();
    this.touchIdle();
    const out = await pipe(list, { pooling: 'mean', normalize: true });
    const data = out.data as Float32Array;
    const rows: Float32Array[] = [];
    for (let i = 0; i < list.length; i++) {
      // Copy each row out of the shared backing buffer so callers own a
      // standalone Float32Array (slice() copies; subarray() would alias).
      rows.push(data.slice(i * EMBED_DIM, (i + 1) * EMBED_DIM));
    }
    return rows;
  }

  async embedOne(text: string): Promise<Float32Array> {
    return (await this.embed([text]))[0];
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
