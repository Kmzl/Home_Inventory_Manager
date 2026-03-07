import type { FastifyInstance } from "fastify";
import { z } from "zod";

export async function nfcRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/locations/:id/items", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

    const location = app.db
      .prepare(`SELECT id, name, path, level FROM locations WHERE id = ?`)
      .get(params.id) as { id: number; name: string; path: string; level: number } | undefined;

    if (!location) {
      reply.code(404);
      return { error: "Location not found" };
    }

    const items = app.db
      .prepare(
        `SELECT
          i.id,
          i.name,
          c.name AS category,
          il.quantity,
          i.note,
          i.deleted_at
         FROM item_locations il
         JOIN items i ON i.id = il.item_id
         LEFT JOIN categories c ON c.id = i.category_id
         WHERE il.location_id = ?
           AND i.deleted_at IS NULL
         ORDER BY i.name ASC`
      )
      .all(params.id);

    return { location, items };
  });
}
