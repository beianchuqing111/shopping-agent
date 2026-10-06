# 选物商城（Shopping Agent）

FastAPI + PostgreSQL + Kafka KRaft + React/Vite 的**自建演示电商**：从商品浏览到下单、演示支付、发货、后台管理，是一条能真正点完的闭环。

数据全部是自建演示数据（原创商品名/规格/价格），商品图是后端本地生成的 SVG 示意图，**不涉及真实品牌报价、真实支付与真实物流**。

## 功能

消费者端

- 首页：分类入口、限时优惠、热销榜、最新上架
- 商品列表：关键词搜索、分类筛选、价格区间、5 种排序、分页
- 商品详情：三视角图集、划线价与折扣、评分/销量/库存、参数表、同类推荐
- 购物车：本地持久化（localStorage）、数量增减、库存上限、免运费提示
- 结算：收货人/手机号/详细地址表单 + 前端校验 + 服务端价格与库存校验
- 订单：订单列表、订单详情、状态时间线（待支付→已支付→已发货→已完成）、模拟支付、取消订单
- 智能导购：自然语言提需求 → 服务端解析成检索条件 → 命中商品 + 工具调用记录 + 多商品对比
- 在线客服（页面右下角常驻悬浮球，点开即聊）：意图识别 + 知识库 + **实时查订单与商品** + 转人工工单
  - 能答：订单状态与发货进度（按会话隔离，查不到就转人工）、商品价格与库存、运费/时效/退换货/保修/发票/优惠等规则
  - 规则类回答全部标注「演示规则」，事实类回答一律实时查库，不编造；答不上来的问题自动建工单（`TK` 开头）并在聊天里回执
  - 打开商品页/订单页时会出现上下文快捷问题（如「问问这件商品」）

商家/运营后台（`/#/admin`）

- 令牌登录：`X-Admin-Token` 请求头，令牌只存在于服务端环境变量 `ADMIN_TOKEN`
- 商品管理：新建商品、改价格/库存、上架/下架、按名称/SKU/品牌筛选
- 订单管理：查看全部订单、对已支付订单发货
- 客服工单：查看「在线客服」转人工生成的工单（含对话上下文与关联订单）、关闭工单

接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 服务与数据库健康状态、商品数 |
| GET | `/api/categories` | 分类及各分类在售数量 |
| GET | `/api/products` | 列表：`q` `category` `sort` `price_min` `price_max` `page` `page_size` |
| GET | `/api/products/{id}` | 详情 + 同类推荐 |
| GET | `/api/products/{id}/images/{0..2}.svg` | 本地生成的商品示意图 |
| GET | `/api/catalog` | 兼容旧前端的简单目录 |
| POST | `/api/sessions` | 新建会话 |
| POST | `/api/sessions/{sid}/chat` | 导购：解析条件并检索（模型不可用时降级） |
| POST | `/api/sessions/{sid}/compare` | 最多 4 件商品对比 |
| POST | `/api/sessions/{sid}/orders` | 创建订单（服务端价格/库存快照，支持收货信息） |
| GET | `/api/sessions/{sid}/orders` · `/orders/{id}` | 订单列表 / 订单详情 |
| POST | `/api/sessions/{sid}/orders/{id}/pay` · `/cancel` | 演示支付（按订单扣库存）/ 取消 |
| POST | `/api/sessions/{sid}/support` | 智能客服：意图识别 + 实时数据 + 转人工工单 |
| GET | `/api/support/faq` | 客服知识库快捷问题 |
| GET | `/api/admin/tickets` · `POST /api/admin/tickets/{id}/close` | 客服工单列表 / 关闭工单 |
| POST | `/api/admin/product-events` | 商品事件入 outbox（需 `X-Admin-Token`，Kafka 消费后生效） |
| GET/POST/PATCH | `/api/admin/products` · `/api/admin/products/{id}` | 后台商品列表 / 新建 / 修改 |
| GET | `/api/admin/orders` · `POST /api/admin/orders/{id}/ship` | 全部订单 / 发货 |

前端路由（hash 路由，无额外依赖）：`/`、`/c/:分类`、`/s?q=`、`/p/:id`、`/cart`、`/checkout`、`/orders`、`/order/:id`、`/guide`、`/admin`。

## 数据与边界

- `shopping/catalog_data.py` 是唯一的商品数据源：54 件自建演示商品，覆盖耳机/音箱/键盘/鼠标/显示器/麦克风/配件 7 个分类。
- 每个商品带 `seed_revision`：改数据后启动服务时，**未被后台编辑过**（version == 1）的行会自动刷新，被改过的行保持不动，不会覆盖运营改动。
- 商品图由 `shopping/images.py` 按商品 id 稳定生成 3 个视角的 SVG，不下载、不转载任何真实商品图片。
- 支付是模拟操作：没有接入任何支付渠道，不会扣款；库存按订单真实扣减，用于演示状态流转。发货是演示动作，不接物流。
- 会话 id 仅用于隔离购物会话，**不是身份认证**：本机演示没有账号体系、限流、审计与数据保留策略，默认只绑定 `127.0.0.1`，不要直接暴露到公网。
- 导购：模型只做"把话术解析成检索条件"的单次工具调用，商品事实一律来自服务端目录；模型不可用时降级为确定性检索并在界面标注原因，不会 502 掉整个商城。
- `shopping/store.py` 的 `products` 表是 JSON 文档 + 版本号，`sessions` 用 revision 做乐观锁；订单保存服务端价格快照并用 `request_id` 保证幂等。

## 安装与运行

```bash
cd C:/Users/13917/shopping-agent
uv sync --locked

# 1) 本机便携 PostgreSQL 与 Kafka（运行时在 .runtime/，已 gitignore；不使用 Docker）
uv run python -m scripts.start_local_infra postgres
uv run python -m scripts.start_local_infra kafka

# 2) 前端构建（FastAPI 直接托管 frontend/dist）
cd frontend && npm ci && npm test && npm run build && cd ..

# 3) 启动服务
export DATABASE_URL='postgresql+psycopg://shop@127.0.0.1:55432/shopping_agent'
export KAFKA_BOOTSTRAP_SERVERS='127.0.0.1:59092'
export ADMIN_TOKEN='设置你自己的管理令牌'
uv run python -m scripts.run_local
```

访问 `http://127.0.0.1:58123/`，接口文档 `/docs`，健康检查 `/health`，管理后台 `/#/admin`。

- `scripts/run_local.py` 只把当前 Hermes home `.env` 里的 `OPENAI_NEXT_API_KEY` 放进子进程环境，不复制到项目、不修改其他配置；没有 key 时导购走确定性检索。
- 单独启动商品事件消费者：`uv run python -m shopping.worker`（`KAFKA_BOOTSTRAP_SERVERS`、`DATABASE_URL` 需显式传入）。
- `PORT` 可改端口；`uv run python -m scripts.probe_llm` 只花一次真实推理验证模型连通性，且不打印密钥。

## 验证结果（本机实测）

```text
Python 全量测试（真实 PostgreSQL + 真实 Kafka）：43 passed, 1 warning in 5.93s
前端单元测试（node --test）：7 passed
前端生产构建：vite build 通过（~279 KB JS / 21 KB CSS）
ruff：All checks passed!
浏览器端到端冒烟（无头 Chrome + CDP）：浏览/搜索/详情/加购、结算校验/下单/支付/订单、后台增改上下架/发货、
智能客服（悬浮球、知识库回答、订单查询、转人工建工单、商品卡片、后台关闭工单）、导购降级与对比 全部通过
```

端到端脚本在 `e2e/`（`smoke-browse.mjs`、`smoke-checkout.mjs`、`smoke-admin-guide.mjs`、`smoke-support.mjs`），用法见 `e2e/README.md`；它们会输出截图与 JSON 断言结果。

覆盖到的关键不变量：预算/分类约束不被放宽、缺货商品不参与检索与下单、超库存下单被拒、订单价格取服务端快照且 `request_id` 幂等、支付后库存与销量真实变化、未支付订单不能发货、下架商品从商城消失、管理接口必须带 `X-Admin-Token`、客服只能查到本会话的订单、自动答不上来必须转人工而不是编造、模型不可用降级不报错、种子刷新不覆盖后台改动。

## CI/CD

- `.github/workflows/ci.yml`：push/PR 执行锁定 uv 安装、ruff、pytest（CI 里带 PostgreSQL 服务容器；Kafka 集成测试因 CI 未提供 broker 会自动跳过，本机已验证通过）、前端测试与生产构建，并上传构建产物。
- `.github/workflows/deploy.yml`：仅手动触发，需要目标服务器与 Secrets；仓库里没有执行过远程部署。

## 已知限制与下一步

- 没有账号体系与多租户隔离；会话 id 不是身份认证。
- 没有接入真实支付/物流/电子面单，订单状态靠演示动作推进。
- 库存扣减在"支付"这一步，没有预占库存与超时释放。
- 商品图是 SVG 示意图，不是真实商品照片。
- 下一步候选：账号与收货地址簿、优惠券与满减、库存预占、支付沙箱联调、商家入驻与结算。
