import type { FastifyInstance } from "fastify";
import { z } from "zod";

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/categories", async () => {
    const categories = app.db
      .prepare(
        `SELECT c.id, c.name, c.sort_order,
                (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id AND i.deleted_at IS NULL) AS item_count
         FROM categories c
         ORDER BY c.sort_order ASC, c.id ASC`
      )
      .all();
    return { categories };
  });

  app.post("/api/categories", async (request, reply) => {
    const body = z.object({ name: z.string().min(1) }).parse(request.body);
    const r = app.db.prepare(`INSERT INTO categories (name) VALUES (?)`).run(body.name);
    const category = app.db.prepare(`SELECT * FROM categories WHERE id = ?`).get(r.lastInsertRowid);
    reply.code(201);
    return { category };
  });

  app.patch("/api/categories/:id", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        sortOrder: z.number().int().optional()
      })
      .parse(request.body);

    const existing = app.db.prepare(`SELECT * FROM categories WHERE id=?`).get(params.id) as
      | { id: number; name: string; sort_order: number }
      | undefined;
    if (!existing) {
      reply.code(404);
      return { error: "Category not found" };
    }

    app.db
      .prepare(`UPDATE categories SET name=?, sort_order=? WHERE id=?`)
      .run(body.name ?? existing.name, body.sortOrder ?? existing.sort_order, params.id);

    const category = app.db.prepare(`SELECT * FROM categories WHERE id=?`).get(params.id);
    return { category };
  });

  app.delete("/api/categories/:id", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const count = app.db
      .prepare(`SELECT COUNT(*) AS c FROM items WHERE category_id = ? AND deleted_at IS NULL`)
      .get(params.id) as { c: number };

    if (count.c > 0) {
      reply.code(400);
      return { error: "分类下仍有物品，无法删除" };
    }

    const res = app.db.prepare(`DELETE FROM categories WHERE id=?`).run(params.id);
    if (res.changes === 0) {
      reply.code(404);
      return { error: "Category not found" };
    }
    return { ok: true };
  });
}
