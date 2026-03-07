"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type LocationData = { id: number; name: string; path: string; level: number };
type ItemData = { id: number; name: string; category: string | null; quantity: number; note: string | null };

const API_BASE = "http://localhost:3001";

export default function NfcLocationPage() {
  const params = useParams<{ locationId: string }>();
  const locationId = useMemo(() => Number(params.locationId), [params.locationId]);
  const [location, setLocation] = useState<LocationData | null>(null);
  const [items, setItems] = useState<ItemData[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const run = async () => {
      if (!Number.isFinite(locationId) || locationId <= 0) return setError("无效的 locationId");
      const res = await fetch(`${API_BASE}/api/locations/${locationId}/items`);
      if (!res.ok) return setError("位置不存在或加载失败");
      const json = await res.json();
      setLocation(json.location ?? null);
      setItems(json.items ?? []);
    };
    void run();
  }, [locationId]);

  return (
    <main className="page">
      <section className="card">
        <h1>📍 NFC 位置入口</h1>
        {error ? <p className="error">{error}</p> : null}
        {location ? (
          <p className="item-meta">
            位置：<strong>{location.path || location.name}</strong>（L{location.level}）
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>该位置物品（{items.length}）</h2>
        {items.length === 0 ? (
          <p className="empty">该位置暂无物品。</p>
        ) : (
          <ul className="list">
            {items.map((item) => (
              <li key={item.id} className="item-row">
                <div>
                  <strong>{item.name}</strong> × {item.quantity}
                  <div className="item-meta">{[item.category, item.note].filter(Boolean).join(" ｜ ") || "无附加信息"}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
