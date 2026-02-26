import type { FastifyInstance } from "fastify";
import { z } from "zod";

type ParsedLine = {
  lineNo: number;
  raw: string;
  name: string;
  quantity: number;
  category: string | null;
  note: string | null;
  error: string | null;
};

function ensureCategory(app: FastifyInstance, name: string | null): number | null {
  if (!name) return null;
  const existing = app.db.prepare(`SELECT id FROM categories WHERE name = ?`).get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const r = app.db.prepare(`INSERT INTO categories (name) VALUES (?)`).run(name);
  return Number(r.lastInsertRowid);
}

function parseText(text: string): ParsedLine[] {
  const lines = text.split(/\r?\n/);
  const result: ParsedLine[] = [];

  lines.forEach((line, idx) => {
    const raw = line.trim();
    if (!raw) return;

    const cols = raw.split(/[，,]/).map((s) => s.trim());
    const name = cols[0] ?? "";
    const qRaw = cols[1] ?? "";
    const category = cols[2] ? cols[2] : null;
    const note = cols[3] ? cols[3] : null;

    let error: string | null = null;
    if (!name) error = "名称为空";

    let quantity = 1;
    if (qRaw) {
      const parsed = Number(qRaw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        error = error ? `${error}; 数量非法` : "数量非法";
      } else {
        quantity = parsed;
      }
    }

    result.push({
      lineNo: idx + 1,
      raw,
      name,
      quantity,
      category,
      note,
      error
    });
  });

  return result;
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/import/preview", async (request) => {
    const body = z.object({ text: z.string() }).parse(request.body);
    const rows = parseText(body.text);
    const successCount = rows.filter((r) => !r.error).length;
    const errorCount = rows.filter((r) => !!r.error).length;
    return { rows, successCount, errorCount };
  });

  app.post("/api/import/commit", async (request) => {
    const body = z.object({ text: z.string() }).parse(request.body);
    const rows = parseText(body.text);

    let success = 0;
    let failed = 0;

    const insert = app.db.prepare(
      `INSERT INTO items (name, category, category_id, quantity, note, remind_days, updated_at)
       VALUES (@name, @category, @categoryId, @quantity, @note, 7, datetime('now'))`
    );

    const tx = app.db.transaction(() => {
      for (const row of rows) {
        if (row.error) {
          failed += 1;
          continue;
        }
        const categoryId = ensureCategory(app, row.category);
        insert.run({
          name: row.name,
          category: row.category,
          categoryId,
          quantity: row.quantity,
          note: row.note
        });
        success += 1;
      }
    });

    tx();

    return {
      total: rows.length,
      success,
      failed,
      errors: rows.filter((r) => r.error).map((r) => ({ lineNo: r.lineNo, error: r.error, raw: r.raw }))
    };
  });
}
