// SPDX-License-Identifier: Apache-2.0
//
// Single source for the Phase 4 "Memory Quality" config block. Read from the
// claude-mem settings.json under a `memoryQuality` key (nested object — distinct
// from the flat string settings handled by SettingsDefaultsManager). Every field
// is defaulted so a missing/partial block still yields a complete config.
//
// Defaults are chosen so behavior is unchanged after each step's merge until a
// feature is explicitly enabled — EXCEPT redaction and importance/budget, which
// are safe to default-on.

import { readFileSync, existsSync } from 'fs';
import { paths } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';

export interface MemoryQualityConfig {
  redactSecrets: { enabled: boolean; entropyThreshold: number; entropySweep: boolean };
  scoping: { enabled: boolean; includeGlobal: boolean; defaultSearchScope: 'project' | 'all' | 'global' };
  importance: { enabled: boolean; halfLifeDays: number; llmRefine: boolean };
  injection: { tokenBudget: number; candidateMultiplier: number };
  reconcile: {
    enabled: boolean; noopThreshold: number; updateBand: number;
    llmAdjudicate: boolean; allowHardDelete: boolean;
  };
  supersession: { enabled: boolean };
  expiry: { enabled: boolean; ttlDays: number; importanceFloor: number; hardDelete: boolean };
  optimizer: { enabled: boolean; tickMinutes: number; vacuumHours: number };
}

export const MEMORY_QUALITY_DEFAULTS: MemoryQualityConfig = {
  redactSecrets: { enabled: true, entropyThreshold: 4.0, entropySweep: true },
  scoping: { enabled: true, includeGlobal: true, defaultSearchScope: 'project' },
  importance: { enabled: true, halfLifeDays: 14, llmRefine: false },
  // tokenBudget is charged against the RENDERED headline size (see budget.ts), not
  // the full stored record. 4000 was set when it was charged against stored size,
  // where it admitted only ~11 of 439 candidates. Measured against rendered size:
  // 1500 admits the full 50-row cap at ~1.8k real tokens, 1000 admits ~30 rows at
  // ~1.2k. 1000 is the better trade — rows are ranked by importance x recency, so
  // the tail is the least useful part, and this is a fixed cost on every session
  // start. Still ~3x the coverage of the old accounting for ~30% more tokens.
  injection: { tokenBudget: 1000, candidateMultiplier: 3 },
  reconcile: {
    enabled: false, noopThreshold: 0.92, updateBand: 0.75,
    llmAdjudicate: false, allowHardDelete: false,
  },
  supersession: { enabled: false },
  expiry: { enabled: false, ttlDays: 28, importanceFloor: 7, hardDelete: false },
  optimizer: { enabled: true, tickMinutes: 5, vacuumHours: 24 },
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Shallow-merge a partial section over its defaults, keeping only known keys' types. */
function mergeSection<T extends Record<string, unknown>>(def: T, raw: unknown): T {
  if (!isObj(raw)) return { ...def };
  const out: Record<string, unknown> = { ...def };
  for (const k of Object.keys(def)) {
    if (raw[k] !== undefined && typeof raw[k] === typeof def[k]) {
      out[k] = raw[k];
    }
  }
  return out as T;
}

let cached: MemoryQualityConfig | null = null;

/**
 * Load the memoryQuality config (cached after first read). Env overrides:
 *   CLAUDE_MEM_REDACT_SECRETS=0  -> redactSecrets.enabled = false
 */
export function loadMemoryQualityConfig(force = false): MemoryQualityConfig {
  if (cached && !force) return cached;

  const def = MEMORY_QUALITY_DEFAULTS;
  let raw: Record<string, unknown> | undefined;
  try {
    const settingsPath = paths.settings();
    if (existsSync(settingsPath)) {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8').replace(/^﻿/, ''));
      const block = isObj(parsed) ? (parsed.memoryQuality ?? (isObj(parsed.env) ? parsed.env.memoryQuality : undefined)) : undefined;
      if (isObj(block)) raw = block;
    }
  } catch (error) {
    logger.debug('CONFIG', 'memoryQuality config load failed; using defaults', {}, error instanceof Error ? error : new Error(String(error)));
  }

  const cfg: MemoryQualityConfig = {
    redactSecrets: mergeSection(def.redactSecrets, raw?.redactSecrets),
    scoping: mergeSection(def.scoping, raw?.scoping),
    importance: mergeSection(def.importance, raw?.importance),
    injection: mergeSection(def.injection, raw?.injection),
    reconcile: mergeSection(def.reconcile, raw?.reconcile),
    supersession: mergeSection(def.supersession, raw?.supersession),
    expiry: mergeSection(def.expiry, raw?.expiry),
    optimizer: mergeSection(def.optimizer, raw?.optimizer),
  };

  // Env kill-switch for redaction (emergency disable, highest precedence).
  const redactEnv = process.env.CLAUDE_MEM_REDACT_SECRETS;
  if (redactEnv === '0' || redactEnv === 'false') {
    cfg.redactSecrets.enabled = false;
  }

  cached = cfg;
  return cfg;
}

/** Test/optimizer hook to drop the cache after a settings change. */
export function resetMemoryQualityConfigCache(): void {
  cached = null;
}
