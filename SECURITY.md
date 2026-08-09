# Security Policy

## Supported Versions

Only the latest released version of `keepmind` receives security updates. Please upgrade to the latest version before reporting a vulnerability.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| older   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in keepmind, please report it by:

1. **DO NOT** create a public GitHub issue, pull request, or discussion
2. Email **filthyjoker@gmx.at** with details, OR use GitHub's "Report a vulnerability" button under the Security tab to open a private security advisory
3. Include steps to reproduce, impact assessment, affected version(s), and suggested fixes if possible

**Scope:** This policy covers the `keepmind` plugin and its bundled components (hooks, worker service, SQLite/Chroma sync, viewer UI, search/planning skills). Issues in upstream dependencies should be reported to those projects directly, but feel free to flag them to us as well.

We take security seriously, will acknowledge valid reports within 48 hours, and aim to ship a fix in the next release.

## Security Measures

### Command Injection Prevention

keepmind executes system commands for git operations and process management. We have implemented comprehensive protections against command injection:

#### Safe Command Execution
- **Array-based Arguments:** All commands use array-based arguments to prevent shell interpretation
- **No Shell Execution:** `shell: false` is explicitly set for all spawn operations involving user input
- **Input Validation:** All user-controlled parameters are validated before use

#### Example Safe Pattern
```typescript
// ✅ SAFE: Array-based arguments with validation
if (!isValidBranchName(userInput)) {
  throw new Error('Invalid input');
}
spawnSync('git', ['checkout', userInput], { shell: false });

// ❌ UNSAFE: Never do this
execSync(`git checkout ${userInput}`);
```

### Input Validation

All user-controlled inputs are validated using whitelists and strict patterns:

- **Branch Names:** Must match `/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/` and not contain `..`
- **Port Numbers:** Must be numeric and within range 1024-65535
- **File Paths:** All paths are joined using `path.join()` to prevent traversal

### Process Management

- **PID File Protection:** Process IDs are stored in user's data directory (`~/.keepmind/`)
- **Port Validation:** Worker port is validated before binding
- **Health Checks:** Worker health is verified before processing requests

### Privacy Controls

keepmind includes a dual-tag system for content privacy:

- `<private>content</private>` - User-level privacy (prevents storage)
- `<keepmind-context>content</keepmind-context>` - System-level tag (prevents recursive storage)

Tags are stripped at the hook layer before data reaches worker/database.

These tags are **opt-in and manual**. They are not the mechanism that protects
credentials — see "Secret redaction" below for what runs automatically.

### Secret redaction

keepmind sends tool inputs and outputs to a model provider in order to summarise
them (see "Data Storage" below for the full list of egress channels). Redaction
runs on that outbound path, **before** the content leaves the machine, and again
on the inbound path before anything is written to SQLite.

**Outbound (before the provider call)** — `src/services/redaction/outbound.ts`,
applied in `src/sdk/prompts.ts`, which is the single place any provider
(Claude, Gemini, OpenRouter) builds a prompt:

- Pattern redaction over every variable part of the prompt: tool inputs, tool
  outputs, the verbatim user request, and the last assistant message. Rules cover
  AWS / GitHub / GitLab / Slack / Google / Stripe keys, JWTs, bearer tokens,
  bcrypt hashes, PEM private key blocks, URI and ADO.NET/JDBC connection strings,
  labelled `password=` / `token:` assignments, plus a Shannon-entropy backstop
  for opaque tokens no rule names.
- Email addresses and IPv4 addresses are masked as a separate, separately
  switchable category (`KEEPMIND_REDACT_PII=0` turns only this off).
- A **sensitive-file guard**: for files whose entire content is credential
  material (`.env`, `id_rsa`, `*.pem`, `*.p12`, `.aws/`, `.ssh/`, …) the payload
  is not sent at all. The path is still reported, so the access is visible
  without the content. `.env.example` and similar templates are exempt.

**Inbound (before SQLite)** — `SessionStore` and `MaintenanceLoop` redact the
model's response on write, so masked values are what lands on disk.

**Limits you should know about:**

- Redaction is pattern-based and therefore best-effort. It is deliberately
  biased toward over-redaction, but a credential in a shape no rule matches and
  with low entropy can still pass.
- `KEEPMIND_REDACT_SECRETS=0` is an emergency kill-switch that disables **both**
  paths, including the outbound one. Setting it means raw tool content is sent to
  the provider.
- Redaction protects against accidental disclosure of credentials in ordinary
  tool traffic. It is not a substitute for keeping secrets out of a repository,
  and it does not make keepmind appropriate for regulated data without your own
  assessment.

The behaviour above is pinned by `tests/redaction/outbound.test.ts`, which
asserts against the prompt string actually handed to the provider — removing
redaction from the prompt builders fails the test.

#### History

Before 3.4.0, redaction ran **only** on the write path (`SessionStore`,
`MaintenanceLoop`). Raw tool inputs and outputs — whole file contents, shell
commands and their output, verbatim user prompts — were sent to the model
provider unredacted; only the model's reply was scrubbed on its way to disk.
This document previously described the privacy tags in a way that implied
pre-send filtering, which was not the case. If you ran an earlier version with a
provider you would not want to hold that content, treat it accordingly.

## Security Audit History

### 2026-08-09: Tool content sent to the model provider unredacted
- **Severity:** HIGH
- **Status:** RESOLVED
- **Affected Versions:** all versions before 3.4.0
- **Fixed In:** 3.4.0

**Finding.** `redactSecrets` / `redactSecretsDeep` were called from exactly two
places, `SessionStore` (on write to SQLite) and `MaintenanceLoop`. Both sit
*downstream* of the model call. Raw tool inputs and outputs — whole file
contents, shell commands and their output, verbatim user prompts — were
therefore sent to the configured model provider unredacted; only the model's
response was scrubbed on its way to disk. This document described the privacy
tags in a way that implied pre-send filtering, which was not the case.

**Evidence it was not theoretical.** The entropy backstop had 4,147 matches in
the local database. Each of those was masked *on write*, which means the
cleartext had already travelled through a prompt.

**Fixes.**
1. Redaction moved onto the outbound path (`src/services/redaction/outbound.ts`,
   applied in `src/sdk/prompts.ts` — the single point where every provider builds
   its prompt).
2. New rules for ADO.NET/JDBC connection strings, email addresses and IPv4
   addresses; the connection-string rule runs ahead of the generic one, which
   would otherwise stop at the first symbol and leave the tail of a password in
   cleartext.
3. A sensitive-file guard that withholds the content of `.env`, `id_rsa`,
   `*.pem`, `.ssh/`, `.aws/` and similar entirely, reporting only the access.
4. `tests/redaction/outbound.test.ts` asserts against the prompt string actually
   handed to the provider, and fails if the redaction calls are removed.

### 2025-12-16: Command Injection Vulnerability (upstream claude-mem, Issue #354)

*Inherited from the pre-fork history. Issue number refers to the upstream
`claude-mem` tracker, not to this repository.*
- **Severity:** CRITICAL
- **Status:** RESOLVED
- **Affected Versions:** All versions prior to fix
- **Fixed In:** Current version
- **Vulnerabilities Found:** 3
- **Vulnerabilities Fixed:** 3

**Summary of Fixes:**
1. Replaced string interpolation with array-based arguments in `BranchManager.ts`
2. Added `isValidBranchName()` validation function
3. Removed unnecessary shell usage in `bun-path.ts`
4. Created comprehensive security test suite

## Security Best Practices for Contributors

### When Adding Command Execution

1. **NEVER use shell with user input:**
   ```typescript
   // ❌ NEVER
   execSync(`command ${userInput}`);
   spawn('command', [...], { shell: true });

   // ✅ ALWAYS
   spawnSync('command', [userInput], { shell: false });
   ```

2. **ALWAYS validate user input:**
   ```typescript
   if (!isValidInput(userInput)) {
     throw new Error('Invalid input');
   }
   ```

3. **Use array-based arguments:**
   ```typescript
   // ❌ NEVER
   execSync(`git ${command} ${arg}`);

   // ✅ ALWAYS
   spawnSync('git', [command, arg], { shell: false });
   ```

4. **Explicitly set shell: false:**
   ```typescript
   spawnSync('command', args, { shell: false });
   ```

### When Adding User Input

1. **Whitelist validation** over blacklist
2. **Strict regex patterns** for format validation
3. **Type checking** for expected data types
4. **Range validation** for numeric inputs
5. **Length limits** for string inputs

### Code Review Checklist

Before submitting a PR with command execution or user input handling:

- [ ] No `execSync` with string interpolation or template literals
- [ ] No `shell: true` when user input is involved
- [ ] All spawn/spawnSync calls use array arguments
- [ ] Input validation is present for all user-controlled parameters
- [ ] Security tests are added for new attack vectors
- [ ] Code follows the safe patterns described above

## Dependencies

We regularly audit dependencies for vulnerabilities:

- **npm audit:** Run before each release
- **Dependabot:** Enabled for automatic security updates
- **Manual Review:** Critical dependencies reviewed quarterly

## Data Storage

keepmind stores data locally in `~/.keepmind/`:

- **Database:** SQLite3 at `~/.keepmind/keepmind.db`
- **Vector Store:** Chroma at `~/.keepmind/chroma/`
- **Logs:** `~/.keepmind/logs/`
- **Settings:** `~/.keepmind/settings.json`

All keepmind state files (database, vector store, logs, settings, supervisor and PID files) are written to the local user directory and are not uploaded by keepmind itself. keepmind does not collect telemetry.

However, by design keepmind invokes upstream model providers and optional integrations to do its work, so observation/transcript/prompt content can leave the machine through those channels:

- **Claude Agent SDK** (default summarization/observation path): sends prompts and transcript context to Anthropic's API.
- **Alternate providers** (`gemini`, `openrouter`): when configured, send the same context to those providers instead.
- **Chroma MCP / `chroma-mcp`**: when enabled, computes embeddings via the configured embedding backend, which may be a remote API depending on the user's chroma-mcp configuration.
- **OAuth / keychain reads**: keepmind reads the Claude Code OAuth token from the platform-native credential store at spawn time. The token is injected into worker subprocesses but is not transmitted by keepmind.
- **GitHub releases / npm registry**: version-check and self-update flows fetch metadata from public registries.

Content on these channels passes through outbound redaction first (see "Secret
redaction" above), which masks recognised credentials and drops the content of
key-bearing files. Review your provider configuration in
`~/.keepmind/settings.json` and `~/.keepmind/.env` before working on sensitive
material, and note that `<private>...</private>` tags govern **local storage**
only — they are stripped at the hook layer and are not the outbound filter.

To stop egress entirely, set `KEEPMIND_ENABLED=false` (disables capture,
injection and the per-Read timeline) or `KEEPMIND_CAPTURE_PROFILE` to a narrower
value so fewer events reach a provider at all.

## Permissions

keepmind requires:

- **File System:** Read/write to `~/.keepmind/` and `~/.claude/plugins/`
- **Network:** HTTP server on localhost (default port 37777)
- **Process Management:** Spawn worker processes, manage PIDs

No elevated privileges (root/administrator) are required.

## Secure Defaults

- **Worker Host:** Binds to `127.0.0.1` by default (localhost only)
- **Worker Port:** User-configurable, validates range 1024-65535
- **Log Level:** INFO by default (no sensitive data in logs)
- **Privacy Tags:** Auto-strips `<private>` content before storage (manual, opt-in)
- **Secret Redaction:** On by default, on both the outbound and the write path

## Updates

Security patches are released as soon as possible after discovery. Users should:

1. Keep keepmind updated to the latest version
2. Monitor GitHub releases for security announcements
3. Review [CHANGELOG.md](./CHANGELOG.md) for security-related changes

## Questions?

For security-related questions (non-vulnerabilities), please:

1. Review code comments in security-critical files
2. Open a GitHub Discussion (not an Issue) for general security questions
3. For sensitive questions, email **filthyjoker@gmx.at**

---

**Last Updated:** 2026-08-09
**Last Audit:** 2026-08-09 (outbound redaction)
**Next Scheduled Audit:** 2027-02-09
