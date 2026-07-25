#!/usr/bin/env node

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

async function buildViewer() {
  console.log('Building React viewer...');

  try {
    await esbuild.build({
      entryPoints: [path.join(rootDir, 'src/ui/viewer/index.tsx')],
      bundle: true,
      minify: true,
      sourcemap: false,
      target: ['es2020'],
      format: 'iife',
      outfile: path.join(rootDir, 'plugin/ui/viewer-bundle.js'),
      jsx: 'automatic',
      loader: {
        '.tsx': 'tsx',
        '.ts': 'ts'
      },
      define: {
        'process.env.NODE_ENV': '"production"'
      }
    });

    const htmlTemplate = fs.readFileSync(
      path.join(rootDir, 'src/ui/viewer-template.html'),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(rootDir, 'plugin/ui/viewer.html'),
      htmlTemplate
    );

    // No webfont to ship: the Signal identity uses system stacks, so the
    // viewer loads instantly and the plugin carries ~1 MB less.

    const srcUiDir = path.join(rootDir, 'src/ui');
    const outputUiDir = path.join(rootDir, 'plugin/ui');
    const iconFiles = fs.readdirSync(srcUiDir).filter(file => file.startsWith('icon-thick-') && file.endsWith('.svg'));
    for (const file of iconFiles) {
      fs.copyFileSync(
        path.join(srcUiDir, file),
        path.join(outputUiDir, file)
      );
    }

    console.log('✓ React viewer built successfully');
    console.log('  - plugin/ui/viewer-bundle.js');
    console.log('  - plugin/ui/viewer.html (from viewer-template.html)');
    console.log(`  - plugin/ui/icon-thick-*.svg (${iconFiles.length} icon files)`);
  } catch (error) {
    console.error('Failed to build viewer:', error);
    process.exit(1);
  }
}

buildViewer();
