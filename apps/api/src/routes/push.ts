import type { FastifyInstance } from "fastify";

type WechatConfig = {
  provider: "serverchan" | "pushdeer";
  endpoint: string;
  token: string;
  enabled: boolean;
};

type Candidate = {
  todo_id: number;
  risk_type: string;
  detail: string;
  item_id: number;
  item_name: string;
  location: string | null;
};

function getDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getWechatConfig(app: FastifyInstance): WechatConfig | null {
  const row = app.db.prepare(`SELECT value FROM app_settings WHERE key = 'push.wechat.config'`).get() as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    const cfg = JSON.parse(row.value) as WechatConfig;
    if (cfg.enabled === false) return null;
    return cfg;
  } catch {
    return null;
  }
}

function queryDailyPushCandidates(app: FastifyInstance, dateKey: string): Candidate[] {
  return app.db
    .prepare(
      `SELECT
        t.id AS todo_id,
        r.risk_type,
        r.detail,
        i.id AS item_id,
        i.name AS item_name,
        i.location
       FROM todo_events t
       JOIN risk_events r ON r.id = t.risk_event_id
       JOIN items i ON i.id = r.item_id
       LEFT JOIN push_records p ON p.todo_event_id = t.id AND p.date_key = ? AND p.channel = 'wechat'
       WHERE t.handled_at IS NULL
         AND r.status = 'active'
         AND r.risk_type IN ('expired', 'low_stock')
         AND p.id IS NULL
       ORDER BY r.risk_type DESC, t.id DESC`
    )
    .all(dateKey) as Candidate[];
}

async function sendWechatMessage(cfg: WechatConfig, title: string, body: string): Promise<{ ok: boolean; status: number }> {
  if (cfg.provider === "serverchan") {
    const endpoint = cfg.endpoint.includes("{token}") ? cfg.endpoint.replaceAll("{token}", encodeURIComponent(cfg.token)) : cfg.endpoint;
    const payload = new URLSearchParams({ title, desp: body }).toString();
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload
    });
    return { ok: res.ok, status: res.status };
  }

  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pushkey: cfg.token, text: title, desp: body, type: "markdown" })
  });
  return { ok: res.ok, status: res.status };
}

export async function runDailyPush(app: FastifyInstance) {
  const cfg = getWechatConfig(app);
  if (!cfg) return { ok: false, reason: "not-configured", sentCount: 0 };

  const dateKey = getDateKey();
  const items = queryDailyPushCandidates(app, dateKey);
  const markSent = app.db.prepare(`INSERT OR IGNORE INTO push_records (date_key, todo_event_id, channel) VALUES (?, ?, 'wechat')`);
  const logStmt = app.db.prepare(
    `INSERT INTO push_delivery_logs (date_key, channel, todo_event_id, item_name, risk_type, status, detail, attempts)
     VALUES (?, 'wechat', ?, ?, ?, ?, ?, ?)`
  );

  let sentCount = 0;
  for (const it of items) {
    const title = `【家庭物品提醒】${it.item_name}`;
    const body = `风险类型：${it.risk_type}\n位置：${it.location ?? "未设置"}\n详情：${it.detail}`;

    let attempts = 0;
    let success = false;
    let lastStatus = 0;
    while (attempts < 2 && !success) {
      attempts += 1;
      try {
        const res = await sendWechatMessage(cfg, title, body);
        lastStatus = res.status;
        success = res.ok;
      } catch {
        success = false;
      }
    }

    logStmt.run(dateKey, it.todo_id, it.item_name, it.risk_type, success ? "success" : "failed", `http:${lastStatus}`, attempts);
    if (success) {
      markSent.run(dateKey, it.todo_id);
      sentCount += 1;
    }
  }

  app.db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('push.wechat.last_run_date', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
    )
    .run(dateKey);

  return { ok: true, dateKey, sentCount, total: items.length };
}

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/push/daily-preview", async () => {
    const dateKey = getDateKey();
    const configured = !!getWechatConfig(app);
    const items = configured ? queryDailyPushCandidates(app, dateKey) : [];
    return {
      dateKey,
      channel: "wechat",
      configured,
      count: items.length,
      items,
      note: configured ? "仅预览，不会写入发送记录" : "尚未配置微信推送"
    };
  });

  app.post("/api/push/daily-send", async (request, reply) => {
    const result = await runDailyPush(app);
    if (!result.ok) {
      reply.code(400);
      return { error: "微信推送尚未配置" };
    }
    return result;
  });

  app.get("/api/push/logs", async () => {
    const logs = app.db
      .prepare(
        `SELECT id, date_key, item_name, risk_type, status, detail, attempts, created_at
         FROM push_delivery_logs
         WHERE channel='wechat'
         ORDER BY id DESC
         LIMIT 200`
      )
      .all();
    return { logs };
  });
}
