
import { describe, it, expect } from 'bun:test';
import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import { reportAudit } from './audit-report.js';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const SRC_DIR = join(PROJECT_ROOT, 'src');

interface LoggerCall {
  file: string;
  line: number;
  level: string;
  component: string;
  message: string;
  errorParam: string | null;
  fullMatch: string;
}

async function findTypeScriptFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findTypeScriptFiles(fullPath)));
    } else if (entry.isFile() && /\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractLoggerCalls(content: string, filePath: string): LoggerCall[] {
  const calls: LoggerCall[] = [];
  const lines = content.split('\n');
  const seenCalls = new Set<string>();

  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }

  function getLineNumber(pos: number): number {
    for (let i = lineStarts.length - 1; i >= 0; i--) {
      if (lineStarts[i] <= pos) return i + 1;
    }
    return 1;
  }

  const loggerPattern = /logger\.(error|warn|info|debug|failure|success|timing|dataIn|dataOut|happyPathError)\s*\(\s*['"]([^'"]+)['"][\s\S]*?\)/g;

  let match: RegExpExecArray | null;
  while ((match = loggerPattern.exec(content)) !== null) {
    const fullMatch = match[0];
    const method = match[1];
    const component = match[2];
    const lineNum = getLineNumber(match.index);

    const messageMatch = fullMatch.match(/['"][^'"]+['"]\s*,\s*(['"`])([\s\S]*?)\1/);
    const message = messageMatch ? messageMatch[2] : '(message not captured)';

    let errorParam: string | null = null;
    const errorMatch = fullMatch.match(/,\s*(error|err|e)\s+as\s+Error\s*\)/i) ||
                       fullMatch.match(/,\s*(error|err|e)\s*\)/i) ||
                       fullMatch.match(/,\s*new\s+Error\s*\([^)]*\)\s*\)/i);
    if (errorMatch) {
      errorParam = errorMatch[0].replace(/^\s*,\s*/, '').replace(/\s*\)\s*$/, '');
    }

    const key = `${filePath}:${lineNum}:${method}:${message.substring(0, 50)}`;
    if (!seenCalls.has(key)) {
      seenCalls.add(key);
      calls.push({
        file: relative(PROJECT_ROOT, filePath),
        line: lineNum,
        level: normalizeLevel(method),
        component,
        message,
        errorParam,
        fullMatch: fullMatch.replace(/\s+/g, ' ').trim()  
      });
    }
  }

  return calls;
}

function normalizeLevel(method: string): string {
  switch (method) {
    case 'error':
    case 'failure':
      return 'ERROR';
    case 'warn':
    case 'happyPathError':
      return 'WARN';
    case 'info':
    case 'success':
    case 'timing':
    case 'dataIn':
    case 'dataOut':
      return 'INFO';
    case 'debug':
      return 'DEBUG';
    default:
      return method.toUpperCase();
  }
}

function generateReport(calls: LoggerCall[]): string {
  const byLevel: Record<string, LoggerCall[]> = {
    'ERROR': [],
    'WARN': [],
    'INFO': [],
    'DEBUG': []
  };

  for (const call of calls) {
    if (byLevel[call.level]) {
      byLevel[call.level].push(call);
    }
  }

  const lines: string[] = [];
  lines.push('\n=== LOG LEVEL AUDIT REPORT ===\n');
  lines.push(`Total logger calls found: ${calls.length}\n`);

  lines.push('');
  lines.push('ERROR (should be critical failures only):');
  lines.push('─'.repeat(60));
  if (byLevel['ERROR'].length === 0) {
    lines.push('  (none found)');
  } else {
    for (const call of byLevel['ERROR'].sort((a, b) => a.file.localeCompare(b.file))) {
      lines.push(`  ${call.file}:${call.line} [${call.component}]`);
      lines.push(`    message: "${formatMessage(call.message)}"`);
      if (call.errorParam) {
        lines.push(`    error: ${call.errorParam}`);
      }
      lines.push(`    full: ${call.fullMatch}`);
      lines.push('');
    }
  }
  lines.push(`  Count: ${byLevel['ERROR'].length}`);

  lines.push('');
  lines.push('WARN (should be non-critical, has fallback):');
  lines.push('─'.repeat(60));
  if (byLevel['WARN'].length === 0) {
    lines.push('  (none found)');
  } else {
    for (const call of byLevel['WARN'].sort((a, b) => a.file.localeCompare(b.file))) {
      lines.push(`  ${call.file}:${call.line} [${call.component}]`);
      lines.push(`    message: "${formatMessage(call.message)}"`);
      if (call.errorParam) {
        lines.push(`    error: ${call.errorParam}`);
      }
      lines.push(`    full: ${call.fullMatch}`);
      lines.push('');
    }
  }
  lines.push(`  Count: ${byLevel['WARN'].length}`);

  lines.push('');
  lines.push('INFO (informational):');
  lines.push('─'.repeat(60));
  if (byLevel['INFO'].length === 0) {
    lines.push('  (none found)');
  } else {
    for (const call of byLevel['INFO'].sort((a, b) => a.file.localeCompare(b.file))) {
      lines.push(`  ${call.file}:${call.line} [${call.component}]`);
      lines.push(`    message: "${formatMessage(call.message)}"`);
      if (call.errorParam) {
        lines.push(`    error: ${call.errorParam}`);
      }
      lines.push(`    full: ${call.fullMatch}`);
      lines.push('');
    }
  }
  lines.push(`  Count: ${byLevel['INFO'].length}`);

  lines.push('');
  lines.push('DEBUG (detailed diagnostics):');
  lines.push('─'.repeat(60));
  if (byLevel['DEBUG'].length === 0) {
    lines.push('  (none found)');
  } else {
    for (const call of byLevel['DEBUG'].sort((a, b) => a.file.localeCompare(b.file))) {
      lines.push(`  ${call.file}:${call.line} [${call.component}]`);
      lines.push(`    message: "${formatMessage(call.message)}"`);
      if (call.errorParam) {
        lines.push(`    error: ${call.errorParam}`);
      }
      lines.push(`    full: ${call.fullMatch}`);
      lines.push('');
    }
  }
  lines.push(`  Count: ${byLevel['DEBUG'].length}`);

  lines.push('');
  lines.push('=== SUMMARY ===');
  lines.push(`  ERROR: ${byLevel['ERROR'].length}`);
  lines.push(`  WARN:  ${byLevel['WARN'].length}`);
  lines.push(`  INFO:  ${byLevel['INFO'].length}`);
  lines.push(`  DEBUG: ${byLevel['DEBUG'].length}`);
  lines.push(`  TOTAL: ${calls.length}`);
  lines.push('');

  return lines.join('\n');
}

function formatMessage(message: string): string {
  return message;
}

describe('Log Level Audit', () => {
  let allCalls: LoggerCall[] = [];

  it('should scan all TypeScript files and extract logger calls', async () => {
    const files = await findTypeScriptFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      const calls = extractLoggerCalls(content, file);
      allCalls.push(...calls);
    }

    expect(allCalls.length).toBeGreaterThan(0);
  });

  it('should generate audit report for log level review', () => {
    // Exercise the report generator, but do NOT dump the whole thing to stdout.
    // The full audit is thousands of lines (every logger call in src/); flooding
    // the node:test runner's result channel with it crashed the run on Node 24.18
    // ("Unable to deserialize cloned data due to invalid or unsupported
    // version"). No assertion depends on the text — just that it builds.
    const report = generateReport(allCalls);
    expect(report).toContain('LOG LEVEL AUDIT REPORT');
    expect(report.length).toBeGreaterThan(0);
  });

  it('should have summary statistics', () => {
    const byLevel: Record<string, number> = {
      'ERROR': 0,
      'WARN': 0,
      'INFO': 0,
      'DEBUG': 0
    };

    for (const call of allCalls) {
      if (byLevel[call.level] !== undefined) {
        byLevel[call.level]++;
      }
    }

    // Gated: see tests/audit-report.ts for why writing to stdout from an audit
    // test intermittently fails the whole file in Node's test runner.
    const pct = (level: string) => ((byLevel[level] / allCalls.length) * 100).toFixed(1);
    reportAudit(() => [
      '\n📊 Log Level Distribution:',
      `  ERROR: ${byLevel['ERROR']} (${pct('ERROR')}%)`,
      `  WARN:  ${byLevel['WARN']} (${pct('WARN')}%)`,
      `  INFO:  ${byLevel['INFO']} (${pct('INFO')}%)`,
      `  DEBUG: ${byLevel['DEBUG']} (${pct('DEBUG')}%)`,
    ]);

    expect(allCalls.length).toBeGreaterThan(0);
  });
});
