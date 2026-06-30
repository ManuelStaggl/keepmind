#!/usr/bin/env node

import { build } from 'esbuild';
import fs from 'fs';

const version = JSON.parse(fs.readFileSync('package.json', 'utf-8')).version;
const outDir = 'dist/binaries';

fs.mkdirSync(outDir, { recursive: true });

const outfile = `${outDir}/worker-service-v${version}.cjs`;
console.log(`Building Node worker bundle v${version}...`);

try {
  await build({
    entryPoints: ['./src/services/worker-service.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    minify: true,
    outfile,
    // node:sqlite is a Node built-in and must never be bundled.
    external: ['node:sqlite'],
    banner: { js: '#!/usr/bin/env node' },
    logLevel: 'error',
  });
  fs.chmodSync(outfile, 0o755);
  console.log(`\nBuilt: ${outfile} (run with: node ${outfile})`);
} catch (error) {
  console.error('Failed to build worker bundle:', error.message);
  process.exit(1);
}
