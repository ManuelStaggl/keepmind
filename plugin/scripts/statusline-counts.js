#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";

const cwd = process.argv[2] || process.env.CLAUDE_CWD || process.cwd();
const project = basename(cwd);

try {
  const envDataDir = process.env.KEEPMIND_DATA_DIR || process.env.CLAUDE_MEM_DATA_DIR;
  let dataDir = envDataDir || join(homedir(), ".keepmind");
  if (!envDataDir) {
    const settingsPath = join(dataDir, "settings.json");
    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        const settingsDataDir = settings.KEEPMIND_DATA_DIR || settings.CLAUDE_MEM_DATA_DIR;
        if (settingsDataDir) dataDir = settingsDataDir;
      } catch { /* use default */ }
    }
  }

  // Canonical DB filename is keepmind.db; fall back to the legacy claude-mem.db
  // (the worker renames it on startup, but statusline may run before that).
  const newDbPath = join(dataDir, "keepmind.db");
  const dbPath = existsSync(newDbPath) ? newDbPath : join(dataDir, "claude-mem.db");
  if (!existsSync(dbPath)) {
    console.log(JSON.stringify({ observations: 0, prompts: 0, project }));
    process.exit(0);
  }

  const db = new Database(dbPath, { readonly: true });

  const obs = db.query("SELECT COUNT(*) as c FROM observations WHERE project = ?").get(project);
  const prompts = db.query(
    `SELECT COUNT(*) as c FROM user_prompts up
     JOIN sdk_sessions s ON s.content_session_id = up.content_session_id
     WHERE s.project = ?`
  ).get(project);
  console.log(JSON.stringify({ observations: obs.c, prompts: prompts.c, project }));
  db.close();
} catch (e) {
  console.log(JSON.stringify({ observations: 0, prompts: 0, project, error: e.message }));
}
