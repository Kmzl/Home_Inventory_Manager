import type { FastifyInstance } from "fastify";

export async function pushStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/push/status", async () => {
    const cfgRow = app.db.prepare(`SELECT value, updated_at FROM app_settings WHERE key='push.wechat.config'`).get() as
      | { value: string; updated_at: string }
      | undefined;

    let configured = false;
    let enabled = false;
    let provider: string | null = null;
    let configUpdatedAt: string | null = null;

    if (cfgRow) {
      configured = true;
      configUpdatedAt = cfgRow.updated_at;
      try {
        const cfg = JSON.parse(cfgRow.value) as { provider?: string; enabled?: boolean };
        provider = cfg.provider ?? null;
        enabled = cfg.enabled !== false;
      } catch {
        enabled = false;
      }
    }

    const lastRun = app.db
      .prepare(`SELECT value, updated_at FROM app_settings WHERE key='push.wechat.last_run_date'`)
      .get() as { value: string; updated_at: string } | undefined;

    const lastLog = app.db
      .prepare(
        `SELECT date_key, item_name, risk_type, status, attempts, created_at
         FROM push_delivery_logs
         WHERE channel='wechat'
         ORDER BY id DESC
         LIMIT 1`
      )
      .get() as
      | { date_key: string; item_name: string | null; risk_type: string | null; status: string; attempts: number; created_at: string }
      | undefined;

    const pendingToday = app.db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM todo_events t
         JOIN risk_events r ON r.id = t.risk_event_id
         LEFT JOIN push_records p ON p.todo_event_id = t.id AND p.date_key = date('now') AND p.channel='wechat'
         WHERE t.handled_at IS NULL
           AND r.status='active'
           AND r.risk_type IN ('expired','low_stock')
           AND p.id IS NULL`
      )
      .get() as { c: number };

    return {
      configured,
      enabled,
      provider,
      configUpdatedAt,
      scheduler: {
        dailyHour: Number(process.env.PUSH_DAILY_HOUR ?? 9),
        dailyMinute: Number(process.env.PUSH_DAILY_MINUTE ?? 0)
      },
      lastRun: lastRun ? { dateKey: lastRun.value, at: lastRun.updated_at } : null,
      lastDelivery: lastLog ?? null,
      pendingToday: pendingToday.c
    };
  });
}
