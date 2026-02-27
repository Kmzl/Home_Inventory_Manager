import type { FastifyInstance } from "fastify";
import { z } from "zod";

const createItemSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  primaryLocationId: z.number().int().positive().optional().nullable(),
  quantity: z.number().int().positive().default(1),
  expiryDate: z.string().optional().nullable(),
  openedAt: z.string().optional().nullable(),
  validDaysAfterOpen: z.number().int().positive().optional().nullable(),
  remindDays: z.number().int().positive().optional().nullable(),
  lowStockThreshold: z.number().int().min(0).optional().nullable(),
  imageUrl: z.string().optional().nullable()
});

const updateItemSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  primaryLocationId: z.number().int().positive().optional().nullable(),
  quantity: z.number().int().positive().optional(),
  expiryDate: z.string().optional().nullable(),
  openedAt: z.string().optional().nullable(),
  validDaysAfterOpen: z.number().int().positive().optional().nullable(),
  remindDays: z.number().int().positive().optional().nullable(),
  lowStockThreshold: z.number().int().min(0).optional().nullable(),
  imageUrl: z.string().optional().nullable()
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
          i.image_url,
          i.deleted_at,
          i.created_at,
          i.updated_at,
          c.name AS category,
          COALESCE(c.sort_order, 999999) AS category_sort_order,
          l.path AS location,
          COALESCE((SELECT SUM(il.quantity) FROM item_locations il WHERE il.item_id=i.id), i.quantity) AS quantity,
          COALESCE((
            SELECT MAX(
              CASE re.risk_type
                WHEN 'expired' THEN 3
                WHEN 'expiring_soon' THEN 2
                WHEN 'low_stock' THEN 1
                ELSE 0
              END
            )
            FROM risk_events re
            WHERE re.item_id = i.id AND re.status = 'active'
          ), 0) AS risk_priority
        FROM items i
        LEFT JOIN categories c ON c.id = i.category_id
        LEFT JOIN locations l ON l.id = i.primary_location_id
        WHERE i.deleted_at IS NULL
        ORDER BY category_sort_order ASC, COALESCE(c.name, '未分类') ASC, risk_priority DESC, i.id DESC`
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
        `INSERT INTO items (
          name, category, category_id, location, primary_location_id, quantity, note, image_url,
          expiry_date, opened_at, valid_days_after_open, remind_days, low_stock_threshold,
          updated_at
        )
         VALUES (
          @name,@category,@categoryId,@location,@primaryLocationId,@quantity,@note,@imageUrl,
          @expiryDate,@openedAt,@validDaysAfterOpen,@remindDays,@lowStockThreshold,
          datetime('now')
         )`
      )
      .run({
        name: body.name,
        category: body.category ?? null,
        categoryId,
        location: locationPath,
        primaryLocationId: body.primaryLocationId ?? null,
        quantity: body.quantity,
        note: body.note ?? null,
        imageUrl: body.imageUrl ?? null,
        expiryDate: body.expiryDate ?? null,
        openedAt: body.openedAt ?? null,
        validDaysAfterOpen: body.validDaysAfterOpen ?? null,
        remindDays: body.remindDays ?? 7,
        lowStockThreshold: body.lowStockThreshold ?? null
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
      | {
          id: number;
          name: string;
          category: string | null;
          note: string | null;
          quantity: number;
          primary_location_id: number | null;
          deleted_at: string | null;
          expiry_date: string | null;
          opened_at: string | null;
          valid_days_after_open: number | null;
          remind_days: number;
          low_stock_threshold: number | null;
          image_url: string | null;
        }
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
             expiry_date=@expiryDate,
             opened_at=@openedAt,
             valid_days_after_open=@validDaysAfterOpen,
             remind_days=@remindDays,
             low_stock_threshold=@lowStockThreshold,
             image_url=@imageUrl,
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
        note: patch.note !== undefined ? patch.note : existing.note,
        expiryDate: patch.expiryDate !== undefined ? patch.expiryDate : existing.expiry_date,
        openedAt: patch.openedAt !== undefined ? patch.openedAt : existing.opened_at,
        validDaysAfterOpen:
          patch.validDaysAfterOpen !== undefined ? patch.validDaysAfterOpen : existing.valid_days_after_open,
        remindDays: patch.remindDays !== undefined ? patch.remindDays : existing.remind_days,
        lowStockThreshold:
          patch.lowStockThreshold !== undefined ? patch.lowStockThreshold : existing.low_stock_threshold,
        imageUrl: patch.imageUrl !== undefined ? patch.imageUrl : existing.image_url
      });

    syncPrimaryStock(app, params.id, nextPrimary ?? null, nextQty);
    const item = app.db.prepare(`SELECT * FROM items WHERE id = ?`).get(params.id);
    return { item };
  });

  app.get("/api/items/:id/locations", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const exists = app.db.prepare(`SELECT id FROM items WHERE id = ?`).get(params.id) as { id: number } | undefined;
    if (!exists) {
      reply.code(404);
      return { error: "Item not found" };
    }

    const locations = app.db
      .prepare(
        `SELECT il.location_id, il.quantity, l.path, l.level
         FROM item_locations il
         JOIN locations l ON l.id = il.location_id
         WHERE il.item_id = ?
         ORDER BY l.level ASC, l.path ASC`
      )
      .all(params.id);
    return { locations };
  });

  app.post("/api/items/:id/locations", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const body = z.object({ locationId: z.number().int().positive(), quantity: z.number().int().min(0) }).parse(request.body);

    const item = app.db.prepare(`SELECT id, primary_location_id FROM items WHERE id = ?`).get(params.id) as
      | { id: number; primary_location_id: number | null }
      | undefined;
    if (!item) {
      reply.code(404);
      return { error: "Item not found" };
    }

    const loc = app.db.prepare(`SELECT id, path FROM locations WHERE id = ?`).get(body.locationId) as
      | { id: number; path: string }
      | undefined;
    if (!loc) {
      reply.code(400);
      return { error: "Location not found" };
    }

    app.db
      .prepare(
        `INSERT INTO item_locations (item_id, location_id, quantity, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(item_id, location_id)
         DO UPDATE SET quantity=excluded.quantity, updated_at=datetime('now')`
      )
      .run(params.id, body.locationId, body.quantity);

    if (!item.primary_location_id) {
      app.db
        .prepare(`UPDATE items SET primary_location_id=?, location=?, updated_at=datetime('now') WHERE id=?`)
        .run(body.locationId, loc.path, params.id);
    }

    const total = app.db
      .prepare(`SELECT COALESCE(SUM(quantity),0) AS total FROM item_locations WHERE item_id = ?`)
      .get(params.id) as { total: number };
    app.db.prepare(`UPDATE items SET quantity=?, updated_at=datetime('now') WHERE id=?`).run(total.total, params.id);

    return { ok: true };
  });

  app.post("/api/items/:id/primary-location", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const body = z.object({ locationId: z.number().int().positive() }).parse(request.body);

    const distribution = app.db
      .prepare(`SELECT il.location_id, l.path FROM item_locations il JOIN locations l ON l.id=il.location_id WHERE il.item_id=? AND il.location_id=?`)
      .get(params.id, body.locationId) as { location_id: number; path: string } | undefined;

    if (!distribution) {
      reply.code(400);
      return { error: "Location is not in item's distribution" };
    }

    app.db
      .prepare(`UPDATE items SET primary_location_id=?, location=?, updated_at=datetime('now') WHERE id=?`)
      .run(body.locationId, distribution.path, params.id);

    return { ok: true };
  });

  app.delete("/api/items/:id/locations/:locationId", async (request, reply) => {
    const params = z
      .object({ id: z.coerce.number().int().positive(), locationId: z.coerce.number().int().positive() })
      .parse(request.params);

    const res = app.db.prepare(`DELETE FROM item_locations WHERE item_id=? AND location_id=?`).run(params.id, params.locationId);
    if (res.changes === 0) {
      reply.code(404);
      return { error: "Distribution not found" };
    }

    const total = app.db
      .prepare(`SELECT COALESCE(SUM(quantity),0) AS total FROM item_locations WHERE item_id = ?`)
      .get(params.id) as { total: number };
    app.db.prepare(`UPDATE items SET quantity=?, updated_at=datetime('now') WHERE id=?`).run(total.total, params.id);

    const item = app.db.prepare(`SELECT primary_location_id FROM items WHERE id=?`).get(params.id) as
      | { primary_location_id: number | null }
      | undefined;
    if (item?.primary_location_id === params.locationId) {
      const fallback = app.db
        .prepare(`SELECT il.location_id, l.path FROM item_locations il JOIN locations l ON l.id=il.location_id WHERE il.item_id=? LIMIT 1`)
        .get(params.id) as { location_id: number; path: string } | undefined;
      app.db
        .prepare(`UPDATE items SET primary_location_id=?, location=?, updated_at=datetime('now') WHERE id=?`)
        .run(fallback?.location_id ?? null, fallback?.path ?? null, params.id);
    }

    return { ok: true };
  });

  app.get("/api/items/stale", async () => {
    const rows = app.db
      .prepare(
        `SELECT
          i.id,
          i.name,
          i.location,
          i.last_confirmed_at,
          i.created_at,
          CAST((julianday('now') - julianday(COALESCE(i.last_confirmed_at, i.created_at))) AS INTEGER) AS stale_days
         FROM items i
         WHERE i.deleted_at IS NULL
           AND (julianday('now') - julianday(COALESCE(i.last_confirmed_at, i.created_at))) >= 180
         ORDER BY stale_days DESC`
      )
      .all();
    return { items: rows };
  });

  app.post("/api/items/:id/confirm", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const res = app.db
      .prepare(`UPDATE items SET last_confirmed_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND deleted_at IS NULL`)
      .run(params.id);
    if (res.changes === 0) {
      reply.code(404);
      return { error: "Item not found" };
    }
    return { ok: true };
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

  app.delete("/api/items/:id/permanent", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const res = app.db.prepare(`DELETE FROM items WHERE id=? AND deleted_at IS NOT NULL`).run(params.id);
    if (res.changes === 0) {
      reply.code(404);
      return { error: "Item not found or not in trash" };
    }
    return { ok: true };
  });
}
