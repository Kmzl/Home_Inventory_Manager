import type { FastifyInstance } from "fastify";

function getDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function queryDailyPushCandidates(app: FastifyInstance, dateKey: string) {
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
    .all(dateKey);
}

function hasWechatConfig(app: FastifyInstance): boolean {
  const row = app.db.prepare(`SELECT value FROM app_settings WHERE key = 'push.wechat.config'`).get() as
    | { value: string }
    | undefined;
  if (!row) return false;
  try {
    const cfg = JSON.parse(row.value) as { enabled?: boolean };
    return cfg.enabled !== false;
  } catch {
    return false;
  }
}

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/push/daily-preview", async () => {
    const dateKey = getDateKey();
    const configured = hasWechatConfig(app);
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
    const configured = hasWechatConfig(app);
    if (!configured) {
      reply.code(400);
      return { error: "微信推送尚未配置" };
    }

    const dateKey = getDateKey();
    const items = queryDailyPushCandidates(app, dateKey) as Array<{ todo_id: number }>;

    const insert = app.db.prepare(
      `INSERT OR IGNORE INTO push_records (date_key, todo_event_id, channel) VALUES (?, ?, 'wechat')`
    );

    const tx = app.db.transaction(() => {
      for (const it of items) insert.run(dateKey, it.todo_id);
    });
    tx();

    return {
      ok: true,
      dateKey,
      channel: "wechat",
      sentCount: items.length,
      dedup: "same date + same todo_event_id will not be sent twice"
    };
  });
}
