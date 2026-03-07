# Home Inventory MVP

家庭物品管理 MVP（monorepo）：
- `apps/api`: Fastify + TypeScript + SQLite
- `apps/web`: Next.js App Router
- `packages/shared`: 共享包占位

## 快速启动

> 运行前先固定 Node 22（避免 better-sqlite3 在 Node 25 的 ABI 问题）

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node -v   # 应显示 v22.x
pnpm install
pnpm dev
```

- Web: http://192.168.8.201:3000
- API: http://192.168.8.201:3001
- Health: http://192.168.8.201:3001/health

数据库默认路径：`data/app.db`（启动时自动创建目录和文件）。

## API 一览

### 健康检查
- `GET /health` -> `{ ok: true, dbOk: true }`

### 物品管理
- `GET /api/items`：在用物品
- `GET /api/items/trash`：回收站
- `POST /api/items`：创建物品
- `PATCH /api/items/:id`：更新物品
- `POST /api/items/:id/delete`：软删除（移入回收站）
- `POST /api/items/:id/restore`：从回收站恢复

创建示例：

```bash
curl -X POST http://localhost:3001/api/items \
  -H 'content-type: application/json' \
  -d '{"name":"牙刷","category":"日用品","location":"卫生间","quantity":2}'
```
