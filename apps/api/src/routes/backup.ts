import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createDb } from "../plugins/db.js";

function backupDir(): string {
  return path.resolve(process.cwd(), "../../backups");
}

function ensureBackupDir() {
  fs.mkdirSync(backupDir(), { recursive: true });
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/backup/list", async () => {
    ensureBackupDir();
    const files = fs
      .readdirSync(backupDir())
      .filter((f) => f.endsWith(".db"))
      .map((f) => {
        const p = path.join(backupDir(), f);
        const st = fs.statSync(p);
        return { fileName: f, size: st.size, updatedAt: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return { files };
  });

  app.post("/api/backup/export", async () => {
    ensureBackupDir();
    const now = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `app-backup-${now}.db`;
    const filePath = path.join(backupDir(), fileName);

    await app.db.backup(filePath);

    return { ok: true, fileName, filePath };
  });

  app.post("/api/backup/restore", async (request, reply) => {
    const body = request.body as { fileName?: string; confirm?: string };
    if (!body?.fileName) {
      reply.code(400);
      return { error: "fileName is required" };
    }
    if (body.confirm !== "RESTORE") {
      reply.code(400);
      return { error: "confirm must be RESTORE" };
    }

    const fileName = safeFileName(body.fileName);
    const sourcePath = path.join(backupDir(), fileName);
    if (!fs.existsSync(sourcePath)) {
      reply.code(404);
      return { error: "backup file not found" };
    }

    const dbPath = app.dbPath;
    const tempPath = `${dbPath}.restore.tmp`;

    try {
      const src = new Database(sourcePath, { readonly: true });
      await src.backup(tempPath);
      src.close();

      app.db.close();
      fs.copyFileSync(tempPath, dbPath);
      fs.unlinkSync(tempPath);

      const reopened = createDb(dbPath);
      (app as unknown as { db: Database.Database }).db = reopened;

      return { ok: true, restoredFrom: fileName };
    } catch (e) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      reply.code(500);
      return { error: e instanceof Error ? e.message : "restore failed" };
    }
  });
}
