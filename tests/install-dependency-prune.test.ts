import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeInstallMarker, isInstallCurrent, readInstallMarker } from '../src/npx-cli/install/setup-runtime.js';

// isInstallCurrent compares the marker's stored bun version against the LIVE
// `bun --version` (setup-runtime.getBunVersion). Hardcoding a bun version in the
// marker therefore made the "unchanged manifest is current" cases fail the
// moment CI's `bun-version: latest` advanced past that pin — nothing to do with
// the manifest fingerprint under test. Record whatever bun this runner actually
// has, mirroring how the source resolves it.
function currentBunVersion(): string {
  try {
    const r = spawnSync('bun', ['--version'], { encoding: 'utf-8', shell: process.platform === 'win32' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch { /* bun not on PATH — every real dev/CI runner has it */ }
  return '0.0.0-no-bun';
}
const CURRENT_BUN = currentBunVersion();

// `bun install` — including --frozen-lockfile — adds what the manifest asks for
// but never removes what it no longer asks for. Measured against a real install:
// after trimming the shipped grammars and stubbing onnxruntime-web, a fresh
// install produced 422 MB while an upgrade produced 947 MB. The install marker
// now fingerprints the declared dependency set so a change can be detected.

describe('install dependency fingerprint', () => {
  let dir: string;

  function writeManifest(deps: Record<string, string>, overrides?: Record<string, string>): void {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'fixture', version: '1.0.0', dependencies: deps, ...(overrides ? { overrides } : {}),
    }));
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'keepmind-prune-'));
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('records a dependency fingerprint in the marker', () => {
    writeManifest({ zod: '^4.0.0' });
    writeInstallMarker(dir, '3.0.0', CURRENT_BUN);

    expect(readInstallMarker(dir)?.deps).toBeTruthy();
  });

  it('considers an unchanged manifest current', () => {
    writeManifest({ zod: '^4.0.0', 'sqlite-vec': '^0.1.9' });
    writeInstallMarker(dir, '3.0.0', CURRENT_BUN);

    expect(isInstallCurrent(dir, '3.0.0')).toBe(true);
  });

  it('is not fooled by key order', () => {
    writeManifest({ zod: '^4.0.0', 'sqlite-vec': '^0.1.9' });
    writeInstallMarker(dir, '3.0.0', CURRENT_BUN);
    writeManifest({ 'sqlite-vec': '^0.1.9', zod: '^4.0.0' });

    expect(isInstallCurrent(dir, '3.0.0')).toBe(true);
  });

  it('detects a REMOVED dependency — the case bun cannot reconcile', () => {
    writeManifest({ zod: '^4.0.0', 'tree-sitter-swift': '^0.7.1' });
    writeInstallMarker(dir, '3.0.0', CURRENT_BUN);
    writeManifest({ zod: '^4.0.0' });

    expect(isInstallCurrent(dir, '3.0.0')).toBe(false);
  });

  it('detects an added dependency', () => {
    writeManifest({ zod: '^4.0.0' });
    writeInstallMarker(dir, '3.0.0', CURRENT_BUN);
    writeManifest({ zod: '^4.0.0', 'tree-sitter-c-sharp': '^0.23.5' });

    expect(isInstallCurrent(dir, '3.0.0')).toBe(false);
  });

  it('detects a changed version range', () => {
    writeManifest({ zod: '^4.0.0' });
    writeInstallMarker(dir, '3.0.0', CURRENT_BUN);
    writeManifest({ zod: '^5.0.0' });

    expect(isInstallCurrent(dir, '3.0.0')).toBe(false);
  });

  it('detects a changed override — how onnxruntime-web is stubbed out', () => {
    writeManifest({ '@huggingface/transformers': '^4.2.0' });
    writeInstallMarker(dir, '3.0.0', CURRENT_BUN);
    writeManifest({ '@huggingface/transformers': '^4.2.0' }, { 'onnxruntime-web': 'file:./stubs/onnxruntime-web' });

    expect(isInstallCurrent(dir, '3.0.0')).toBe(false);
  });

  it('treats a marker with no fingerprint as stale — contents unknown', () => {
    // Trees installed before this check cannot be trusted to match the manifest.
    writeManifest({ zod: '^4.0.0' });
    writeFileSync(join(dir, '.install-version'), JSON.stringify({ version: '3.0.0', bun: CURRENT_BUN }));

    expect(isInstallCurrent(dir, '3.0.0')).toBe(false);
  });

  it('still treats a version mismatch as stale', () => {
    writeManifest({ zod: '^4.0.0' });
    writeInstallMarker(dir, '3.0.0', CURRENT_BUN);

    expect(isInstallCurrent(dir, '3.1.0')).toBe(false);
  });

  it('treats a missing node_modules as stale regardless of the marker', () => {
    writeManifest({ zod: '^4.0.0' });
    writeInstallMarker(dir, '3.0.0', CURRENT_BUN);
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true });

    expect(isInstallCurrent(dir, '3.0.0')).toBe(false);
  });

  it('does not throw when the manifest is unreadable', () => {
    writeFileSync(join(dir, 'package.json'), '{ not json');
    expect(() => writeInstallMarker(dir, '3.0.0', CURRENT_BUN)).not.toThrow();
    expect(existsSync(join(dir, '.install-version'))).toBe(true);
  });
});
