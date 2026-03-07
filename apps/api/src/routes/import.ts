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
    const body = z
      .object({
        text: z.string(),
        mode: z.enum(["accumulate", "skip", "new"]).optional(),
        primaryLocationId: z.number().int().positive().optional().nullable()
      })
      .parse(request.body);
    const rows = parseText(body.text);
    const successCount = rows.filter((r) => !r.error).length;
    const errorCount = rows.filter((r) => !!r.error).length;
    return { rows, successCount, errorCount, mode: body.mode ?? "accumulate", primaryLocationId: body.primaryLocationId ?? null };
  });

  app.post("/api/import/commit", async (request) => {
    const body = z
      .object({
        text: z.string(),
        mode: z.enum(["accumulate", "skip", "new"]).default("accumulate"),
        primaryLocationId: z.number().int().positive().optional().nullable()
      })
      .parse(request.body);
    const rows = parseText(body.text);

    let success = 0;
    let failed = 0;
    let skipped = 0;

    const locationPath = body.primaryLocationId
      ? (app.db.prepare(`SELECT path FROM locations WHERE id = ?`).get(body.primaryLocationId) as { path: string } | undefined)?.path ?? null
      : null;

    const insert = app.db.prepare(
      `INSERT INTO items (name, category, category_id, primary_location_id, location, quantity, note, remind_days, updated_at)
       VALUES (@name, @category, @categoryId, @primaryLocationId, @location, @quantity, @note, 7, datetime('now'))`
    );
    const update = app.db.prepare(
      `UPDATE items
       SET quantity = quantity + @delta,
           note = COALESCE(@note, note),
           primary_location_id = COALESCE(@primaryLocationId, primary_location_id),
           location = COALESCE(@location, location),
           updated_at = datetime('now')
       WHERE id = @id`
    );

    const upsertDistribution = app.db.prepare(
      `INSERT INTO item_locations (item_id, location_id, quantity, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(item_id, location_id)
       DO UPDATE SET quantity=item_locations.quantity + excluded.quantity, updated_at=datetime('now')`
    );

    const tx = app.db.transaction(() => {
      for (const row of rows) {
        if (row.error) {
          failed += 1;
          continue;
        }

        const categoryId = ensureCategory(app, row.category);
        const existing = app.db
          .prepare(`SELECT id FROM items WHERE deleted_at IS NULL AND name = ? AND (category_id IS ? OR category_id = ?)`)
          .get(row.name, categoryId, categoryId) as { id: number } | undefined;

        if (existing && body.mode === "skip") {
          skipped += 1;
          continue;
        }

        if (existing && body.mode === "accumulate") {
          update.run({
            id: existing.id,
            delta: row.quantity,
            note: row.note,
            primaryLocationId: body.primaryLocationId ?? null,
            location: locationPath
          });
          if (body.primaryLocationId) upsertDistribution.run(existing.id, body.primaryLocationId, row.quantity);
          success += 1;
          continue;
        }

        const inserted = insert.run({
          name: row.name,
          category: row.category,
          categoryId,
          primaryLocationId: body.primaryLocationId ?? null,
          location: locationPath,
          quantity: row.quantity,
          note: row.note
        });
        const itemId = Number(inserted.lastInsertRowid);
        if (body.primaryLocationId) upsertDistribution.run(itemId, body.primaryLocationId, row.quantity);
        success += 1;
      }
    });

    tx();

    return {
      total: rows.length,
      mode: body.mode,
      success,
      skipped,
      failed,
      errors: rows.filter((r) => r.error).map((r) => ({ lineNo: r.lineNo, error: r.error, raw: r.raw }))
    };
  });
}
