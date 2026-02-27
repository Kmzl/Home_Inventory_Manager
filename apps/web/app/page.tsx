"use client";

import { FormEvent, useEffect, useState } from "react";

type Item = {
  id: number;
  name: string;
  category: string | null;
  location: string | null;
  quantity: number;
  note: string | null;
  image_url?: string | null;
  deleted_at: string | null;
  category_sort_order?: number;
  risk_priority?: number;
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
  image_url?: string | null;
};

type ImportRow = {
  lineNo: number;
  raw: string;
  name: string;
  quantity: number;
  category: string | null;
  note: string | null;
  error: string | null;
};

type StaleItem = {
  id: number;
  name: string;
  location: string | null;
  stale_days: number;
  last_confirmed_at: string | null;
};

type CategoryItem = {
  id: number;
  name: string;
  sort_order: number;
  item_count: number;
};

const API_BASE =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : "http://localhost:3001";

export default function HomePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [trash, setTrash] = useState<Item[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"active" | "trash">("active");
  const [showForm, setShowForm] = useState(true);
  const [locationForm, setLocationForm] = useState({ name: "", level: 1, parentId: "", imageUrl: "" });
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  const [itemLocations, setItemLocations] = useState<Record<number, Array<{ location_id: number; quantity: number; path: string | null }>>>({});
  const [distForm, setDistForm] = useState<{ itemId: number; locationId: string; quantity: string } | null>(null);
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"accumulate" | "skip" | "new">("accumulate");
  const [importLocationId, setImportLocationId] = useState("");
  const [importPreview, setImportPreview] = useState<ImportRow[]>([]);
  const [importStats, setImportStats] = useState<{ successCount: number; errorCount: number } | null>(null);
  const [staleItems, setStaleItems] = useState<StaleItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [pushPreview, setPushPreview] = useState<Array<{ todo_id: number; risk_type: string; item_name: string; location: string | null; detail: string }>>([]);
  const [aiQuery, setAiQuery] = useState("");
  const [aiResults, setAiResults] = useState<Array<{ id: number; name: string; primaryLocation: string | null; primaryLocationId: number | null; otherLocations: string[]; confidence: number; reason: string }>>([]);
  const [aiModel, setAiModel] = useState("");
  const [pushStatus, setPushStatus] = useState<{
    configured: boolean;
    enabled: boolean;
    provider: string | null;
    pendingToday: number;
    scheduler: { dailyHour: number; dailyMinute: number };
    lastRun: { dateKey: string; at: string } | null;
    lastDelivery: { status: string; item_name: string | null; risk_type: string | null; created_at: string } | null;
  } | null>(null);
  const [backups, setBackups] = useState<Array<{ fileName: string; size: number; updatedAt: string }>>([]);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
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
    primaryLocationId: "",
    imageUrl: ""
  });

  const uploadImageFile = async (file: File, targetType: "item" | "location") => {
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const img = new Image();
      const fr = new FileReader();
      fr.onload = () => {
        img.onload = () => {
          const maxW = 1600;
          const scale = Math.min(1, maxW / img.width);
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("图片处理失败"));
          ctx.drawImage(img, 0, 0, w, h);
          const out = canvas.toDataURL("image/jpeg", 0.78);
          const base64 = out.includes(",") ? out.split(",")[1] : out;
          resolve(base64);
        };
        img.onerror = () => reject(new Error("图片读取失败"));
        img.src = String(fr.result || "");
      };
      fr.onerror = () => reject(new Error("图片读取失败"));
      fr.readAsDataURL(file);
    });

    const res = await fetch(`${API_BASE}/api/upload-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || "image/jpeg",
        dataBase64,
        targetType
      })
    });
    if (!res.ok) throw new Error("图片上传失败");
    const json = await res.json();
    return String(json.url || "");
  };

  const loadData = async () => {
    try {
      setError("");
      const [activeRes, trashRes, risksRes, todosRes, locationsRes, staleRes, categoriesRes, pushStatusRes, backupRes] = await Promise.all([
        fetch(`${API_BASE}/api/items`),
        fetch(`${API_BASE}/api/items/trash`),
        fetch(`${API_BASE}/api/risks`),
        fetch(`${API_BASE}/api/todos`),
        fetch(`${API_BASE}/api/locations`),
        fetch(`${API_BASE}/api/items/stale`),
        fetch(`${API_BASE}/api/categories`),
        fetch(`${API_BASE}/api/push/status`),
        fetch(`${API_BASE}/api/backup/list`)
      ]);
      if (!activeRes.ok || !trashRes.ok || !risksRes.ok || !todosRes.ok || !locationsRes.ok || !staleRes.ok || !categoriesRes.ok || !pushStatusRes.ok || !backupRes.ok) {
        throw new Error("加载数据失败，请确认 API 已启动");
      }

      const activeJson = await activeRes.json();
      const trashJson = await trashRes.json();
      const risksJson = await risksRes.json();
      const todosJson = await todosRes.json();
      const locationsJson = await locationsRes.json();
      const staleJson = await staleRes.json();
      const categoriesJson = await categoriesRes.json();
      const pushStatusJson = await pushStatusRes.json();
      const backupJson = await backupRes.json();
      setItems(activeJson.items ?? []);
      setTrash(trashJson.items ?? []);
      setRisks(risksJson.risks ?? []);
      setTodos(todosJson.todos ?? []);
      setLocations(locationsJson.locations ?? []);
      setStaleItems(staleJson.items ?? []);
      setCategories(categoriesJson.categories ?? []);
      setPushStatus(pushStatusJson ?? null);
      setBackups(backupJson.files ?? []);
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
          primaryLocationId: form.primaryLocationId ? Number(form.primaryLocationId) : null,
          imageUrl: form.imageUrl || null
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
        primaryLocationId: "",
        imageUrl: ""
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

  const permanentDelete = async (id: number) => {
    if (!window.confirm("确认永久删除？该操作不可恢复。")) return;
    const res = await fetch(`${API_BASE}/api/items/${id}/permanent`, { method: "DELETE" });
    if (!res.ok) return setError("永久删除失败");
    await loadData();
  };

  const markTodoHandled = async (id: number) => {
    const res = await fetch(`${API_BASE}/api/todos/${id}/handled`, { method: "POST" });
    if (!res.ok) return setError("标记失败");
    await loadData();
  };

  const confirmStaleItem = async (id: number) => {
    const res = await fetch(`${API_BASE}/api/items/${id}/confirm`, { method: "POST" });
    if (!res.ok) return setError("确认失败");
    await loadData();
  };

  const createCategory = async () => {
    if (!newCategoryName.trim()) return;
    const res = await fetch(`${API_BASE}/api/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCategoryName })
    });
    if (!res.ok) return setError("创建分类失败");
    setNewCategoryName("");
    await loadData();
  };

  const renameCategory = async (id: number, oldName: string) => {
    const name = window.prompt("输入新分类名", oldName);
    if (!name || name.trim() === oldName) return;
    const res = await fetch(`${API_BASE}/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() })
    });
    if (!res.ok) return setError("重命名失败");
    await loadData();
  };

  const updateCategorySort = async (id: number, current: number) => {
    const v = window.prompt("输入排序值（整数，越小越前）", String(current));
    if (!v) return;
    const sortOrder = Number(v);
    if (!Number.isInteger(sortOrder)) return setError("排序值必须是整数");
    const res = await fetch(`${API_BASE}/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder })
    });
    if (!res.ok) return setError("更新排序失败");
    await loadData();
  };

  const deleteCategory = async (id: number) => {
    if (!window.confirm("确认删除该分类？若有物品引用将失败。")) return;
    const res = await fetch(`${API_BASE}/api/categories/${id}`, { method: "DELETE" });
    if (!res.ok) return setError("删除失败：分类下可能仍有物品");
    await loadData();
  };

  const previewDailyPush = async () => {
    const res = await fetch(`${API_BASE}/api/push/daily-preview`);
    if (!res.ok) return setError("加载推送预览失败");
    const json = await res.json();
    setPushPreview(json.items ?? []);
  };

  const simulateDailySend = async () => {
    if (!window.confirm("执行今日推送模拟？会写入去重记录。")) return;
    const res = await fetch(`${API_BASE}/api/push/daily-send`, { method: "POST" });
    if (!res.ok) return setError("推送模拟失败");
    const json = await res.json();
    await loadData();
    alert(`今日写入发送记录 ${json.sentCount} 条`);
  };

  const runAiSearch = async () => {
    if (!aiQuery.trim()) return;
    const res = await fetch(`${API_BASE}/api/ai/search?q=${encodeURIComponent(aiQuery)}`);
    if (!res.ok) return setError("AI 搜索失败");
    const json = await res.json();
    setAiModel(json.modelUsed || "");
    setAiResults(json.candidates || []);
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

  const setPrimaryLocation = async (itemId: number, locationId: number) => {
    const res = await fetch(`${API_BASE}/api/items/${itemId}/primary-location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId })
    });
    if (!res.ok) return setError("设置主位置失败");
    await loadData();
    await loadItemDistribution(itemId);
  };

  const previewImport = async () => {
    if (!importText.trim()) return;
    const res = await fetch(`${API_BASE}/api/import/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: importText,
        mode: importMode,
        primaryLocationId: importLocationId ? Number(importLocationId) : null
      })
    });
    if (!res.ok) return setError("预览失败");
    const json = await res.json();
    setImportPreview(json.rows ?? []);
    setImportStats({ successCount: json.successCount ?? 0, errorCount: json.errorCount ?? 0 });
  };

  const commitImport = async () => {
    if (!importText.trim()) return;
    const res = await fetch(`${API_BASE}/api/import/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: importText,
        mode: importMode,
        primaryLocationId: importLocationId ? Number(importLocationId) : null
      })
    });
    if (!res.ok) return setError("导入失败");
    const json = await res.json();
    setImportText("");
    setImportPreview([]);
    setImportStats(null);
    await loadData();
    alert(`导入完成：成功 ${json.success} 条，跳过 ${json.skipped ?? 0} 条，失败 ${json.failed} 条`);
  };

  const createBackup = async () => {
    const res = await fetch(`${API_BASE}/api/backup/export`, { method: "POST" });
    if (!res.ok) return setError("创建备份失败");
    await loadData();
  };

  const restoreBackup = async (fileName: string) => {
    const confirmed = window.prompt(`输入 RESTORE 确认恢复备份：${fileName}`);
    if (confirmed !== "RESTORE") return;
    const res = await fetch(`${API_BASE}/api/backup/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, confirm: "RESTORE" })
    });
    if (!res.ok) return setError("恢复失败，请检查日志");
    await loadData();
    alert("恢复完成，建议刷新页面确认数据状态。");
  };

  const updateItemImage = async (itemId: number, imageUrl: string | null) => {
    const res = await fetch(`${API_BASE}/api/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl })
    });
    if (!res.ok) return setError("更新物品图片失败");
    await loadData();
  };

  const updateLocationImage = async (locationId: number, imageUrl: string | null) => {
    const res = await fetch(`${API_BASE}/api/locations/${locationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl })
    });
    if (!res.ok) return setError("更新位置图片失败");
    await loadData();
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
        parentId: locationForm.parentId ? Number(locationForm.parentId) : null,
        imageUrl: locationForm.imageUrl || null
      })
    });

    if (!res.ok) return setError("创建位置失败");
    setLocationForm({ name: "", level: 1, parentId: "", imageUrl: "" });
    await loadData();
  };

  const groupedItems = items.reduce<Record<string, Item[]>>((acc, item) => {
    const key = item.category || "未分类";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <main className="page">
      <header className="header card">
        <h1>🏠 Home Inventory MVP</h1>
        <p>家庭物品管理（本地版）— 支持新增、查看、软删除和回收站恢复</p>
        <div style={{ marginTop: 10 }}>
          <a href="/push-config" target="_blank" rel="noreferrer">
            <button className="secondary">打开微信推送配置页</button>
          </a>
        </div>
      </header>

      {error ? <p className="error">错误：{error}</p> : null}

      <section className="card">
        <h2>推送状态</h2>
        {pushStatus ? (
          <>
            <p className="item-meta">
              配置：{pushStatus.configured ? "已配置" : "未配置"} ｜ 启用：{String(pushStatus.enabled)} ｜ 通道：{pushStatus.provider || "-"}
            </p>
            <p className="item-meta">
              每日执行时间：{String(pushStatus.scheduler.dailyHour).padStart(2, "0")}:{String(pushStatus.scheduler.dailyMinute).padStart(2, "0")} ｜ 今日待推送：{pushStatus.pendingToday}
            </p>
            <p className="item-meta">
              最近运行：{pushStatus.lastRun ? `${pushStatus.lastRun.dateKey} (${pushStatus.lastRun.at})` : "暂无"}
            </p>
            <p className="item-meta">
              最近投递：
              {pushStatus.lastDelivery
                ? `${pushStatus.lastDelivery.status} / ${pushStatus.lastDelivery.item_name || "-"} / ${pushStatus.lastDelivery.risk_type || "-"}`
                : "暂无"}
            </p>
            <div style={{ marginTop: 8 }}>
              <a href="/push-config" target="_blank" rel="noreferrer">
                <button className="secondary">打开推送配置与日志</button>
              </a>
            </div>
          </>
        ) : (
          <p className="empty">状态加载中...</p>
        )}
      </section>

      <section className="card">
        <h2>备份与恢复</h2>
        <p className="item-meta">系统每天自动创建 1 份备份，并仅保留最近 14 天；你也可以手动立即备份。</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button className="secondary" onClick={() => void createBackup()}>立即创建备份</button>
        </div>
        {backups.length === 0 ? (
          <p className="empty">暂无备份文件。</p>
        ) : (
          <ul className="list">
            {backups.map((b) => (
              <li className="item-row" key={b.fileName}>
                <div>
                  <strong>{b.fileName}</strong>
                  <div className="item-meta">{(b.size / 1024).toFixed(1)} KB ｜ {b.updatedAt}</div>
                </div>
                <button className="danger" onClick={() => void restoreBackup(b.fileName)}>恢复此备份</button>
              </li>
            ))}
          </ul>
        )}
      </section>

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
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const url = await uploadImageFile(f, "location");
                setLocationForm((prev) => ({ ...prev, imageUrl: url }));
              } catch (err) {
                setError(err instanceof Error ? err.message : "位置图片上传失败");
              }
            }}
          />
          {locationForm.imageUrl ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <img
                src={`${API_BASE}${locationForm.imageUrl}`}
                alt="位置预览"
                style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, cursor: "zoom-in" }}
                onClick={() => setPreviewImageUrl(`${API_BASE}${locationForm.imageUrl}`)}
              />
              <button className="danger" type="button" onClick={() => setLocationForm((p) => ({ ...p, imageUrl: "" }))}>移除图片</button>
            </div>
          ) : null}
          <button className="full" type="submit">新增位置</button>
        </form>
        <ul className="list" style={{ marginTop: 10 }}>
          {locations.map((l) => (
            <li className="item-row" key={l.id}>
              <div>
                {l.image_url ? (
                  <img
                    src={`${API_BASE}${l.image_url}`}
                    alt={l.name}
                    style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, marginRight: 8, cursor: "zoom-in" }}
                    onClick={() => setPreviewImageUrl(`${API_BASE}${l.image_url}`)}
                  />
                ) : null}
                <strong>L{l.level}</strong> · {l.path || l.name}
                <div className="item-meta">NFC URL: /nfc/{l.id}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const url = await uploadImageFile(f, "location");
                      await updateLocationImage(l.id, url);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "位置图片上传失败");
                    }
                  }}
                />
                {l.image_url ? (
                  <button className="danger" onClick={() => void updateLocationImage(l.id, null)}>移除图</button>
                ) : null}
                <a href={`/nfc/${l.id}`} target="_blank" rel="noreferrer">
                  <button className="secondary">打开 NFC 页</button>
                </a>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>分类管理（{categories.length}）</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder="新分类名" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} />
          <button onClick={() => void createCategory()}>新增分类</button>
        </div>
        <ul className="list" style={{ marginTop: 10 }}>
          {categories.map((c) => (
            <li className="item-row" key={c.id}>
              <div>
                <strong>{c.name}</strong>
                <div className="item-meta">排序: {c.sort_order} ｜ 物品数: {c.item_count}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="secondary" onClick={() => void renameCategory(c.id, c.name)}>重命名</button>
                <button className="secondary" onClick={() => void updateCategorySort(c.id, c.sort_order)}>排序</button>
                <button className="danger" onClick={() => void deleteCategory(c.id)}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>批量导入</h2>
        <p className="item-meta">每行：名称,数量,分类,备注（支持中英文逗号，数量可缺省默认1）</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <select value={importMode} onChange={(e) => setImportMode(e.target.value as "accumulate" | "skip" | "new") }>
            <option value="accumulate">重复项累加数量</option>
            <option value="skip">重复项跳过</option>
            <option value="new">重复项仍新增</option>
          </select>
          <select value={importLocationId} onChange={(e) => setImportLocationId(e.target.value)}>
            <option value="">导入主位置（可选）</option>
            {locations.map((l) => (
              <option key={l.id} value={String(l.id)}>{l.path || l.name}</option>
            ))}
          </select>
        </div>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={6}
          placeholder={`牙线,10,日用品,补货\n维生素C,2,保健,早餐后\n螺丝刀,,工具,十字`}
          style={{ width: "100%", borderRadius: 10, border: "1px solid #e5e7eb", padding: 10, marginTop: 8 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="secondary" onClick={() => void previewImport()}>预览</button>
          <button onClick={() => void commitImport()}>执行导入</button>
        </div>

        {importStats ? (
          <p className="item-meta" style={{ marginTop: 8 }}>
            预览结果：可导入 {importStats.successCount} 条，错误 {importStats.errorCount} 条
          </p>
        ) : null}

        {importPreview.length > 0 ? (
          <ul className="list" style={{ marginTop: 8 }}>
            {importPreview.map((r) => (
              <li key={r.lineNo} className="item-row">
                <div>
                  <strong>第 {r.lineNo} 行</strong>：{r.raw}
                  <div className="item-meta">
                    {r.error ? `错误：${r.error}` : `解析：${r.name} × ${r.quantity}${r.category ? ` ｜ ${r.category}` : ""}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
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
        <h2>AI 辅助搜索（Ollama）</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="例如：螺丝刀在哪？"
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runAiSearch();
            }}
          />
          <button onClick={() => void runAiSearch()}>搜索</button>
        </div>
        {aiModel ? <p className="item-meta" style={{ marginTop: 8 }}>模型：{aiModel}</p> : null}
        {aiResults.length > 0 ? (
          <ul className="list" style={{ marginTop: 8 }}>
            {aiResults.map((r) => (
              <li className="item-row" key={r.id}>
                <div>
                  <strong>{r.name}</strong>
                  <div className="item-meta">
                    主位置：{r.primaryLocation || "未设置"}
                    {r.otherLocations?.length ? ` ｜ 其他位置：${r.otherLocations.join("、")}` : ""}
                    {` ｜ 置信度：${Math.round(r.confidence * 100)}%`}
                  </div>
                  <div className="item-meta">原因：{r.reason}</div>
                </div>
                {r.primaryLocationId ? (
                  <a href={`/nfc/${r.primaryLocationId}`} target="_blank" rel="noreferrer">
                    <button className="secondary">直达位置</button>
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty" style={{ marginTop: 8 }}>输入问题后开始搜索。</p>
        )}
      </section>

      <section className="card">
        <h2>微信推送（日报模拟）</h2>
        <p className="item-meta">规则：仅未处理且激活中的「已过期 / 库存紧张」，每日同事项只推一次。</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button className="secondary" onClick={() => void previewDailyPush()}>预览今日推送</button>
          <button onClick={() => void simulateDailySend()}>写入发送记录</button>
        </div>
        {pushPreview.length === 0 ? (
          <p className="empty">暂无可推送事项（或尚未点击预览）。</p>
        ) : (
          <ul className="list">
            {pushPreview.map((p) => (
              <li className="item-row" key={p.todo_id}>
                <div>
                  <strong>{p.item_name}</strong>
                  <div className="item-meta">{p.risk_type} ｜ {p.detail}{p.location ? ` ｜ ${p.location}` : ""}</div>
                </div>
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
        <h2>久未使用（{staleItems.length}）</h2>
        {staleItems.length === 0 ? (
          <p className="empty">暂无超过 180 天未确认的物品。</p>
        ) : (
          <ul className="list">
            {staleItems.map((item) => (
              <li className="item-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <div className="item-meta">
                    {item.location ? `${item.location} ｜ ` : ""}
                    {item.stale_days} 天未确认
                  </div>
                </div>
                <button className="secondary" onClick={() => void confirmStaleItem(item.id)}>确认在用</button>
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
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const url = await uploadImageFile(f, "item");
                  setForm((prev) => ({ ...prev, imageUrl: url }));
                } catch (err) {
                  setError(err instanceof Error ? err.message : "物品图片上传失败");
                }
              }}
            />
            {form.imageUrl ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <img
                  src={`${API_BASE}${form.imageUrl}`}
                  alt="物品预览"
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, cursor: "zoom-in" }}
                  onClick={() => setPreviewImageUrl(`${API_BASE}${form.imageUrl}`)}
                />
                <button className="danger" type="button" onClick={() => setForm((p) => ({ ...p, imageUrl: "" }))}>移除图片</button>
              </div>
            ) : null}
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
            <div style={{ display: "grid", gap: 12 }}>
              {Object.entries(groupedItems).map(([category, group]) => (
                <div key={category}>
                  <div className="item-meta" style={{ marginBottom: 6 }}>
                    <strong>{category}</strong>
                  </div>
                  <ul className="list">
                    {group.map((item) => (
                      <li className="item-row" key={item.id}>
                        <div style={{ width: "100%" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {item.image_url ? (
                              <img
                                src={`${API_BASE}${item.image_url}`}
                                alt={item.name}
                                style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, cursor: "zoom-in" }}
                                onClick={() => setPreviewImageUrl(`${API_BASE}${item.image_url}`)}
                              />
                            ) : null}
                            <strong>{item.name}</strong> × {item.quantity}
                          </div>
                          <div className="item-meta">
                            {[
                              item.risk_priority === 3
                                ? "已过期"
                                : item.risk_priority === 2
                                ? "即将过期"
                                : item.risk_priority === 1
                                ? "库存紧张"
                                : "普通",
                              item.location,
                              item.note
                            ]
                              .filter(Boolean)
                              .join(" ｜ ") || "无附加信息"}
                          </div>

                          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
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
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                try {
                                  const url = await uploadImageFile(f, "item");
                                  await updateItemImage(item.id, url);
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : "物品图片上传失败");
                                }
                              }}
                            />
                            {item.image_url ? (
                              <button className="danger" onClick={() => void updateItemImage(item.id, null)}>移除图</button>
                            ) : null}
                            <button className="danger" onClick={() => void softDelete(item.id)}>移入回收站</button>
                          </div>

                          {expandedItemId === item.id ? (
                            <div style={{ marginTop: 10, borderTop: "1px dashed #ddd", paddingTop: 10 }}>
                              <div className="item-meta" style={{ marginBottom: 8 }}>多位置库存分布</div>
                              <ul className="list">
                                {(itemLocations[item.id] ?? []).map((d) => {
                                  const isPrimary = (d.path || "") === (item.location || "");
                                  return (
                                    <li className="item-row" key={`${item.id}-${d.location_id}`}>
                                      <div>
                                        {d.path || `位置#${d.location_id}`} × {d.quantity}
                                        {isPrimary ? <span className="item-meta"> ｜ 主位置</span> : null}
                                      </div>
                                      <div style={{ display: "flex", gap: 8 }}>
                                        {!isPrimary ? (
                                          <button className="secondary" onClick={() => void setPrimaryLocation(item.id, d.location_id)}>
                                            设为主位置
                                          </button>
                                        ) : null}
                                        <button className="danger" onClick={() => void removeDistribution(item.id, d.location_id)}>删除</button>
                                      </div>
                                    </li>
                                  );
                                })}
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
                </div>
              ))}
            </div>
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
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="secondary" onClick={() => void restore(item.id)}>恢复</button>
                  <button className="danger" onClick={() => void permanentDelete(item.id)}>永久删除</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="fab" onClick={() => setShowForm(true)} aria-label="新增物品">＋</button>

      {previewImageUrl ? (
        <div
          onClick={() => setPreviewImageUrl(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16
          }}
        >
          <img
            src={previewImageUrl}
            alt="preview"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12, objectFit: "contain" }}
          />
        </div>
      ) : null}
    </main>
  );
}
