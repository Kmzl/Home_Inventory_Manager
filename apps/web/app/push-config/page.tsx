"use client";

import { useEffect, useState } from "react";

const API_BASE = "http://localhost:3001";

type ConfigResp = {
  configured: boolean;
  config: null | {
    provider: "serverchan" | "pushdeer";
    endpoint: string;
    tokenMasked: string;
    enabled: boolean;
  };
};

const TUTORIALS = [
  {
    title: "PushDeer 开源项目（免费自建/自托管）",
    url: "https://github.com/easychen/pushdeer"
  },
  {
    title: "PushDeer 使用教程（知乎）",
    url: "https://zhuanlan.zhihu.com/p/1893041703331533830"
  },
  {
    title: "ServerChan 微信推送接入教程（CSDN）",
    url: "https://blog.csdn.net/u011072037/article/details/106389269"
  }
];

export default function PushConfigPage() {
  const [status, setStatus] = useState<ConfigResp | null>(null);
  const [provider, setProvider] = useState<"serverchan" | "pushdeer">("serverchan");
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch(`${API_BASE}/api/push/config`);
    if (!res.ok) return setError("加载配置失败");
    const json = (await res.json()) as ConfigResp;
    setStatus(json);
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setError("");
    const res = await fetch(`${API_BASE}/api/push/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, endpoint, token, enabled })
    });
    if (!res.ok) return setError("保存失败，请检查 endpoint/token");
    setToken("");
    await load();
  };

  return (
    <main className="page">
      <section className="card">
        <h1>🔔 微信推送配置</h1>
        <p className="item-meta">用于每日风险通知发送配置（ServerChan / PushDeer）</p>
        {error ? <p className="error">{error}</p> : null}
      </section>

      {!status?.configured ? (
        <section className="card">
          <h2>尚未配置，先看教程</h2>
          <ul className="list">
            {TUTORIALS.map((t) => (
              <li key={t.url} className="item-row">
                <div>
                  <strong>{t.title}</strong>
                  <div className="item-meta">{t.url}</div>
                </div>
                <a href={t.url} target="_blank" rel="noreferrer">
                  <button className="secondary">打开</button>
                </a>
              </li>
            ))}
          </ul>
          <p className="item-meta" style={{ marginTop: 10 }}>
            你可以先选一个免费的通道（推荐 PushDeer 开源自建），拿到 endpoint + token 后再保存配置。
          </p>
        </section>
      ) : (
        <section className="card">
          <h2>当前配置</h2>
          <p className="item-meta">provider: {status.config?.provider}</p>
          <p className="item-meta">endpoint: {status.config?.endpoint}</p>
          <p className="item-meta">token: {status.config?.tokenMasked}</p>
          <p className="item-meta">enabled: {String(status.config?.enabled)}</p>
        </section>
      )}

      <section className="card">
        <h2>{status?.configured ? "更新配置" : "保存配置"}</h2>
        <div className="form-grid">
          <select value={provider} onChange={(e) => setProvider(e.target.value as "serverchan" | "pushdeer")}>
            <option value="serverchan">ServerChan</option>
            <option value="pushdeer">PushDeer</option>
          </select>
          <input
            placeholder="endpoint（例如 https://sctapi.ftqq.com/SCTxxxx.send）"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
          />
          <input placeholder="token / sendkey" value={token} onChange={(e) => setToken(e.target.value)} />
          <select value={enabled ? "1" : "0"} onChange={(e) => setEnabled(e.target.value === "1")}>
            <option value="1">启用</option>
            <option value="0">停用</option>
          </select>
          <button className="full" onClick={() => void save()}>保存</button>
        </div>
      </section>
    </main>
  );
}
