
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { logger } from './logger.js';
import { toBmpSafe } from './bmp-safe.js';
import { removeLegacyRulesFile } from './context-injection.js';

export interface CursorProjectRegistry {
  [projectName: string]: {
    workspacePath: string;
    installedAt: string;
  };
}

export interface CursorMcpConfig {
  mcpServers: {
    [name: string]: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };
  };
}

export function readCursorRegistry(registryFile: string): CursorProjectRegistry {
  try {
    if (!existsSync(registryFile)) return {};
    return JSON.parse(readFileSync(registryFile, 'utf-8'));
  } catch (error) {
    logger.error('CONFIG', 'Failed to read Cursor registry, using empty registry', {
      file: registryFile,
      error: error instanceof Error ? error.message : String(error)
    });
    return {};
  }
}

export function writeCursorRegistry(registryFile: string, registry: CursorProjectRegistry): void {
  const dir = join(registryFile, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(registryFile, JSON.stringify(registry, null, 2));
}

export function registerCursorProject(
  registryFile: string,
  projectName: string,
  workspacePath: string
): void {
  const registry = readCursorRegistry(registryFile);
  registry[projectName] = {
    workspacePath,
    installedAt: new Date().toISOString()
  };
  writeCursorRegistry(registryFile, registry);
}

export function unregisterCursorProject(registryFile: string, projectName: string): void {
  const registry = readCursorRegistry(registryFile);
  if (registry[projectName]) {
    delete registry[projectName];
    writeCursorRegistry(registryFile, registry);
  }
}

export function writeContextFile(workspacePath: string, context: string): void {
  const rulesDir = join(workspacePath, '.cursor', 'rules');
  const rulesFile = join(rulesDir, 'keepmind-context.mdc');
  const tempFile = `${rulesFile}.tmp`;

  mkdirSync(rulesDir, { recursive: true });

  const content = `---
alwaysApply: true
description: "keepmind context from past sessions (auto-updated)"
---

# Memory Context from Past Sessions

The following context is from keepmind, a persistent memory system that tracks your coding sessions.

${toBmpSafe(context)}

---
*Updated after last session. Use keepmind's MCP search tools for more detailed queries.*
`;

  writeFileSync(tempFile, content);
  renameSync(tempFile, rulesFile);
  removeLegacyRulesFile(rulesFile);
}

export function configureCursorMcp(mcpJsonPath: string, mcpServerScriptPath: string): void {
  const dir = join(mcpJsonPath, '..');
  mkdirSync(dir, { recursive: true });

  let config: CursorMcpConfig = { mcpServers: {} };
  if (existsSync(mcpJsonPath)) {
    try {
      config = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
      if (!config.mcpServers) {
        config.mcpServers = {};
      }
    } catch (error) {
      logger.error('CONFIG', 'Failed to read MCP config, starting fresh', {
        file: mcpJsonPath,
        error: error instanceof Error ? error.message : String(error)
      });
      config = { mcpServers: {} };
    }
  }

  // Drop the pre-rename entry first: Cursor keys MCP servers by name, so
  // leaving it would register the same server twice under two names.
  delete config.mcpServers['claude-mem'];
  config.mcpServers['keepmind'] = {
    command: 'node',
    args: [mcpServerScriptPath]
  };

  writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2));
}
