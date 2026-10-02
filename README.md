# Shopping Agent MVP

FastAPI + PostgreSQL + Kafka KRaft + React/Vite 的本地购物助手。当前支持合成目录检索、对比、购物车和幂等创建演示订单；仍不接真实支付、物流或外部电商。LLM 是可选的单次工具调用规划器，不宣称自主循环 Agent。

## 数据和边界

- `shopping/store.py` 的商品全部是原创 synthetic fixtures。名称、品牌、价格、库存、特征均为合成值，不是现实商品报价。缺货条目不会被推荐。
- 所有响应携带 `synthetic-fixture`、商品 ID 和目录版本。LLM 的自由文本不作为商品证据；展示结果仅来自服务端重新验证的目录。
- 持久化约束支持预算、类别、品牌。明确中文预算和类别编辑可跨轮更新；模糊追问保留条件。UI 筛选显式字段优先。复杂语言解释仍依赖模型，非安全保证；可通过 UI 修正。费用采用整数分。
- UUID 会话隔离不是用户认证。默认只绑定 localhost；本地演示无租户鉴权、限流、审计、数据保留策略，不得直接暴露公网。管理员事件接口要求 `X-Admin-Token`，不接受 URL 密钥。
- 商品事件的 `event_id` 必须对应同一个完整 payload；复用 ID 携带不同 payload 会返回冲突。outbox publisher 先 claim、发送失败可回收，避免多 publisher 并发重复发布。
- 代码 MIT（见 LICENSE）；依赖遵循各自许可证。Lucide 图标为 UI 占位示意，不是商品照片。未下载或再分发真实商城数据。

## 安装与运行

```bash
cd C:/Users/13917/shopping-agent
uv sync --locked
cd frontend
npm ci
npm test
npm run build
cd ..
export DATABASE_URL='postgresql+psycopg://shop@127.0.0.1:55432/shopping_agent'
export KAFKA_BOOTSTRAP_SERVERS='127.0.0.1:59092'
uv run python -m scripts.run_local
```

访问 `http://127.0.0.1:58123/`，API 文档 `/docs`，健康检查 `/health`。`scripts.run_local` 只从当前 Hermes home 的 `.env` 读取 `OPENAI_NEXT_API_KEY` 放入子进程环境，不复制到项目、不修改 Hermes。通过 `PORT` 改端口。普通 `uv run uvicorn shopping.api:app` 未配置 key 时进入确定性演示；配置 `LLM_BASE_URL`（默认 `https://api.openai-next.com/v1`）、`LLM_MODEL`（默认 `gpt-6-sol`）。有 key 但请求失败返回 502，不伪造模型成功。

单独启动 worker：

```bash
uv run python -m shopping.worker
```

本机便携 PostgreSQL 和 Kafka 运行时位于 `.runtime/`，已 gitignore。按用户要求未安装或运行 Docker。

## 验证结果

本机实际执行：

```text
real PostgreSQL + Kafka integration: 14 passed, 1 warning in 3.22s
ruff: All checks passed!
frontend npm test: 1 passed
frontend npm run build: passed
LLM tool call and multi-turn constraints: passed previously
```

集成测试覆盖真实 PostgreSQL 持久化、真实 Kafka outbox→producer→consumer→PG、重复事件、旧版本、DLQ，以及 claim/recovery。SQLite 仅用于快速 API 单元测试。warning 来自 Starlette 对 httpx TestClient 的弃用提醒，非测试失败。

## CI/CD

`.github/workflows/ci.yml` 在 push/PR 执行锁定 uv 安装、ruff、pytest、React 测试与生产构建，上传 UI artifact。`.github/workflows/deploy.yml` 仅 `workflow_dispatch`，需要目标服务器和 Secrets；未执行远程部署。GitHub CI 尚未运行，因为项目尚未发布到远程仓库。
