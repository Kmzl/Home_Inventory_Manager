import type { FastifyInstance } from "fastify";
import { z } from "zod";

const KEY = "push.wechat.config";

type PushConfig = {
  provider: "serverchan" | "pushdeer";
  endpoint: string;
  token: string;
  enabled: boolean;
};

function getConfig(app: FastifyInstance): PushConfig | null {
  const row = app.db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as PushConfig;
  } catch {
    return null;
  }
}

export async function pushConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/push/config", async () => {
    const cfg = getConfig(app);
    if (!cfg) return { configured: false, config: null };
    return {
      configured: true,
      config: {
        provider: cfg.provider,
        endpoint: cfg.endpoint,
        tokenMasked: cfg.token ? `${cfg.token.slice(0, 4)}***${cfg.token.slice(-3)}` : "",
        enabled: cfg.enabled
      }
    };
  });

  app.post("/api/push/config", async (request) => {
    const body = z
      .object({
        provider: z.enum(["serverchan", "pushdeer"]),
        endpoint: z.string().url(),
        token: z.string().min(1),
        enabled: z.boolean().default(true)
      })
      .parse(request.body);

    const cfg: PushConfig = {
      provider: body.provider,
      endpoint: body.endpoint,
      token: body.token,
      enabled: body.enabled
    };

    app.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
      )
      .run(KEY, JSON.stringify(cfg));

    return { ok: true };
  });
}
