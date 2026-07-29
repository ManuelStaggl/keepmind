import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  ensureDepsWorkspace,
  depsWorkspaceReady,
  localFileDependencies,
} from '../../src/shared/plugin-workspace.js';

let scratch = '';

/** A plugin root shaped like the one the installer and the repair paths see. */
function makeSourcePluginRoot(options: { manifest?: object; stubs?: boolean; lockfile?: boolean } = {}): string {
  const {
    manifest = {
      name: 'keepmind-plugin',
      dependencies: { 'sqlite-vec': '^0.1.9' },
      overrides: { 'onnxruntime-web': 'file:./stubs/onnxruntime-web' },
    },
    stubs = true,
    lockfile = true,
  } = options;

  const root = join(scratch, `source-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest, null, 2));
  if (lockfile) writeFileSync(join(root, 'bun.lock'), '{ "lockfileVersion": 1 }');
  if (stubs) {
    const stubDir = join(root, 'stubs', 'onnxruntime-web');
    mkdirSync(stubDir, { recursive: true });
    writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'onnxruntime-web', main: 'index.js' }));
    writeFileSync(join(stubDir, 'index.js'), 'throw new Error("stubbed out");');
  }
  return root;
}

beforeEach(() => {
  scratch = join(tmpdir(), `keepmind-workspace-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(scratch, { recursive: true });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('localFileDependencies', () => {
  it('finds the directory behind a file: override', () => {
    const source = makeSourcePluginRoot();
    expect(localFileDependencies(join(source, 'package.json'))).toEqual(['stubs']);
  });

  it('reports nothing when the manifest has no local specs', () => {
    const source = makeSourcePluginRoot({ manifest: { name: 'x', dependencies: { zod: '^4.0.0' } } });
    expect(localFileDependencies(join(source, 'package.json'))).toEqual([]);
  });

  it('collapses siblings under a shared parent to one entry', () => {
    const source = makeSourcePluginRoot({
      manifest: {
        name: 'x',
        overrides: { a: 'file:./stubs/a', b: 'file:./stubs/b' },
      },
    });
    expect(localFileDependencies(join(source, 'package.json'))).toEqual(['stubs']);
  });

  it('ignores absolute file: specs, which need no copying', () => {
    const absolute = process.platform === 'win32' ? 'file:C:/elsewhere/pkg' : 'file:/elsewhere/pkg';
    const source = makeSourcePluginRoot({ manifest: { name: 'x', overrides: { a: absolute } } });
    expect(localFileDependencies(join(source, 'package.json'))).toEqual([]);
  });
});

describe('ensureDepsWorkspace', () => {
  it('materialises manifest, lockfile and the local file: dependency', () => {
    const source = makeSourcePluginRoot();
    const target = join(scratch, 'data');

    expect(ensureDepsWorkspace(source, target)).toBe(target);
    expect(existsSync(join(target, 'package.json'))).toBe(true);
    expect(existsSync(join(target, 'bun.lock'))).toBe(true);
    // Without this file `bun install --frozen-lockfile` cannot resolve the
    // onnxruntime-web override and the whole install fails.
    expect(existsSync(join(target, 'stubs', 'onnxruntime-web', 'package.json'))).toBe(true);
    expect(readFileSync(join(target, 'stubs', 'onnxruntime-web', 'index.js'), 'utf-8')).toContain('stubbed out');
  });

  it('creates the target directory when it does not exist yet', () => {
    const source = makeSourcePluginRoot();
    const target = join(scratch, 'deep', 'nested', 'data');
    ensureDepsWorkspace(source, target);
    expect(existsSync(join(target, 'package.json'))).toBe(true);
  });

  it('is idempotent and refreshes a stale manifest', () => {
    const source = makeSourcePluginRoot();
    const target = join(scratch, 'data');
    ensureDepsWorkspace(source, target);

    // A plugin update changes the dependency set; the workspace must follow,
    // otherwise the install runs against the previous version's manifest.
    writeFileSync(
      join(source, 'package.json'),
      JSON.stringify({ name: 'keepmind-plugin', dependencies: { zod: '^4.4.3' } }),
    );
    ensureDepsWorkspace(source, target);

    const written = JSON.parse(readFileSync(join(target, 'package.json'), 'utf-8'));
    expect(written.dependencies.zod).toBe('^4.4.3');
  });

  it('fails loudly when the manifest is missing', () => {
    const source = join(scratch, 'empty');
    mkdirSync(source, { recursive: true });
    expect(() => ensureDepsWorkspace(source, join(scratch, 'data'))).toThrow(/package\.json/);
  });

  it('fails loudly when the lockfile is missing', () => {
    const source = makeSourcePluginRoot({ lockfile: false });
    expect(() => ensureDepsWorkspace(source, join(scratch, 'data'))).toThrow(/bun\.lock/);
  });

  it('fails loudly when a declared file: dependency is absent', () => {
    // This is the shipped-for-one-release failure: bun.lock pinning a file:
    // path the package never contained. It must not degrade into a confusing
    // bun error three steps later.
    const source = makeSourcePluginRoot({ stubs: false });
    expect(() => ensureDepsWorkspace(source, join(scratch, 'data'))).toThrow(/incomplete/);
  });
});

describe('depsWorkspaceReady', () => {
  it('is true only once every required input is present', () => {
    const source = makeSourcePluginRoot();
    const target = join(scratch, 'data');

    expect(depsWorkspaceReady(target)).toBe(false);
    ensureDepsWorkspace(source, target);
    expect(depsWorkspaceReady(target)).toBe(true);

    rmSync(join(target, 'stubs'), { recursive: true, force: true });
    expect(depsWorkspaceReady(target)).toBe(false);
  });

  it('is false rather than throwing on an unreadable manifest', () => {
    const target = join(scratch, 'data');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'package.json'), 'not json');
    writeFileSync(join(target, 'bun.lock'), '{}');
    expect(depsWorkspaceReady(target)).toBe(false);
  });
});
