import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    let dbOk = false;

    try {
      const row = app.db.prepare("SELECT 1 as ok").get() as { ok?: number };
      dbOk = row?.ok === 1;
    } catch {
      dbOk = false;
    }

    return { ok: true, dbOk };
  });
}
