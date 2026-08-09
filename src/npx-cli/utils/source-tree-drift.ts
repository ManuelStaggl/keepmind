/**
 * Compare the running bundle against the source tree sitting next to it.
 *
 * The marketplace directory is a git clone of the whole repository, refreshed
 * by the host's plugin manager. The runtime that actually executes is the
 * bundle, replaced by `npx keepmind install` from the npm package — which ships
 * no `src/` at all. The two therefore move independently, and the clone can be
 * a release behind while everything runs correctly.
 *
 * That is harmless until someone audits the installed tree, reads `src/`, and
 * concludes a shipped fix is missing. It happened on the first day 3.4.1 was in
 * the field. Naming the drift is cheaper than the investigation it causes.
 *
 * Lives outside doctor.ts so it can be tested: doctor.ts opens the database,
 * and `node:sqlite` does not exist under the test runner.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { CheckResult } from '../commands/doctor.js';

export function checkSourceTreeDrift(
  marketplaceDir: string,
  runningVersion: string | undefined,
): CheckResult {
  const name = 'Source tree';
  const srcDir = join(marketplaceDir, 'src');
  if (!existsSync(srcDir)) {
    return {
      name,
      status: 'skip',
      detail: 'no source tree installed (the npm package ships none)',
      required: false,
    };
  }

  let clonedVersion: string | undefined;
  try {
    const pkg = JSON.parse(readFileSync(join(marketplaceDir, 'package.json'), 'utf-8'));
    if (typeof pkg.version === 'string') clonedVersion = pkg.version;
  } catch {
    // No readable manifest — report the tree, but claim no comparison.
  }

  const running = (runningVersion ?? '').replace(/^v/, '');
  if (!running || !clonedVersion) {
    return {
      name,
      status: 'ok',
      detail: `${srcDir} present (git clone of the repo; the bundle is what runs)`,
      required: false,
    };
  }
  if (clonedVersion !== running) {
    return {
      name,
      status: 'warn',
      detail:
        `sources in ${srcDir} are v${clonedVersion} while the running bundle is v${running} — ` +
        `the clone is updated by the host's plugin manager, not by \`npx keepmind install\`. ` +
        `Audit the bundle, not these sources.`,
      required: false,
    };
  }
  return {
    name,
    status: 'ok',
    detail: `v${clonedVersion}, matching the running bundle`,
    required: false,
  };
}
