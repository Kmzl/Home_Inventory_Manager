import type { FastifyInstance } from "fastify";
import { z } from "zod";

const createItemSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  primaryLocationId: z.number().int().positive().optional().nullable(),
  quantity: z.number().int().positive().default(1)
});

const updateItemSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  primaryLocationId: z.number().int().positive().optional().nullable(),
  quantity: z.number().int().positive().optional()
});

function ensureCategory(app: FastifyInstance, name: string | null | undefined): number | null {
  if (!name) return null;
  const existing = app.db.prepare(`SELECT id FROM categories WHERE name = ?`).get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const r = app.db.prepare(`INSERT INTO categories (name) VALUES (?)`).run(name);
  return Number(r.lastInsertRowid);
}

function syncPrimaryStock(app: FastifyInstance, itemId: number, locationId: number | null, quantity: number): void {
  if (!locationId) return;
  app.db
    .prepare(
      `INSERT INTO item_locations (item_id, location_id, quantity, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(item_id, location_id)
       DO UPDATE SET quantity=excluded.quantity, updated_at=datetime('now')`
    )
    .run(itemId, locationId, quantity);
}

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/items", async () => {
    const rows = app.db
      .prepare(
        `SELECT
          i.id,
          i.name,
          i.note,
          i.deleted_at,
          i.created_at,
          i.updated_at,
          c.name AS category,
          l.path AS location,
          COALESCE((SELECT SUM(il.quantity) FROM item_locations il WHERE il.item_id=i.id), i.quantity) AS quantity
        FROM items i
        LEFT JOIN categories c ON c.id = i.category_id
        LEFT JOIN locations l ON l.id = i.primary_location_id
        WHERE i.deleted_at IS NULL
        ORDER BY i.id DESC`
      )
      .all();
    return { items: rows };
  });

  app.get("/api/items/trash", async () => {
    const rows = app.db
      .prepare(
        `SELECT id,name,note,deleted_at,created_at,updated_at
         FROM items WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
      )
      .all();
    return { items: rows };
  });

  app.post("/api/items", async (request, reply) => {
    const body = createItemSchema.parse(request.body);
    const categoryId = ensureCategory(app, body.category ?? null);

    const locationPath = body.primaryLocationId
      ? (app.db.prepare(`SELECT path FROM locations WHERE id = ?`).get(body.primaryLocationId) as { path: string } | undefined)
          ?.path ?? null
      : null;

    const result = app.db
      .prepare(
        `INSERT INTO items (name, category, category_id, location, primary_location_id, quantity, note, updated_at)
         VALUES (@name,@category,@categoryId,@location,@primaryLocationId,@quantity,@note,datetime('now'))`
      )
      .run({
        name: body.name,
        category: body.category ?? null,
        categoryId,
        location: locationPath,
        primaryLocationId: body.primaryLocationId ?? null,
        quantity: body.quantity,
        note: body.note ?? null
      });

    const itemId = Number(result.lastInsertRowid);
    syncPrimaryStock(app, itemId, body.primaryLocationId ?? null, body.quantity);

    const item = app.db.prepare(`SELECT * FROM items WHERE id = ?`).get(itemId);
    reply.code(201);
    return { item };
  });

  app.patch("/api/items/:id", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const patch = updateItemSchema.parse(request.body);

    const existing = app.db.prepare(`SELECT * FROM items WHERE id = ?`).get(params.id) as
      | { id: number; name: string; category: string | null; note: string | null; quantity: number; primary_location_id: number | null; deleted_at: string | null }
      | undefined;

    if (!existing || existing.deleted_at) {
      reply.code(404);
      return { error: "Item not found" };
    }

    const nextCategory = patch.category !== undefined ? patch.category : existing.category;
    const categoryId = ensureCategory(app, nextCategory ?? null);
    const nextPrimary = patch.primaryLocationId !== undefined ? patch.primaryLocationId : existing.primary_location_id;
    const nextQty = patch.quantity ?? existing.quantity;

    const locationPath = nextPrimary
      ? (app.db.prepare(`SELECT path FROM locations WHERE id = ?`).get(nextPrimary) as { path: string } | undefined)?.path ?? null
      : null;

    app.db
      .prepare(
        `UPDATE items
         SET name=@name,
             category=@category,
             category_id=@categoryId,
             location=@location,
             primary_location_id=@primaryLocationId,
             quantity=@quantity,
             note=@note,
             updated_at=datetime('now')
         WHERE id=@id`
      )
      .run({
        id: params.id,
        name: patch.name ?? existing.name,
        category: nextCategory ?? null,
        categoryId,
        location: locationPath,
        primaryLocationId: nextPrimary ?? null,
        quantity: nextQty,
        note: patch.note !== undefined ? patch.note : existing.note
      });

    syncPrimaryStock(app, params.id, nextPrimary ?? null, nextQty);
    const item = app.db.prepare(`SELECT * FROM items WHERE id = ?`).get(params.id);
    return { item };
  });

  app.post("/api/items/:id/delete", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const res = app.db
      .prepare(`UPDATE items SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND deleted_at IS NULL`)
      .run(params.id);
    if (res.changes === 0) {
      reply.code(404);
      return { error: "Item not found" };
    }
    return { ok: true };
  });

  app.post("/api/items/:id/restore", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const res = app.db
      .prepare(`UPDATE items SET deleted_at=NULL, updated_at=datetime('now') WHERE id=? AND deleted_at IS NOT NULL`)
      .run(params.id);
    if (res.changes === 0) {
      reply.code(404);
      return { error: "Item not found" };
    }
    return { ok: true };
  });
}
