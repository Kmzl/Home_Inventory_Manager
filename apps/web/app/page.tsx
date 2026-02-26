"use client";

import { FormEvent, useEffect, useState } from "react";

type Item = {
  id: number;
  name: string;
  category: string | null;
  location: string | null;
  quantity: number;
  note: string | null;
  deleted_at: string | null;
};

const API_BASE = "http://localhost:3001";

export default function HomePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [trash, setTrash] = useState<Item[]>([]);
  const [error, setError] = useState<string>("");
  const [form, setForm] = useState({ name: "", category: "", location: "", quantity: 1, note: "" });

  const loadData = async () => {
    try {
      setError("");
      const [activeRes, trashRes] = await Promise.all([
        fetch(`${API_BASE}/api/items`),
        fetch(`${API_BASE}/api/items/trash`)
      ]);
      if (!activeRes.ok || !trashRes.ok) throw new Error("加载数据失败");
      const activeJson = await activeRes.json();
      const trashJson = await trashRes.json();
      setItems(activeJson.items ?? []);
      setTrash(trashJson.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误");
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const createItem = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      setError("");
      const res = await fetch(`${API_BASE}/api/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          category: form.category || null,
          location: form.location || null,
          quantity: Number(form.quantity) || 1,
          note: form.note || null
        })
      });
      if (!res.ok) throw new Error("新增失败");
      setForm({ name: "", category: "", location: "", quantity: 1, note: "" });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误");
    }
  };

  const softDelete = async (id: number) => {
    if (!window.confirm("确认将该物品移入回收站？")) return;
    const res = await fetch(`${API_BASE}/api/items/${id}/delete`, { method: "POST" });
    if (!res.ok) {
      setError("删除失败");
      return;
    }
    await loadData();
  };

  const restore = async (id: number) => {
    const res = await fetch(`${API_BASE}/api/items/${id}/restore`, { method: "POST" });
    if (!res.ok) {
      setError("恢复失败");
      return;
    }
    await loadData();
  };

  return (
    <main style={{ padding: 24, display: "grid", gap: 20, maxWidth: 960, margin: "0 auto" }}>
      <h1>Home Inventory MVP</h1>
      {error ? <p style={{ color: "crimson" }}>错误：{error}</p> : null}

      <section>
        <h2>新增物品</h2>
        <form onSubmit={createItem} style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(5,1fr)" }}>
          <input placeholder="名称*" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="分类" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input placeholder="位置" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <input
            placeholder="数量"
            type="number"
            min={1}
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
          />
          <input placeholder="备注" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button style={{ gridColumn: "1 / -1" }} type="submit">创建</button>
        </form>
      </section>

      <section>
        <h2>在用物品 ({items.length})</h2>
        <ul>
          {items.map((item) => (
            <li key={item.id} style={{ marginBottom: 8 }}>
              <b>{item.name}</b> x {item.quantity}
              {item.category ? `｜${item.category}` : ""}
              {item.location ? `｜${item.location}` : ""}
              {item.note ? `｜${item.note}` : ""}
              <button style={{ marginLeft: 10 }} onClick={() => void softDelete(item.id)}>移入回收站</button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>回收站 ({trash.length})</h2>
        <ul>
          {trash.map((item) => (
            <li key={item.id}>
              <b>{item.name}</b>
              <button style={{ marginLeft: 10 }} onClick={() => void restore(item.id)}>恢复</button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
