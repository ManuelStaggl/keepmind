import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

// node ESM has no __dirname (bun provides it); node 20.11+ exposes import.meta.dirname.
const __dirname = import.meta.dirname;

const indexSource = readFileSync(join(__dirname, '..', 'src', 'npx-cli', 'index.ts'), 'utf-8');
const serverSource = readFileSync(join(__dirname, '..', 'src', 'npx-cli', 'commands', 'server.ts'), 'utf-8');
const workerServiceSource = readFileSync(join(__dirname, '..', 'src', 'services', 'worker-service.ts'), 'utf-8');

describe('npx CLI server namespace', () => {
  it('routes the server namespace through the server command module', () => {
    expect(indexSource).toContain("case 'server'");
    expect(indexSource).toContain("await import('./commands/server.js')");
    expect(indexSource).toContain('await runServerCommand(args.slice(1))');
  });

  it('routes worker lifecycle aliases through the server command module', () => {
    expect(indexSource).toContain("case 'worker'");
    expect(indexSource).toContain('runWorkerAliasCommand(args.slice(1))');
    expect(serverSource).toContain('runWorkerLifecycleCommand');
    expect(serverSource).toContain('runStartCommand()');
    expect(serverSource).toContain('runStopCommand()');
    expect(serverSource).toContain('runRestartCommand()');
    expect(serverSource).toContain('runStatusCommand()');
  });

  // NOTE: the cloud server-lifecycle CLI (server start/stop/restart/status +
  // logs/doctor/migrate/export/import) was removed in this local-only fork. The
  // former "routes server lifecycle commands" test asserted that removed wiring
  // and has been deleted. Only the surviving api-key management + `server-help`
  // handling is exercised below.

  it('normalizes direct worker-service server invocations (api-key + help only)', () => {
    expect(workerServiceSource).toContain("rawCommand === 'server'");
    expect(workerServiceSource).toContain('serverCommands.has(maybeSubCommand)');
    expect(workerServiceSource).toContain("case 'server-api-key'");
    expect(workerServiceSource).toContain('runServerApiKeyCli(commandArgs)');
    expect(workerServiceSource).toContain("case 'server-help'");
    expect(workerServiceSource).toContain("case 'worker-help'");
    expect(workerServiceSource).not.toContain('command: maybeSubCommand ??');
  });
});
