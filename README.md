# AI 装修避坑顾问（微信小程序）

一个垂直 AI 顾问小程序的**可闭环 MVP**：用户在 6 大装修场景下用自然语言提问，AI 返回「核心结论 → 分步建议 → 风险提醒」的结构化避坑建议；免费额度用尽后可通过微信支付解锁更多咨询；支持将一次会话聚合为避坑清单报告，并采集用户对回答的有用性反馈。

> 前端 Taro 4 + React + TypeScript；后端微信云开发（CloudBase）云函数；AI 侧以策略化封装接入 DeepSeek / 腾讯混元，未配置密钥时自动使用本地知识库 Mock，保证离线可用。

---

## 功能特性

- **6 场景 AI 问答**：预算 / 验收 / 合同 / 水电 / 防水 / 主材，另有通用兜底场景
- **结构化回答**：`claim`（核心结论）+ `step`（分步建议）+ `warning`（风险提醒）三段式，便于对照施工核对
- **免费额度 + 付费解锁**：每日免费 N 次（可配），额度用尽弹窗引导付费；微信支付回调幂等、订单失败回滚、前端乐观解锁
- **避坑清单报告**：把会话中多轮回答按场景聚合为可复用的避坑清单（`ai-report`）
- **反馈采集**：用户对回答点「有帮助 / 无帮助」，附带 `sessionId` 可追溯回会话
- **微信 AI 开发模式接入**：以独立分包形式暴露 `renovationAdvisor` 技能（`skills/renovation-advisor`），供微信 AI 按 AGENTS.md 调用
- **契约驱动开发**：前后端共享 `routes.ts` 单一事实源，契约测试保证路由一致
- **暗色主题 + 无障碍**：满足 WCAG AA 对比度；<14px 无衬线、≥14px 衬线的字体分级

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Taro 4（webpack5）+ React 18 + TypeScript + SCSS |
| 后端 | 微信云开发云函数（`wx-server-sdk`） |
| AI | 策略化封装：`mock` / `deepseek` / `hunyuan`，20s 超时保护 |
| 支付 | 微信支付（`cloudPay`），回调幂等 + 订单回滚 |
| 测试 | Vitest（核心单元 + 契约 + SKILL 三套测试，共 51 例） |

## 快速开始

### 前置依赖

- Node.js ≥ 18
- 微信开发者工具（用于真机/模拟器预览）
- 一个已开通云开发的微信小程序 AppID

### 安装与构建

```bash
git clone https://github.com/eqzhou/renovation-pitfall-advisor.git
cd renovation-pitfall-advisor
npm install          # .npmrc 已开启 legacy-peer-deps，无需额外参数
npm test             # 51 例测试
npm run type-check   # TS 类型检查
npm run build:weapp  # 产物输出到 dist/weapp/
```

> Taro 全局缓存目录已被隔离到项目内 `.taro-home/`（见 [package.json](package.json) scripts），无需修改系统 `HOME`，克隆即跑。

### 在微信开发者工具中预览

1. 执行 `npm run build:weapp` 生成 `dist/weapp/`
2. 微信开发者工具「导入项目」，选择 `dist/weapp/` 目录，填入你的小程序 AppID
3. 在开发者工具中开通云开发环境，并将 `src/cloudfunctions/` 下的 6 个云函数 + `shared` 上传部署

## 云函数部署与环境变量

云函数：`ai-ask`、`ai-report`、`feedback`、`pay-order`、`pay-notify`、`quota`（公共逻辑在 `shared`）。

| 变量 | 作用 | 默认 |
|---|---|---|
| `LLM_PROVIDER` | `mock` / `deepseek` / `hunyuan` | `mock` |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥（provider=deepseek 时必填） | — |
| `DEEPSEEK_MODEL` | DeepSeek 模型名 | `deepseek-chat` |
| `HUNYUAN_API_KEY` | 混元密钥（HTTP 直连时必填） | — |
| `HUNYUAN_MODEL` | 混元模型名 | `hunyuan-turbo-latest` |
| `DAILY_FREE_LIMIT` | 每日免费咨询次数 | `5` |

**安全约定**：密钥只配置在云函数环境变量中，前端与仓库均不落地。公开仓库中 `ai-ask/impl.js` 只读取 `process.env.*`。

## 真 LLM 接入

1. 在云开发控制台给 `ai-ask` 云函数配置 `LLM_PROVIDER=deepseek` + `DEEPSEEK_API_KEY`（或 `hunyuan`）
2. 未配置时默认 `mock`：走 [src/cloudfunctions/ai-ask/impl.js](src/cloudfunctions/ai-ask/impl.js) 内置的 6 场景知识库
3. 所有 provider 均强制 JSON 数组输出形状，`parseChunksFromLLM` 严格校验，解析失败抛明确错误、绝不静默兜底
4. 调用带 20s 超时保护，超时返回 `504`，前端提示「AI 正在忙」并把问题回填输入框

## 支付接入

- `pay-order` 生成订单并调 `cloudPay.unifiedOrder` 获取支付参数；未配置真支付时返回 `hint`，前端弹「尚未开通真支付」占位
- `pay-notify` 处理微信支付回调：订单标记已支付 → 写入用户额度（`usage_daily`）；额度写入失败则**回滚订单状态**并抛错触发重试，保证「已付款必解锁」
- 前端支付成功后乐观置为已付费（1s 后刷新真实额度），消除回调延迟的焦虑

## 微信 AI 开发模式

见 [app.config.ts](src/app.config.ts)：

- 全局开启 `lazyCodeLoading: 'requiredComponents'` 与 `cloud: true`
- SKILL 位于独立分包 `skills/renovation-advisor`（原样拷贝，不经 Taro 编译）
- 向微信 AI 声明技能 `renovationAdvisor`，全局指令 `AGENTS.md`，原子组件 `answer-card`

## 契约驱动与测试

- 路由契约单一事实源：[src/api/contracts/routes.ts](src/api/contracts/routes.ts)；服务端实现登记于 [src/server/routes.ts](src/server/routes.ts)
- 契约测试（`tests/api-contract.test.ts`）：断言每个契约路由都被服务端登记、方法/路径一致
- 核心单元测试（`tests/core-unit.test.ts`）：`validateRequest`、`parseChunksFromLLM`、`buildChecklist`、`isPaidActive`、`today/addDays` 等纯函数（38 例）
- SKILL 契约测试（`tests/skill-contract.test.ts`）：AGENTS.md / SKILL.md / mcp.json / answer-card 四件套存在性

```bash
npm test          # 51 例全绿
npm run type-check
npm run build:weapp
```

## 目录结构

```
├── config/                 # Taro 构建配置（含 copy 到 dist/weapp 的修正）
├── src/
│   ├── api/                # 前端 API 客户端 + 契约路由（client.ts 统一解析 envelope）
│   ├── app.config.ts       # 全局配置（分包、微信 AI agent 声明）
│   ├── pages/index/        # 主页面（问答 / 避坑清单 / 我的 三 Tab）
│   ├── styles/theme.scss   # 暗色主题设计令牌（CSS 变量）
│   ├── server/routes.ts    # 服务端契约登记
│   ├── cloudfunctions/     # 6 个云函数 + shared
│   └── skills/             # 微信 AI 技能分包（独立分包，原生文件）
└── tests/                  # 契约 + 单元 + SKILL 三套测试
```

## License

MIT
