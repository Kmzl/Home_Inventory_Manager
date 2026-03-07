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

async function sendTestMessage(cfg: PushConfig) {
  const title = "Home Inventory 推送测试";
  const body = `测试时间：${new Date().toLocaleString("zh-CN")}`;

  if (cfg.provider === "serverchan") {
    const endpoint = cfg.endpoint.includes("{token}") ? cfg.endpoint.replaceAll("{token}", encodeURIComponent(cfg.token)) : cfg.endpoint;
    const payload = new URLSearchParams({ title, desp: body }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload,
      signal: controller.signal
    }).finally(() => clearTimeout(timer));
    return { ok: res.ok, status: res.status, provider: cfg.provider };
  }

  const endpoint = cfg.endpoint;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pushkey: cfg.token,
      text: title,
      desp: body,
      type: "markdown"
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timer));
  return { ok: res.ok, status: res.status, provider: cfg.provider };
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

  app.post("/api/push/config/test", async (request, reply) => {
    const body = z
      .object({
        provider: z.enum(["serverchan", "pushdeer"]).optional(),
        endpoint: z.string().url().optional(),
        token: z.string().min(1).optional(),
        useStored: z.boolean().optional()
      })
      .parse(request.body ?? {});

    const cfg = body.useStored ? getConfig(app) : null;
    const finalCfg: PushConfig | null = cfg
      ? cfg
      : body.provider && body.endpoint && body.token
      ? {
          provider: body.provider,
          endpoint: body.endpoint,
          token: body.token,
          enabled: true
        }
      : null;

    if (!finalCfg) {
      reply.code(400);
      return { error: "请先保存配置，或传入 provider/endpoint/token" };
    }

    try {
      const result = await sendTestMessage(finalCfg);
      if (!result.ok) {
        reply.code(400);
        return { message: "测试发送失败", ...result };
      }
      return { message: "测试发送成功", ...result };
    } catch (e) {
      reply.code(500);
      return { ok: false, error: e instanceof Error ? e.message : "unknown error" };
    }
  });
}
