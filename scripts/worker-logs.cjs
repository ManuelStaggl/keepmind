#!/usr/bin/env node

// Print (and optionally follow) today's worker log. Replaces the previous
// `tail -n 50 ~/.keepmind/logs/worker-$(date +%Y-%m-%d).log` npm scripts, which
// were broken on Windows three ways: `tail` and `$(date …)` don't exist in npm's
// shell, `~` doesn't expand, and the filename prefix was stale (`worker-` — the
// logger writes `keepmind-<date>.log`). node-only, cross-platform.
//
// Usage: node scripts/worker-logs.cjs [-n <lines>] [-f|--follow]

const fs = require('fs');
const path = require('path');
const os = require('os');

function parseArgs(argv) {
  const opts = { lines: 50, follow: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-f' || a === '--follow') opts.follow = true;
    else if (a === '-n' || a === '--lines') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) opts.lines = Math.floor(n);
    }
  }
  return opts;
}

function dataDir() {
  return process.env.KEEPMIND_DATA_DIR || process.env.KEEPMIND_DATA_DIR || path.join(os.homedir(), '.keepmind');
}

function todaysLog() {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD, matches logger.ts
  return path.join(dataDir(), 'logs', `keepmind-${date}.log`);
}

const opts = parseArgs(process.argv.slice(2));
const logPath = todaysLog();

if (!fs.existsSync(logPath)) {
  console.error(`No log file for today at ${logPath} — has the worker started?`);
  process.exit(1);
}

// Print the last N lines.
const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split(/\r?\n/);
if (lines.length && lines[lines.length - 1] === '') lines.pop();
process.stdout.write(lines.slice(-opts.lines).join('\n') + (lines.length ? '\n' : ''));

if (!opts.follow) process.exit(0);

// Follow mode: poll the file size and stream appended bytes.
let offset = Buffer.byteLength(content, 'utf8');
setInterval(() => {
  let size;
  try {
    size = fs.statSync(logPath).size;
  } catch {
    return; // file rotated/removed — wait for it to reappear
  }
  if (size < offset) offset = 0; // truncated/rotated
  if (size > offset) {
    const fd = fs.openSync(logPath, 'r');
    try {
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      process.stdout.write(buf.toString('utf8'));
      offset = size;
    } finally {
      fs.closeSync(fd);
    }
  }
}, 500);
