import type { FastifyInstance } from "fastify";

type Candidate = {
  id: number;
  name: string;
  category: string | null;
  primary_location: string | null;
  primary_location_id: number | null;
  total_qty: number;
  locations: string[];
  confidence: number;
  reason: string;
};

function normalizeQuery(q: string): string {
  const stopwords = ["在哪", "在哪里", "在", "吗", "呢", "呀", "有", "有没有", "我", "帮我", "请", "一下", "找", "找到", "看看"];
  let s = q.toLowerCase().replace(/[？?！!。,.，]/g, " ").trim();
  for (const w of stopwords) s = s.replaceAll(w, " ");
  return s.replace(/\s+/g, " ").trim();
}

function scoreByKeyword(q: string, c: Candidate): { confidence: number; reason: string } {
  const text = `${c.name} ${c.category ?? ""} ${c.primary_location ?? ""} ${c.locations.join(" ")}`.toLowerCase();
  const query = normalizeQuery(q);

  if (!query) return { confidence: 0, reason: "空查询" };
  if (text.includes(query)) return { confidence: 0.92, reason: "核心词完全匹配" };

  const tokens = query.split(/\s+/).filter(Boolean);
  const hit = tokens.filter((t) => text.includes(t)).length;
  const ratio = tokens.length ? hit / tokens.length : 0;

  // 中文短词兜底：按字符覆盖
  const chars = [...query.replace(/\s+/g, "")].filter((x) => x.trim());
  const charHit = chars.filter((ch) => text.includes(ch)).length;
  const charRatio = chars.length ? charHit / chars.length : 0;

  if (ratio > 0.6 || charRatio > 0.8) return { confidence: 0.78, reason: "关键词高覆盖" };
  if (ratio > 0.2 || charRatio > 0.45) return { confidence: 0.58, reason: "关键词部分匹配" };
  return { confidence: 0.22, reason: "弱匹配" };
}

async function rerankWithOllama(query: string, candidates: Candidate[]) {
  const model = process.env.OLLAMA_MODEL || "qwen2.5:7b";
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

  const prompt = `你是家庭物品管理助手。根据用户提问，对候选物品按相关性打分并给简短原因。\n` +
    `返回严格 JSON 数组，元素字段: id(number), confidence(0-1), reason(string)。不要输出任何额外文本。\n` +
    `用户提问: ${query}\n` +
    `候选:\n${JSON.stringify(candidates.map((c) => ({ id: c.id, name: c.name, category: c.category, primary_location: c.primary_location, primary_location_id: c.primary_location_id, locations: c.locations })))}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false, format: "json" }),
    signal: controller.signal
  }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error("ollama request failed");
  const json = (await res.json()) as { response?: string };
  const parsed = JSON.parse(json.response || "[]") as Array<{ id: number; confidence: number; reason: string }>;
  return parsed;
}

export async function aiSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/ai/search", async (request, reply) => {
    const q = String((request.query as { q?: string }).q || "").trim();
    if (!q) {
      reply.code(400);
      return { error: "q is required" };
    }

    const base = app.db
      .prepare(
        `SELECT i.id, i.name, c.name AS category, l.path AS primary_location, i.primary_location_id,
                COALESCE((SELECT SUM(il.quantity) FROM item_locations il WHERE il.item_id=i.id), i.quantity) AS total_qty
         FROM items i
         LEFT JOIN categories c ON c.id=i.category_id
         LEFT JOIN locations l ON l.id=i.primary_location_id
         WHERE i.deleted_at IS NULL`
      )
      .all() as Array<{
        id: number;
        name: string;
        category: string | null;
        primary_location: string | null;
        primary_location_id: number | null;
        total_qty: number;
      }>;

    const candidates: Candidate[] = base.map((b) => {
      const locRows = app.db
        .prepare(
          `SELECT l.path FROM item_locations il JOIN locations l ON l.id=il.location_id WHERE il.item_id=? ORDER BY l.level ASC, l.path ASC`
        )
        .all(b.id) as Array<{ path: string | null }>;
      const locations = locRows.map((r) => r.path).filter((x): x is string => !!x);
      const s = scoreByKeyword(q, {
        ...b,
        locations,
        confidence: 0,
        reason: ""
      });
      return { ...b, locations, confidence: s.confidence, reason: s.reason };
    });

    let ranked = candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 12);
    let modelUsed = "keyword";

    try {
      const ai = await rerankWithOllama(q, ranked);
      const map = new Map(ai.map((x) => [x.id, x]));
      ranked = ranked
        .map((r) => {
          const rr = map.get(r.id);
          return rr ? { ...r, confidence: rr.confidence, reason: rr.reason } : r;
        })
        .sort((a, b) => b.confidence - a.confidence);
      modelUsed = process.env.OLLAMA_MODEL || "qwen2.5:7b";
    } catch {
      // fallback to keyword ranking
    }

    return {
      query: q,
      modelUsed,
      candidates: ranked.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        primaryLocation: r.primary_location,
        primaryLocationId: r.primary_location_id,
        otherLocations: r.locations.filter((l) => l !== r.primary_location),
        quantity: r.total_qty,
        confidence: Number(r.confidence.toFixed(2)),
        reason: r.reason
      }))
    };
  });
}
