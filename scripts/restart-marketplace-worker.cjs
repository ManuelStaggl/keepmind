#!/usr/bin/env node

// Restart the installed marketplace worker after a sync. Replaces the previous
// `(cd ~/.claude/... && npm run worker:restart)` build-and-sync step, whose `~`
// did not expand in the shell npm uses on Windows ("path not found"). Resolving
// the homedir in node makes this portable.

const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const { existsSync } = require('fs');

const workerScript = path.join(
  os.homedir(), '.claude', 'plugins', 'marketplaces', 'keepmind', 'plugin', 'scripts', 'worker-service.cjs',
);

if (!existsSync(workerScript)) {
  console.error(`Marketplace worker not found at ${workerScript} — is the plugin installed?`);
  process.exit(1);
}

try {
  execFileSync('node', [workerScript, 'restart'], { stdio: 'inherit' });
} catch (error) {
  console.error('Worker restart failed:', error.message);
  process.exit(1);
}
