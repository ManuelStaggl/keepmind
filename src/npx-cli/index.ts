import pc from 'picocolors';
import { readPluginVersion } from './utils/paths.js';
import type { InstallOptions } from './commands/install.js';

const args = process.argv.slice(2);
const firstArg = args[0]?.toLowerCase() ?? '';
// If the first token is a flag (e.g. `npx keepmind --provider claude`),
// treat the invocation as `install` with those flags. Help/version flags are
// handled directly so they don't get swallowed by the install path.
const HELP_OR_VERSION_FLAGS = new Set(['-h', '--help', '-v', '--version']);
const command =
  firstArg.startsWith('-') && !HELP_OR_VERSION_FLAGS.has(firstArg)
    ? 'install'
    : firstArg;

function printHelp(): void {
  const version = readPluginVersion();

  console.log(`
${pc.bold('keepmind')} v${version} — persistent memory for AI coding assistants

${pc.bold('Install Commands')} (no Bun required):
  ${pc.cyan('npx keepmind')}                     Interactive install
  ${pc.cyan('npx keepmind install')}              Interactive install
  ${pc.cyan('npx keepmind install --ide <id>')}   Install for specific IDE
  ${pc.cyan('npx keepmind install --provider claude|gemini|openrouter')}   Set LLM provider non-interactively
  ${pc.cyan('npx keepmind install --model <id>')}   Set Claude model (when provider=claude)
  ${pc.cyan('npx keepmind install --no-auto-start')}   Skip worker auto-start at the end
  ${pc.cyan('npx keepmind install --disable-auto-memory')}   Explicitly disable Claude Code native auto-memory
  ${pc.cyan('npx keepmind repair')}                Repair runtime (re-runs Bun/uv setup and bun install in plugin cache)
  ${pc.cyan('npx keepmind update')}               Update to latest version
  ${pc.cyan('npx keepmind uninstall')}            Remove plugin and configs
  ${pc.cyan('npx keepmind version')}              Print version

${pc.bold('Runtime Commands')} (requires Bun, delegates to installed plugin):
  ${pc.cyan('npx keepmind start')}                Start worker service
  ${pc.cyan('npx keepmind stop')}                 Stop worker service
  ${pc.cyan('npx keepmind restart')}              Restart worker service
  ${pc.cyan('npx keepmind status')}               Show worker status
  ${pc.cyan('npx keepmind doctor')}               Onboarding & health check (runtime, provider, worker, memory) — add ${pc.dim('--json')}
  ${pc.cyan('npx keepmind metrics')}              Observer cost per day: billed tokens, tokens/turn, gated share — add ${pc.dim('--json --day <date> --days <n>')}
  ${pc.cyan('npx keepmind server api-key create|list|revoke')}   Manage local SQLite API keys (for the local v1 routes)
  ${pc.cyan('npx keepmind worker start|stop|restart|status')}    Worker compatibility aliases
  ${pc.cyan('npx keepmind search <query>')}       Search observations
  ${pc.cyan('npx keepmind adopt [--dry-run] [--branch <name>]')}    Stamp merged worktrees into parent project
  ${pc.cyan('npx keepmind cleanup [--dry-run]')}    Run one-time v12.4.3 pollution cleanup (or preview counts)
  ${pc.cyan('npx keepmind migrate [--from <dir>] [--dry-run]')}    Import an existing claude-mem database (lossless, non-destructive)
  ${pc.cyan('npx keepmind akten:import <dir>…')}   Import curated decision records verbatim — no model involved ${pc.dim('--project <name> --dry-run --json')}
  ${pc.cyan('npx keepmind akten:check <dir>…')}    Report structural contradictions; exits non-zero. For pre-commit ${pc.dim('--json')}
  ${pc.cyan('npx keepmind curated:import')}        Import the configured curated source set — records AND work items ${pc.dim('--dry-run --json')}
  ${pc.cyan('npx keepmind curated:alter')}         Which decisions have the most happened around since they were written ${pc.dim('--limit --all --json')}
  ${pc.cyan('npx keepmind curated:add')}           Write a lasting entry straight into keepmind — no source file ${pc.dim('--title --status --rel --body-stdin --dry-run')}
  ${pc.cyan('npx keepmind curated:edit <id>')}     Change that entry IN PLACE; the previous revision keeps its text ${pc.dim('--title --status --body-file --rel')}
  ${pc.cyan('npx keepmind curated:supersede <new> <old>')}   Declare and apply a supersession
  ${pc.cyan('npx keepmind curated:close <id>')}    Retire an entry that no longer applies ${pc.dim('--reason')}
  ${pc.cyan('npx keepmind curated:show <id>')}     Read the current text ${pc.dim('--all for every revision')}
  ${pc.cyan('npx keepmind export <dir>')}          Write the whole memory to a readable, verifiable bundle ${pc.dim('--project --no-settings --json')}
  ${pc.cyan('npx keepmind import <dir>')}          Restore a bundle on another machine and rebuild the semantic index ${pc.dim('--merge --replace --dry-run')}
  ${pc.cyan('npx keepmind migrate --purge --yes')}    Import, then remove claude-mem entirely (archives it first; requires a verified-complete migration)
  ${pc.cyan('npx keepmind transcript watch')}     Start transcript watcher

${pc.bold('IDE Identifiers')}:
  claude-code, cursor, gemini-cli, opencode,
  windsurf, codex-cli, copilot-cli, antigravity, goose,
  roo-code, warp
`);
}

function readFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  // Reject missing or flag-shaped values so e.g. `--model --no-auto-start`
  // doesn't silently treat `--no-auto-start` as the model name.
  if (next === undefined || next.startsWith('-')) {
    console.error(pc.red(`Flag ${name} requires a value.`));
    process.exit(1);
  }
  return next;
}

function parseInstallOptions(argv: string[]): InstallOptions {
  const provider = readFlag(argv, '--provider');
  if (provider !== undefined && provider !== 'claude' && provider !== 'gemini' && provider !== 'openrouter') {
    console.error(`Unknown --provider: ${provider}. Allowed: claude, gemini, openrouter`);
    process.exit(1);
  }
  const runtime = readFlag(argv, '--runtime');
  if (runtime !== undefined && runtime !== 'worker') {
    // Local-only fork: only the worker runtime survives. Accept the flag but
    // do not fail — install.ts downgrades anything non-worker to worker.
    console.error(`Note: the "${runtime}" runtime was removed; using the worker runtime.`);
  }
  return {
    ide: readFlag(argv, '--ide'),
    provider: provider as InstallOptions['provider'],
    model: readFlag(argv, '--model'),
    noAutoStart: argv.includes('--no-auto-start'),
    disableAutoMemory: argv.includes('--disable-auto-memory'),
    runtime: runtime as InstallOptions['runtime'],
  };
}

async function main(): Promise<void> {
  switch (command) {
    case '':
    case 'install': {
      const { runInstallCommand } = await import('./commands/install.js');
      await runInstallCommand(parseInstallOptions(args));
      break;
    }

    case 'repair': {
      const { runRepairCommand } = await import('./commands/install.js');
      await runRepairCommand();
      break;
    }

    case 'update':
    case 'upgrade': {
      const { runInstallCommand } = await import('./commands/install.js');
      await runInstallCommand();
      break;
    }

    case 'uninstall':
    case 'remove': {
      const { runUninstallCommand } = await import('./commands/uninstall.js');
      await runUninstallCommand();
      break;
    }

    case 'version':
    case '--version':
    case '-v': {
      console.log(readPluginVersion());
      break;
    }

    case 'help':
    case '--help':
    case '-h': {
      printHelp();
      break;
    }

    case 'start': {
      const { runStartCommand } = await import('./commands/runtime.js');
      runStartCommand();
      break;
    }
    case 'stop': {
      const { runStopCommand } = await import('./commands/runtime.js');
      runStopCommand();
      break;
    }
    case 'restart': {
      const { runRestartCommand } = await import('./commands/runtime.js');
      runRestartCommand();
      break;
    }
    case 'status': {
      const { runStatusCommand } = await import('./commands/runtime.js');
      runStatusCommand();
      break;
    }

    case 'doctor': {
      const { runDoctorCommand } = await import('./commands/doctor.js');
      await runDoctorCommand(args.slice(1));
      break;
    }

    case 'metrics': {
      const rest = args.slice(1);
      const daysFlag = readFlag(rest, '--days');
      const { runMetricsCommand } = await import('./commands/metrics.js');
      await runMetricsCommand({
        json: rest.includes('--json'),
        day: rest.includes('--day') ? readFlag(rest, '--day') : undefined,
        days: daysFlag ? parseInt(daysFlag, 10) : undefined,
      });
      break;
    }

    case 'akten:import': {
      const { runAktenImportCommand, parseAktenImportOptions } = await import('./commands/akten.js');
      await runAktenImportCommand(parseAktenImportOptions(args.slice(1)));
      break;
    }

    case 'akten:check': {
      const { runAktenCheckCommand, parseAktenImportOptions } = await import('./commands/akten.js');
      await runAktenCheckCommand(parseAktenImportOptions(args.slice(1)));
      break;
    }

    case 'curated:import': {
      const { runCuratedImportCommand, parseCuratedImportOptions } = await import('./commands/curated.js');
      await runCuratedImportCommand(parseCuratedImportOptions(args.slice(1)));
      break;
    }

    // Lasting entries authored directly in keepmind — no source file at any
    // point. Same write path and same deterministic rules as the file import
    // (src/services/curated/authoring.ts), so nothing here reaches a model.
    case 'curated:add':
    case 'curated:edit':
    case 'curated:supersede':
    case 'curated:close':
    case 'curated:reopen':
    case 'curated:show':
    case 'curated:history': {
      const { runCuratedAuthorCommand, parseCuratedAuthorOptions, curatedAuthorUsage } =
        await import('./commands/curated-author.js');
      const action = command.slice('curated:'.length) as Parameters<typeof parseCuratedAuthorOptions>[0];
      if (args.includes('--help') || args.includes('-h')) {
        console.log(curatedAuthorUsage());
        break;
      }
      try {
        await runCuratedAuthorCommand(parseCuratedAuthorOptions(action, args.slice(1)));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        console.error('');
        console.error(curatedAuthorUsage());
        process.exitCode = 1;
      }
      break;
    }

    case 'curated:alter': {
      const { runAlterCommand, parseAlterOptions } = await import('./commands/alter.js');
      await runAlterCommand(parseAlterOptions(args.slice(1)));
      break;
    }

    // Portability. The one thing that makes keepmind safe to rely on as the
    // only place lasting knowledge lives: it can leave the machine.
    case 'export': {
      const { runExportCommand, parseExportOptions, exportUsage } = await import('./commands/portability.js');
      if (args.includes('--help') || args.includes('-h')) { console.log(exportUsage()); break; }
      await runExportCommand(parseExportOptions(args.slice(1)));
      break;
    }

    case 'import': {
      const { runImportCommand, parseImportOptions, importUsage } = await import('./commands/portability.js');
      if (args.includes('--help') || args.includes('-h')) { console.log(importUsage()); break; }
      await runImportCommand(parseImportOptions(args.slice(1)));
      break;
    }

    case 'server': {
      const { runServerCommand } = await import('./commands/server.js');
      await runServerCommand(args.slice(1));
      break;
    }

    case 'worker': {
      const { runWorkerAliasCommand } = await import('./commands/server.js');
      runWorkerAliasCommand(args.slice(1));
      break;
    }

    case 'search': {
      const { runSearchCommand } = await import('./commands/runtime.js');
      await runSearchCommand(args.slice(1));
      break;
    }

    case 'adopt': {
      const { runAdoptCommand } = await import('./commands/runtime.js');
      runAdoptCommand(args.slice(1));
      break;
    }

    case 'cleanup': {
      const { runCleanupCommand } = await import('./commands/runtime.js');
      runCleanupCommand(args.slice(1));
      break;
    }

    case 'migrate': {
      const { runMigrateCommand } = await import('./commands/migrate.js');
      await runMigrateCommand(args.slice(1));
      break;
    }

    case 'transcript': {
      const subCommand = args[1]?.toLowerCase();
      if (subCommand === 'watch') {
        const { runTranscriptWatchCommand } = await import('./commands/runtime.js');
        runTranscriptWatchCommand();
      } else {
        console.error(pc.red(`Unknown transcript subcommand: ${subCommand ?? '(none)'}`));
        console.error(`Usage: npx keepmind transcript watch`);
        process.exit(1);
      }
      break;
    }

    default: {
      console.error(pc.red(`Unknown command: ${command}`));
      console.error(`Run ${pc.bold('npx keepmind --help')} for usage information.`);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(pc.red('Fatal error:'), error.message || error);
  process.exit(1);
});
