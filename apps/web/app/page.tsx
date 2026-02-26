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

type Risk = {
  id: number;
  risk_type: string;
  detail: string;
  item_name: string;
  location: string | null;
};

type Todo = {
  id: number;
  risk_type: string;
  detail: string;
  item_name: string;
  location: string | null;
  handled_at: string | null;
};

type LocationItem = {
  id: number;
  parent_id: number | null;
  level: number;
  name: string;
  path: string | null;
};

const API_BASE = "http://localhost:3001";

export default function HomePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [trash, setTrash] = useState<Item[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"active" | "trash">("active");
  const [showForm, setShowForm] = useState(true);
  const [locationForm, setLocationForm] = useState({ name: "", level: 1, parentId: "" });
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  const [itemLocations, setItemLocations] = useState<Record<number, Array<{ location_id: number; quantity: number; path: string | null }>>>({});
  const [distForm, setDistForm] = useState<{ itemId: number; locationId: string; quantity: string } | null>(null);
  const [form, setForm] = useState({
    name: "",
    category: "",
    location: "",
    quantity: 1,
    note: "",
    expiryDate: "",
    openedAt: "",
    validDaysAfterOpen: "",
    remindDays: "7",
    lowStockThreshold: "",
    primaryLocationId: ""
  });

  const loadData = async () => {
    try {
      setError("");
      const [activeRes, trashRes, risksRes, todosRes, locationsRes] = await Promise.all([
        fetch(`${API_BASE}/api/items`),
        fetch(`${API_BASE}/api/items/trash`),
        fetch(`${API_BASE}/api/risks`),
        fetch(`${API_BASE}/api/todos`),
        fetch(`${API_BASE}/api/locations`)
      ]);
      if (!activeRes.ok || !trashRes.ok || !risksRes.ok || !todosRes.ok || !locationsRes.ok) {
        throw new Error("加载数据失败，请确认 API 已启动");
      }

      const activeJson = await activeRes.json();
      const trashJson = await trashRes.json();
      const risksJson = await risksRes.json();
      const todosJson = await todosRes.json();
      const locationsJson = await locationsRes.json();
      setItems(activeJson.items ?? []);
      setTrash(trashJson.items ?? []);
      setRisks(risksJson.risks ?? []);
      setTodos(todosJson.todos ?? []);
      setLocations(locationsJson.locations ?? []);
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
          note: form.note || null,
          expiryDate: form.expiryDate || null,
          openedAt: form.openedAt || null,
          validDaysAfterOpen: form.validDaysAfterOpen ? Number(form.validDaysAfterOpen) : null,
          remindDays: form.remindDays ? Number(form.remindDays) : 7,
          lowStockThreshold: form.lowStockThreshold ? Number(form.lowStockThreshold) : null,
          primaryLocationId: form.primaryLocationId ? Number(form.primaryLocationId) : null
        })
      });
      if (!res.ok) throw new Error("新增失败");
      setForm({
        name: "",
        category: "",
        location: "",
        quantity: 1,
        note: "",
        expiryDate: "",
        openedAt: "",
        validDaysAfterOpen: "",
        remindDays: "7",
        lowStockThreshold: "",
        primaryLocationId: ""
      });
      setShowForm(false);
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

  const markTodoHandled = async (id: number) => {
    const res = await fetch(`${API_BASE}/api/todos/${id}/handled`, { method: "POST" });
    if (!res.ok) return setError("标记失败");
    await loadData();
  };

  const loadItemDistribution = async (itemId: number) => {
    const res = await fetch(`${API_BASE}/api/items/${itemId}/locations`);
    if (!res.ok) return setError("加载分布失败");
    const json = await res.json();
    setItemLocations((prev) => ({ ...prev, [itemId]: json.locations ?? [] }));
  };

  const addDistribution = async (e: FormEvent) => {
    e.preventDefault();
    if (!distForm) return;
    const res = await fetch(`${API_BASE}/api/items/${distForm.itemId}/locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: Number(distForm.locationId),
        quantity: Number(distForm.quantity || 0)
      })
    });
    if (!res.ok) return setError("添加分布失败");
    await loadData();
    await loadItemDistribution(distForm.itemId);
    setDistForm({ itemId: distForm.itemId, locationId: "", quantity: "1" });
  };

  const removeDistribution = async (itemId: number, locationId: number) => {
    const res = await fetch(`${API_BASE}/api/items/${itemId}/locations/${locationId}`, { method: "DELETE" });
    if (!res.ok) return setError("删除分布失败");
    await loadData();
    await loadItemDistribution(itemId);
  };

  const createLocation = async (e: FormEvent) => {
    e.preventDefault();
    if (!locationForm.name.trim()) return;

    const res = await fetch(`${API_BASE}/api/locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: locationForm.name,
        level: Number(locationForm.level),
        parentId: locationForm.parentId ? Number(locationForm.parentId) : null
      })
    });

    if (!res.ok) return setError("创建位置失败");
    setLocationForm({ name: "", level: 1, parentId: "" });
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
        <h2>位置管理（{locations.length}）</h2>
        <form className="form-grid" onSubmit={createLocation}>
          <input placeholder="位置名称*" value={locationForm.name} onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })} />
          <select value={locationForm.level} onChange={(e) => setLocationForm({ ...locationForm, level: Number(e.target.value) })}>
            <option value={1}>一级（房间）</option>
            <option value={2}>二级（柜子）</option>
            <option value={3}>三级（抽屉/盒子）</option>
          </select>
          <select value={locationForm.parentId} onChange={(e) => setLocationForm({ ...locationForm, parentId: e.target.value })}>
            <option value="">无父级</option>
            {locations
              .filter((l) => l.level < Number(locationForm.level))
              .map((l) => (
                <option key={l.id} value={String(l.id)}>{l.path || l.name}</option>
              ))}
          </select>
          <button className="full" type="submit">新增位置</button>
        </form>
        <ul className="list" style={{ marginTop: 10 }}>
          {locations.map((l) => (
            <li className="item-row" key={l.id}>
              <div>
                <strong>L{l.level}</strong> · {l.path || l.name}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>待处理中心（{todos.length}）</h2>
        {todos.length === 0 ? (
          <p className="empty">暂无待处理风险。</p>
        ) : (
          <ul className="list">
            {todos.map((todo) => (
              <li className="item-row" key={todo.id}>
                <div>
                  <strong>{todo.item_name}</strong>
                  <div className="item-meta">
                    {todo.risk_type} ｜ {todo.detail}
                    {todo.location ? ` ｜ ${todo.location}` : ""}
                  </div>
                </div>
                <button className="secondary" onClick={() => void markTodoHandled(todo.id)}>标记已处理</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>风险快照（{risks.length}）</h2>
        {risks.length === 0 ? (
          <p className="empty">当前没有激活风险。</p>
        ) : (
          <ul className="list">
            {risks.map((risk) => (
              <li className="item-row" key={risk.id}>
                <div>
                  <strong>{risk.item_name}</strong>
                  <div className="item-meta">
                    {risk.risk_type} ｜ {risk.detail}
                    {risk.location ? ` ｜ ${risk.location}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>新增物品</h2>
          <button className="secondary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "收起" : "展开"}
          </button>
        </div>
        {showForm ? (
          <form className="form-grid" onSubmit={createItem}>
            <input placeholder="名称*" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="分类（如：电器）" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <select value={form.primaryLocationId} onChange={(e) => setForm({ ...form, primaryLocationId: e.target.value })}>
              <option value="">主位置（可选）</option>
              {locations.map((l) => (
                <option key={l.id} value={String(l.id)}>{l.path || l.name}</option>
              ))}
            </select>
            <input type="number" min={1} placeholder="数量" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            <input placeholder="备注" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <input type="date" placeholder="到期日" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            <input type="date" placeholder="开封日" value={form.openedAt} onChange={(e) => setForm({ ...form, openedAt: e.target.value })} />
            <input placeholder="开封后有效天数" type="number" min={1} value={form.validDaysAfterOpen} onChange={(e) => setForm({ ...form, validDaysAfterOpen: e.target.value })} />
            <input placeholder="提前提醒天数" type="number" min={1} value={form.remindDays} onChange={(e) => setForm({ ...form, remindDays: e.target.value })} />
            <input placeholder="低库存阈值" type="number" min={0} value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} />
            <button className="full" type="submit">创建物品</button>
          </form>
        ) : null}
      </section>

      <section className="card">
        <div className="segmented" role="tablist" aria-label="列表切换">
          <button className={tab === "active" ? "seg active" : "seg"} onClick={() => setTab("active")}>在用物品（{items.length}）</button>
          <button className={tab === "trash" ? "seg active" : "seg"} onClick={() => setTab("trash")}>回收站（{trash.length}）</button>
        </div>

        {tab === "active" ? (
          items.length === 0 ? (
            <p className="empty">暂无在用物品，先新增一条吧。</p>
          ) : (
            <ul className="list">
              {items.map((item) => (
                <li className="item-row" key={item.id}>
                  <div style={{ width: "100%" }}>
                    <strong>{item.name}</strong> × {item.quantity}
                    <div className="item-meta">{[item.category, item.location, item.note].filter(Boolean).join(" ｜ ") || "无附加信息"}</div>

                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        className="secondary"
                        onClick={() => {
                          const next = expandedItemId === item.id ? null : item.id;
                          setExpandedItemId(next);
                          if (next) {
                            void loadItemDistribution(item.id);
                            setDistForm({ itemId: item.id, locationId: "", quantity: "1" });
                          }
                        }}
                      >
                        {expandedItemId === item.id ? "收起分布" : "展开分布"}
                      </button>
                      <button className="danger" onClick={() => void softDelete(item.id)}>移入回收站</button>
                    </div>

                    {expandedItemId === item.id ? (
                      <div style={{ marginTop: 10, borderTop: "1px dashed #ddd", paddingTop: 10 }}>
                        <div className="item-meta" style={{ marginBottom: 8 }}>多位置库存分布</div>
                        <ul className="list">
                          {(itemLocations[item.id] ?? []).map((d) => (
                            <li className="item-row" key={`${item.id}-${d.location_id}`}>
                              <div>{d.path || `位置#${d.location_id}`} × {d.quantity}</div>
                              <button className="danger" onClick={() => void removeDistribution(item.id, d.location_id)}>删除</button>
                            </li>
                          ))}
                        </ul>
                        <form className="form-grid" onSubmit={addDistribution} style={{ marginTop: 8 }}>
                          <select
                            value={distForm?.itemId === item.id ? distForm.locationId : ""}
                            onChange={(e) =>
                              setDistForm({ itemId: item.id, locationId: e.target.value, quantity: distForm?.quantity ?? "1" })
                            }
                          >
                            <option value="">选择位置</option>
                            {locations.map((l) => (
                              <option key={l.id} value={String(l.id)}>{l.path || l.name}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={0}
                            value={distForm?.itemId === item.id ? distForm.quantity : "1"}
                            onChange={(e) =>
                              setDistForm({ itemId: item.id, locationId: distForm?.locationId ?? "", quantity: e.target.value })
                            }
                          />
                          <button className="full" type="submit">添加/更新分布</button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : trash.length === 0 ? (
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

      <button className="fab" onClick={() => setShowForm(true)} aria-label="新增物品">＋</button>
    </main>
  );
}
