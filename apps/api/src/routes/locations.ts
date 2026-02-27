import type { FastifyInstance } from "fastify";
import { z } from "zod";

const createLocationSchema = z.object({
  name: z.string().min(1),
  parentId: z.number().int().positive().nullable().optional(),
  level: z.number().int().min(1).max(3),
  alias: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional()
});

export async function locationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/locations", async () => {
    const rows = app.db
      .prepare(`SELECT id,parent_id,level,name,alias,note,image_url,path,created_at FROM locations ORDER BY level ASC, id ASC`)
      .all();
    return { locations: rows };
  });

  app.post("/api/locations", async (request, reply) => {
    const body = createLocationSchema.parse(request.body);

    let parentPath: string | null = null;
    if (body.parentId) {
      const parent = app.db.prepare(`SELECT id, path FROM locations WHERE id = ?`).get(body.parentId) as
        | { id: number; path: string | null }
        | undefined;
      if (!parent) {
        reply.code(400);
        return { error: "Parent location not found" };
      }
      parentPath = parent.path ?? null;
    }

    const path = parentPath ? `${parentPath} / ${body.name}` : body.name;

    const result = app.db
      .prepare(
        `INSERT INTO locations (parent_id, level, name, alias, note, image_url, path)
         VALUES (@parentId, @level, @name, @alias, @note, @imageUrl, @path)`
      )
      .run({
        parentId: body.parentId ?? null,
        level: body.level,
        name: body.name,
        alias: body.alias ?? null,
        note: body.note ?? null,
        imageUrl: body.imageUrl ?? null,
        path
      });

    const location = app.db.prepare(`SELECT * FROM locations WHERE id = ?`).get(result.lastInsertRowid);
    reply.code(201);
    return { location };
  });
}
