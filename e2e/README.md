# 端到端冒烟测试（真实浏览器）

这些脚本用本地无头 Chrome 的 DevTools 协议跑一遍真实交互：浏览、加购、结算、下单、支付、后台管理、智能导购。
它们不是单元测试的替代品，而是"页面真的能用"的证据，输出截图 + JSON 断言结果。

## 前置

1. 便携 PostgreSQL / Kafka 已启动：`uv run python -m scripts.start_local_infra postgres`、`... kafka`
2. 商城服务在跑，并设置了管理令牌：
   ```bash
   export DATABASE_URL='postgresql+psycopg://shop@127.0.0.1:55432/shopping_agent'
   export ADMIN_TOKEN='local-demo-admin'
   uv run python -m scripts.run_local
   ```
3. 前端已构建：`cd frontend && npm run build`
4. 启动无头 Chrome（Node 22 的 WebSocket 直连 CDP，无需额外依赖）：
   ```bash
   chrome.exe --headless=new --disable-gpu --remote-debugging-port=9333 \
     --user-data-dir=$LOCALAPPDATA/Temp/qa-profile --window-size=1440,1000 about:blank
   ```

## 运行

```bash
node e2e/smoke-browse.mjs        # 首页 / 分类 / 搜索 / 详情 / 加购
node e2e/smoke-checkout.mjs      # 购物车 / 结算校验 / 下单 / 支付 / 订单列表
BASE_URL=http://127.0.0.1:58123 ADMIN_TOKEN=local-demo-admin node e2e/smoke-admin-guide.mjs
```

可配置环境变量：`BASE_URL`、`ADMIN_TOKEN`、`CDP_PORT`（默认 9333）、`SHOT_DIR`。

截图写到 `e2e/shots/`，断言结果写到 `e2e/results-*.json`（两者都已 gitignore）。
脚本里的中文断言是刻意保留的：它们直接核对界面上真实渲染出来的文案。
