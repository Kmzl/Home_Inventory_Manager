import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";

function backupRoot(): string {
  return path.resolve(process.cwd(), "../../backups");
}

function dateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function makeFileName(d = new Date()): string {
  return `app-backup-${d.toISOString().replace(/[:.]/g, "-")}.db`;
}

function pruneOldBackups(retentionDays: number) {
  fs.mkdirSync(backupRoot(), { recursive: true });
  const now = Date.now();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

  for (const f of fs.readdirSync(backupRoot())) {
    if (!f.endsWith(".db")) continue;
    const p = path.join(backupRoot(), f);
    const st = fs.statSync(p);
    if (now - st.mtimeMs > maxAgeMs) fs.unlinkSync(p);
  }
}

async function runOnceIfNeeded(app: FastifyInstance, retentionDays: number) {
  const today = dateKey();
  const lastRun = app.db
    .prepare(`SELECT value FROM app_settings WHERE key='backup.last_run_date'`)
    .get() as { value: string } | undefined;

  if (lastRun?.value === today) {
    pruneOldBackups(retentionDays);
    return { skipped: true, reason: "already-ran-today" };
  }

  fs.mkdirSync(backupRoot(), { recursive: true });
  const filePath = path.join(backupRoot(), makeFileName());
  await app.db.backup(filePath);

  app.db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('backup.last_run_date', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
    )
    .run(today);

  pruneOldBackups(retentionDays);
  return { skipped: false, filePath };
}

export function startBackupScheduler(app: FastifyInstance): NodeJS.Timeout {
  const hour = Number(process.env.BACKUP_DAILY_HOUR ?? 3);
  const minute = Number(process.env.BACKUP_DAILY_MINUTE ?? 0);
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 14);

  const timer = setInterval(async () => {
    const now = new Date();
    if (now.getHours() !== hour || now.getMinutes() !== minute) return;

    try {
      const result = await runOnceIfNeeded(app, retentionDays);
      app.log.info({ backupScheduler: true, result }, "daily backup check finished");
    } catch (e) {
      app.log.error({ err: e }, "daily backup failed");
    }
  }, 60 * 1000);

  // Also prune immediately on startup
  try {
    pruneOldBackups(retentionDays);
  } catch {
    // ignore
  }

  return timer;
}
