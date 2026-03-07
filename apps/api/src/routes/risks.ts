import type { FastifyInstance } from "fastify";

type RiskType = "expired" | "expiring_soon" | "low_stock" | "stale";

type ItemRow = {
  id: number;
  name: string;
  expiry_date: string | null;
  opened_at: string | null;
  valid_days_after_open: number | null;
  remind_days: number;
  low_stock_threshold: number | null;
  last_confirmed_at: string | null;
  created_at: string;
  quantity: number;
};

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function detectRisks(item: ItemRow): Array<{ type: RiskType; detail: string }> {
  const now = new Date();
  const risks: Array<{ type: RiskType; detail: string }> = [];

  let expiryDate: Date | null = null;
  if (item.expiry_date) {
    expiryDate = new Date(item.expiry_date);
  } else if (item.opened_at && item.valid_days_after_open) {
    const opened = new Date(item.opened_at);
    expiryDate = new Date(opened.getTime() + item.valid_days_after_open * 24 * 60 * 60 * 1000);
  }

  if (expiryDate) {
    const d = daysBetween(expiryDate, now);
    if (d < 0) risks.push({ type: "expired", detail: `已过期 ${Math.abs(d)} 天` });
    else if (d <= (item.remind_days ?? 7)) risks.push({ type: "expiring_soon", detail: `${d} 天后到期` });
  }

  if (item.low_stock_threshold !== null && item.quantity <= item.low_stock_threshold) {
    risks.push({ type: "low_stock", detail: `库存 ${item.quantity} ≤ 阈值 ${item.low_stock_threshold}` });
  }

  const anchor = new Date(item.last_confirmed_at ?? item.created_at);
  const staleDays = daysBetween(now, anchor);
  if (staleDays >= 180) risks.push({ type: "stale", detail: `${staleDays} 天未确认` });

  return risks;
}

function refreshRiskSnapshot(app: FastifyInstance) {
  const items = app.db
    .prepare(
      `SELECT i.*, COALESCE((SELECT SUM(il.quantity) FROM item_locations il WHERE il.item_id=i.id), i.quantity) AS quantity
       FROM items i WHERE i.deleted_at IS NULL`
    )
    .all() as ItemRow[];

  const activeSet = new Set<string>();

  for (const item of items) {
    const risks = detectRisks(item);

    for (const risk of risks) {
      const key = `${item.id}:${risk.type}`;
      activeSet.add(key);
      app.db
        .prepare(
          `INSERT INTO risk_events (item_id, risk_type, status, detail, last_detected_at, resolved_at)
           VALUES (?, ?, 'active', ?, datetime('now'), NULL)
           ON CONFLICT(item_id, risk_type)
           DO UPDATE SET status='active', detail=excluded.detail, last_detected_at=datetime('now'), resolved_at=NULL`
        )
        .run(item.id, risk.type, risk.detail);

      if (risk.type === "expired" || risk.type === "expiring_soon" || risk.type === "low_stock") {
        const riskRow = app.db
          .prepare(`SELECT id FROM risk_events WHERE item_id = ? AND risk_type = ?`)
          .get(item.id, risk.type) as { id: number };
        app.db.prepare(`INSERT OR IGNORE INTO todo_events (risk_event_id) VALUES (?)`).run(riskRow.id);
      }
    }
  }

  const allActive = app.db
    .prepare(`SELECT item_id, risk_type FROM risk_events WHERE status = 'active'`)
    .all() as Array<{ item_id: number; risk_type: string }>;

  for (const r of allActive) {
    if (!activeSet.has(`${r.item_id}:${r.risk_type}`)) {
      app.db
        .prepare(`UPDATE risk_events SET status='resolved', resolved_at=datetime('now') WHERE item_id=? AND risk_type=?`)
        .run(r.item_id, r.risk_type);
    }
  }
}

export async function riskRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/risks", async () => {
    refreshRiskSnapshot(app);
    const risks = app.db
      .prepare(
        `SELECT r.id, r.risk_type, r.status, r.detail, r.last_detected_at, i.id AS item_id, i.name AS item_name, i.location
         FROM risk_events r
         JOIN items i ON i.id = r.item_id
         WHERE r.status = 'active'
         ORDER BY r.last_detected_at DESC`
      )
      .all();
    return { risks };
  });

  app.get("/api/todos", async () => {
    refreshRiskSnapshot(app);
    const todos = app.db
      .prepare(
        `SELECT t.id, t.handled_at, r.risk_type, r.detail, i.id AS item_id, i.name AS item_name, i.location
         FROM todo_events t
         JOIN risk_events r ON r.id = t.risk_event_id
         JOIN items i ON i.id = r.item_id
         WHERE t.handled_at IS NULL AND r.status = 'active'
         ORDER BY t.id DESC`
      )
      .all();
    return { todos };
  });

  app.post("/api/todos/:id/handled", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const res = app.db.prepare(`UPDATE todo_events SET handled_at=datetime('now') WHERE id=?`).run(id);
    if (res.changes === 0) {
      reply.code(404);
      return { error: "Todo not found" };
    }
    return { ok: true };
  });
}
