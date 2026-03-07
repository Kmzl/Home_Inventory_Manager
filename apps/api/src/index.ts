import { buildServer } from "./server.js";
import { loadEnv } from "./plugins/env.js";

async function start(): Promise<void> {
  const env = loadEnv();
  const app = await buildServer({ databaseUrl: env.DATABASE_URL });

  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.PORT
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
