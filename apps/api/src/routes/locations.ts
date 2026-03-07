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

const updateLocationSchema = z.object({
  name: z.string().min(1).optional(),
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

  app.patch("/api/locations/:id", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const patch = updateLocationSchema.parse(request.body);

    const existing = app.db.prepare(`SELECT * FROM locations WHERE id = ?`).get(params.id) as
      | { id: number; name: string; alias: string | null; note: string | null; image_url: string | null; path: string | null }
      | undefined;

    if (!existing) {
      reply.code(404);
      return { error: "Location not found" };
    }

    const nextName = patch.name ?? existing.name;
    const pathParts = (existing.path ?? existing.name).split(" / ");
    pathParts[pathParts.length - 1] = nextName;
    const nextPath = pathParts.join(" / ");

    app.db
      .prepare(
        `UPDATE locations
         SET name=@name,
             alias=@alias,
             note=@note,
             image_url=@imageUrl,
             path=@path
         WHERE id=@id`
      )
      .run({
        id: params.id,
        name: nextName,
        alias: patch.alias !== undefined ? patch.alias : existing.alias,
        note: patch.note !== undefined ? patch.note : existing.note,
        imageUrl: patch.imageUrl !== undefined ? patch.imageUrl : existing.image_url,
        path: nextPath
      });

    const location = app.db.prepare(`SELECT * FROM locations WHERE id = ?`).get(params.id);
    return { location };
  });
}
