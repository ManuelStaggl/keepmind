// SPDX-License-Identifier: Apache-2.0
//
// Locate and stop orphaned claude-mem subprocesses that keep running against
// the legacy `~/.claude-mem` data directory after a user switched to keepmind.
//
// The real-world case this solves (observed live): claude-mem's chroma-mcp
// vector server (`chroma-mcp.exe` + its `python`/`pythonw` workers) launched
// with `--data-dir <home>/.claude-mem/chroma` outlives the switch, holds the
// old chroma files open, and blocks removal of `~/.claude-mem`. These
// processes are NOT in keepmind's supervisor registry, so the normal shutdown
// cascade can't reach them — we have to discover them by scanning the OS
// process table and kill them by PID.
//
// Crucial correctness note: match on the process NAME (chroma-mcp/python), not
// only the command line. A naive `CommandLine -match 'chroma-mcp'` also matches
// the very PowerShell command doing the scan (its own argument string contains
// "chroma-mcp"), producing a false self-hit. Restricting to the known binary
// names avoids that.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ClaudeMemProcess {
  pid: number;
  name: string;
}

/** Process image names claude-mem's vector backend runs under. */
const CHROMA_PROCESS_NAMES = ['chroma-mcp.exe', 'python.exe', 'pythonw.exe', 'chroma-mcp', 'python', 'python3'];

/**
 * Find orphaned claude-mem chroma-mcp processes bound to the legacy data dir.
 * Read-only; returns `[]` on any scan failure (best-effort discovery).
 */
export async function findClaudeMemProcesses(): Promise<ClaudeMemProcess[]> {
  try {
    return process.platform === 'win32'
      ? await findWindows()
      : await findPosix();
  } catch {
    return [];
  }
}

async function findWindows(): Promise<ClaudeMemProcess[]> {
  // Emit "pid<TAB>name" for every real chroma-mcp process whose command line
  // targets a .claude-mem data dir. The Name filter excludes this pwsh scan.
  const script =
    "Get-CimInstance Win32_Process | " +
    "Where-Object { $_.Name -match '^(chroma-mcp|python|pythonw)(\\.exe)?$' " +
    "-and $_.CommandLine -match 'chroma-mcp' -and $_.CommandLine -match '\\.claude-mem' } | " +
    "ForEach-Object { \"$($_.ProcessId)`t$($_.Name)\" }";
  const { stdout } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 15000 },
  );
  return parseLines(stdout);
}

async function findPosix(): Promise<ClaudeMemProcess[]> {
  // `ps -eo pid=,comm=,args=` → one row per process; filter in JS so we can
  // apply the same name + command-line + self-exclusion logic as on Windows.
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,comm=,args='], { timeout: 15000 });
  const out: ClaudeMemProcess[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const comm = m[2];
    const args = m[3];
    const baseName = comm.split('/').pop() ?? comm;
    if (!CHROMA_PROCESS_NAMES.includes(baseName)) continue;
    if (!/chroma-mcp/.test(args)) continue;
    if (!/\.claude-mem/.test(args)) continue;
    if (pid === process.pid) continue;
    out.push({ pid, name: baseName });
  }
  return out;
}

function parseLines(stdout: string): ClaudeMemProcess[] {
  const out: ClaudeMemProcess[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [pidStr, name] = trimmed.split('\t');
    const pid = Number(pidStr);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    out.push({ pid, name: name ?? 'unknown' });
  }
  return out;
}

/**
 * Force-kill the given PIDs (process tree). Best-effort: unknown/already-dead
 * PIDs are skipped. Returns the number of processes for which a kill was issued
 * without error.
 */
export async function killProcesses(pids: number[]): Promise<number> {
  let killed = 0;
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      if (process.platform === 'win32') {
        await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
      } else {
        process.kill(pid, 'SIGKILL');
      }
      killed++;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      // ESRCH = already gone; taskkill exit 128 = process not found — both fine.
      if (code === 'ESRCH') continue;
    }
  }
  return killed;
}
