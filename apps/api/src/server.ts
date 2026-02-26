import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { createDb, type DbInstance } from "./plugins/db.js";
import { healthRoutes } from "./routes/health.js";
import { itemRoutes } from "./routes/items.js";
import { locationRoutes } from "./routes/locations.js";
import { riskRoutes } from "./routes/risks.js";
import { importRoutes } from "./routes/import.js";
import { categoryRoutes } from "./routes/categories.js";
import { nfcRoutes } from "./routes/nfc.js";
import { pushRoutes } from "./routes/push.js";
import { aiSearchRoutes } from "./routes/ai-search.js";

export type BuildServerOptions = {
  databaseUrl: string;
};

declare module "fastify" {
  interface FastifyInstance {
    db: DbInstance;
  }
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: ["http://localhost:3000"]
  });

  const db = createDb(options.databaseUrl);
  app.decorate("db", db);

  app.addHook("onClose", async () => {
    app.db.close();
  });

  await app.register(healthRoutes);
  await app.register(locationRoutes);
  await app.register(itemRoutes);
  await app.register(riskRoutes);
  await app.register(importRoutes);
  await app.register(categoryRoutes);
  await app.register(nfcRoutes);
  await app.register(pushRoutes);
  await app.register(aiSearchRoutes);

  return app;
}
