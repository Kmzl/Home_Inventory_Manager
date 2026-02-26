import type { FastifyInstance } from "fastify";
import { z } from "zod";

const createItemSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  quantity: z.number().int().positive().default(1),
  note: z.string().optional().nullable()
});

const updateItemSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  quantity: z.number().int().positive().optional(),
  note: z.string().optional().nullable()
});

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/items", async () => {
    const rows = app.db
      .prepare(
        `SELECT id,name,category,location,quantity,note,created_at,updated_at,deleted_at
         FROM items WHERE deleted_at IS NULL ORDER BY id DESC`
      )
      .all();
    return { items: rows };
  });

  app.get("/api/items/trash", async () => {
    const rows = app.db
      .prepare(
        `SELECT id,name,category,location,quantity,note,created_at,updated_at,deleted_at
         FROM items WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
      )
      .all();
    return { items: rows };
  });

  app.post("/api/items", async (request, reply) => {
    const body = createItemSchema.parse(request.body);
    const stmt = app.db.prepare(
      `INSERT INTO items (name, category, location, quantity, note, updated_at)
       VALUES (@name,@category,@location,@quantity,@note,datetime('now'))`
    );
    const result = stmt.run(body);
    const item = app.db.prepare(`SELECT * FROM items WHERE id = ?`).get(result.lastInsertRowid);
    reply.code(201);
    return { item };
  });

  app.patch("/api/items/:id", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const patch = updateItemSchema.parse(request.body);
    const existing = app.db.prepare(`SELECT * FROM items WHERE id = ?`).get(params.id) as Record<string, unknown> | undefined;
    if (!existing || existing.deleted_at) {
      reply.code(404);
      return { error: "Item not found" };
    }

    const merged = {
      name: (patch.name ?? existing.name) as string,
      category: (patch.category ?? existing.category) as string | null,
      location: (patch.location ?? existing.location) as string | null,
      quantity: (patch.quantity ?? existing.quantity) as number,
      note: (patch.note ?? existing.note) as string | null,
      id: params.id
    };

    app.db
      .prepare(
        `UPDATE items SET
          name=@name,
          category=@category,
          location=@location,
          quantity=@quantity,
          note=@note,
          updated_at=datetime('now')
         WHERE id=@id`
      )
      .run(merged);

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
