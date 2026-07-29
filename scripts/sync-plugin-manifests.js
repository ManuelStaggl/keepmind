#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const packageJsonPath = path.join(rootDir, 'package.json');
const codexPluginPath = path.join(rootDir, '.codex-plugin', 'plugin.json');
const bundledCodexPluginPath = path.join(rootDir, 'plugin', '.codex-plugin', 'plugin.json');
const claudePluginPath = path.join(rootDir, '.claude-plugin', 'plugin.json');
const bundledClaudePluginPath = path.join(rootDir, 'plugin', '.claude-plugin', 'plugin.json');
const extrasPluginPath = path.join(rootDir, 'plugin-extras', '.claude-plugin', 'plugin.json');
const marketplacePath = path.join(rootDir, '.claude-plugin', 'marketplace.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function syncCodexPlugin(plugin, pkg) {
  const author =
    typeof plugin.author === 'object' && plugin.author ? plugin.author : {};

  return {
    ...plugin,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    homepage: pkg.homepage,
    repository: normalizeRepositoryUrl(pkg.repository),
    license: pkg.license,
    keywords: pkg.keywords,
    author: {
      ...author,
      name: normalizeAuthorName(pkg.author),
    },
    interface: {
      ...plugin.interface,
      developerName: normalizeAuthorName(pkg.author),
      websiteURL: normalizeRepositoryUrl(pkg.repository),
    },
  };
}

function syncClaudePlugin(plugin, pkg) {
  return {
    ...plugin,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    homepage: pkg.homepage,
    repository: normalizeRepositoryUrl(pkg.repository),
    license: pkg.license,
    keywords: pkg.keywords,
    author: {
      ...(typeof plugin.author === 'object' && plugin.author ? plugin.author : {}),
      name: normalizeAuthorName(pkg.author),
    },
  };
}

/**
 * keepmind-extras is a SEPARATE plugin in the same marketplace: it ships the
 * optional workflow skills so their frontmatter descriptions do not sit resident
 * in every session that only wants the memory system.
 *
 * Unlike syncClaudePlugin it must NOT take `name`, `description` or `keywords`
 * from package.json — those belong to the core plugin, and a plugin is keyed by
 * name (renaming it would orphan every existing install). Only the version and
 * the shared provenance fields track the release.
 */
function syncExtrasPlugin(plugin, pkg) {
  return {
    ...plugin,
    version: pkg.version,
    homepage: pkg.homepage,
    repository: normalizeRepositoryUrl(pkg.repository),
    license: pkg.license,
    author: {
      ...(typeof plugin.author === 'object' && plugin.author ? plugin.author : {}),
      name: normalizeAuthorName(pkg.author),
    },
  };
}

/** Keep every marketplace entry's version in step with package.json. */
function syncMarketplace(marketplace, pkg) {
  return {
    ...marketplace,
    plugins: (marketplace.plugins ?? []).map((entry) => ({ ...entry, version: pkg.version })),
  };
}

function normalizeAuthorName(author) {
  if (typeof author === 'string') return author;
  if (author && typeof author === 'object' && typeof author.name === 'string') return author.name;
  return '';
}

function normalizeRepositoryUrl(repository) {
  // package.json's repository.url follows the npm convention (git+https://…​.git),
  // but plugin manifests and the Codex websiteURL want a plain browsable URL.
  // Strip the npm `git+` prefix and the `.git` suffix so a browser can open it.
  const clean = (url) => url.replace(/^git\+/, '').replace(/\.git$/, '');
  if (typeof repository === 'string') return clean(repository);
  if (repository && typeof repository === 'object' && typeof repository.url === 'string')
    return clean(repository.url);
  return '';
}

function main() {
  for (const filePath of [packageJsonPath, codexPluginPath, bundledCodexPluginPath, claudePluginPath, bundledClaudePluginPath, extrasPluginPath, marketplacePath]) {
    if (!fs.existsSync(filePath)) {
      console.error(`Missing required file: ${filePath}`);
      process.exit(1);
    }
  }

  const pkg = readJson(packageJsonPath);
  const codexPlugin = readJson(codexPluginPath);
  const bundledCodexPlugin = readJson(bundledCodexPluginPath);
  const claudePlugin = readJson(claudePluginPath);
  const bundledClaudePlugin = readJson(bundledClaudePluginPath);

  writeJson(codexPluginPath, syncCodexPlugin(codexPlugin, pkg));
  writeJson(bundledCodexPluginPath, syncCodexPlugin(bundledCodexPlugin, pkg));
  writeJson(claudePluginPath, syncClaudePlugin(claudePlugin, pkg));
  writeJson(bundledClaudePluginPath, syncClaudePlugin(bundledClaudePlugin, pkg));
  writeJson(extrasPluginPath, syncExtrasPlugin(readJson(extrasPluginPath), pkg));
  writeJson(marketplacePath, syncMarketplace(readJson(marketplacePath), pkg));

  console.log('✓ Synced plugin manifests from package.json');
}

main();
