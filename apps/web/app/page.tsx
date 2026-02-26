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
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", category: "", location: "", quantity: 1, note: "" });

  const loadData = async () => {
    try {
      setError("");
      const [activeRes, trashRes] = await Promise.all([
        fetch(`${API_BASE}/api/items`),
        fetch(`${API_BASE}/api/items/trash`)
      ]);
      if (!activeRes.ok || !trashRes.ok) throw new Error("加载数据失败，请确认 API 已启动");
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
    if (!res.ok) return setError("删除失败");
    await loadData();
  };

  const restore = async (id: number) => {
    const res = await fetch(`${API_BASE}/api/items/${id}/restore`, { method: "POST" });
    if (!res.ok) return setError("恢复失败");
    await loadData();
  };

  return (
    <main className="page">
      <header className="header card">
        <h1>🏠 Home Inventory MVP</h1>
        <p>家庭物品管理（本地版）— 支持新增、查看、软删除和回收站恢复</p>
      </header>

      {error ? <p className="error">错误：{error}</p> : null}

      <section className="card">
        <h2>新增物品</h2>
        <form className="form-grid" onSubmit={createItem}>
          <input placeholder="名称*" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="分类（如：电器）" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input placeholder="位置（如：客厅柜）" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <input type="number" min={1} placeholder="数量" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
          <input placeholder="备注" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button className="full" type="submit">创建物品</button>
        </form>
      </section>

      <section className="card">
        <h2>在用物品（{items.length}）</h2>
        {items.length === 0 ? (
          <p className="empty">暂无在用物品，先新增一条吧。</p>
        ) : (
          <ul className="list">
            {items.map((item) => (
              <li className="item-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong> × {item.quantity}
                  <div className="item-meta">
                    {[item.category, item.location, item.note].filter(Boolean).join(" ｜ ") || "无附加信息"}
                  </div>
                </div>
                <button className="danger" onClick={() => void softDelete(item.id)}>移入回收站</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>回收站（{trash.length}）</h2>
        {trash.length === 0 ? (
          <p className="empty">回收站为空。</p>
        ) : (
          <ul className="list">
            {trash.map((item) => (
              <li className="item-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <div className="item-meta">已删除，可恢复</div>
                </div>
                <button className="secondary" onClick={() => void restore(item.id)}>恢复</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
