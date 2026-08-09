/**
 * `npx keepmind metrics` — the observer's cost balance, aggregated correctly.
 *
 * The arithmetic, and why it is code rather than a documented one-liner, lives
 * in services/worker/metrics-aggregate.ts. This file is presentation only.
 */

import pc from 'picocolors';
import {
  aggregateSessionMetrics,
  listMetricsDays,
  readMetricsDay,
  type MetricsAggregate,
} from '../../services/worker/metrics-aggregate.js';
import { LOGS_DIR } from '../../shared/paths.js';

export interface MetricsOptions {
  json?: boolean;
  day?: string;
  days?: number;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function renderRow(label: string, agg: MetricsAggregate): string {
  const perTurn = agg.tokensPerTurn === null ? '—' : fmt(agg.tokensPerTurn);
  return [
    pc.bold(label.padEnd(12)),
    `${fmt(agg.compressionTurns).padStart(6)} turns`,
    `${pct(agg.gatedShare).padStart(5)} gated`,
    `${fmt(agg.billedTokens).padStart(12)} billed`,
    `${perTurn.padStart(9)} /turn`,
    `${fmt(agg.observationsProduced).padStart(5)} obs`,
  ].join('  ');
}

export async function runMetricsCommand(options: MetricsOptions = {}): Promise<void> {
  const allDays = listMetricsDays();
  if (allDays.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ days: [], total: null, logsDir: LOGS_DIR }, null, 2));
      return;
    }
    console.log(
      `\nNo cost records yet. One is written when a session ends, to\n  ${LOGS_DIR}\n`,
    );
    return;
  }

  let days = allDays;
  if (options.day) {
    days = allDays.filter((d) => d === options.day);
    if (days.length === 0) {
      console.error(pc.red(`No metrics for ${options.day}. Available: ${allDays.join(', ')}`));
      process.exit(1);
    }
  } else if (options.days && options.days > 0) {
    days = allDays.slice(-options.days);
  }

  const read = days.map((day) => ({ day, ...readMetricsDay(day) }));
  const perDay = read.map(({ day, records }) => ({ day, agg: aggregateSessionMetrics(records) }));
  const total = aggregateSessionMetrics(read.flatMap((d) => d.records));
  const unreadable = read.reduce((sum, d) => sum + d.unreadableLines, 0);

  if (options.json) {
    console.log(JSON.stringify({ days: perDay, total, unreadableLines: unreadable, logsDir: LOGS_DIR }, null, 2));
    return;
  }

  console.log(`\n${pc.bold('keepmind observer cost')}  ${pc.dim(LOGS_DIR)}\n`);
  for (const { day, agg } of perDay) {
    console.log('  ' + renderRow(day, agg));
  }
  if (perDay.length > 1) {
    console.log('  ' + pc.dim('─'.repeat(72)));
    console.log('  ' + renderRow('total', total));
  }

  // "Records" and "sessions" are deliberately both reported: a session that
  // pauses for quota and resumes, or a host restart, produces more than one
  // record for one stretch of work. Reading per-record figures as per-session
  // ones understates the cost of a working session.
  console.log(
    `\n  ${fmt(total.records)} record(s) across ${fmt(total.sessions)} host session(s); ` +
      `${fmt(total.gatedBatches)} batch(es) never reached the model.`,
  );
  if (unreadable > 0) {
    // A live worker can leave a partial last line, so one is routine. Reporting
    // the count anyway: a silent drop looks exactly like a cheaper day.
    console.log(
      pc.yellow(`  ${fmt(unreadable)} line(s) could not be parsed and are not counted above.`),
    );
  }
  if (total.skippedOldSchema > 0) {
    console.log(
      pc.yellow(
        `  ${fmt(total.skippedOldSchema)} record(s) from before 3.4.2 left out: their token counts ` +
          `excluded cache reads, so folding them in would understate the bill.`,
      ),
    );
  }
  console.log();
}
