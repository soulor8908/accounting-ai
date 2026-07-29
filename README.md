# 智能记账 AI 助手

> 自然语言驱动的本地优先（local-first）个人财务管理应用 —— 一句话完成记账。

数据全部存在你自己的浏览器本地，可选 AES-GCM 256 加密保险库；接入大模型 API 后，可用自然语言对话式记账、查询与提醒。

## 功能特性

- **自然语言记账**：解析「昨天午饭 35」「转 500 到招行信用卡」等口语化输入，自动识别金额、日期、账户、分类。
- **多账户与负债管理**：现金 / 钱包 / 支付宝 / 储蓄卡 / 信用卡 / 贷款 / 分期，支持转账、还款、调账。
- **分期与贷款**：自动生成等额本息 / 等额本金还款计划，按期还款联动账户余额。
- **周期记账**：周期规则自动补齐到期流水（房租、工资等），最多向前补 36 期。
- **AI 对话**：多会话历史、流式响应、工具调用（查余额、记账、建分期）。
- **AI 记忆**：长期偏好 / 事实 / 习惯，自动从对话中提取并去重。
- **本地加密保险库**：masterKey + 多路包装（密码 / 安全问题 / 恢复码），聊天 / 记忆 / AI 配置随 vault 加密。
- **待还提醒**：信用卡账单日 / 还款日、贷款月供、分期计划聚合视图。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript 5.7 |
| 构建 | Vite 6 |
| 测试 | Vitest 3 + Testing Library |
| 加密 | Web Crypto API（AES-GCM 256 / PBKDF2 600k） |
| 部署 | Cloudflare Pages（`_headers` / `_redirects` 已配置） |

## 快速开始

```bash
# 安装依赖
npm install

# 本地开发
npm run dev

# 生产构建（含 tsc 类型检查）
npm run build

# 预览构建产物
npm run preview

# 运行测试
npm test

# 代码风格检查
npm run lint
npm run format
```

## 项目结构

```
src/
├── core/                  # 领域核心（与 UI 解耦，可独立测试）
│   ├── ai/                # AI 客户端、工具、记忆、习惯
│   ├── engine/            # 指令引擎：AI 输出 → 状态变更
│   ├── finance/           # 分期 / 贷款计算
│   ├── parser/            # 自然语言解析（金额 / 日期 / 分类）
│   ├── security/          # crypto + vault 加密保险库
│   ├── store/             # 状态仓库（账户/流水/聊天/记忆/快捷输入）
│   ├── utils/             # money / id / now
│   └── types.ts           # 领域类型与 schema 版本
└── ui/                    # React 视图与单例装配
    ├── appState.ts        # Store / Engine / ChatStore 单例
    ├── LockView.tsx       # 加密锁屏
    ├── ChatView.tsx       # AI 对话
    ├── AccountsView.tsx   # 账户管理
    ├── TxListView.tsx     # 流水列表
    ├── StatsView.tsx      # 统计
    ├── CalendarView.tsx   # 日历
    └── SettingsView.tsx   # 设置（AI 配置）
```

## 安全设计

- **本地优先**：所有财务数据存于浏览器本地，不上传服务器。
- **加密保险库**：启用后，state / 聊天 / 记忆 / AI 配置均由 masterKey 加密落盘，masterKey 用密码 / 安全问题 / 恢复码三路包装。
- **PBKDF2 600k 轮**：对齐 OWASP 2023 建议；密码策略 ≥8 位且含字母+数字（对齐 NIST SP 800-63B）。
- **安全响应头**：`public/_headers` 配置 CSP / X-Frame-Options / nosniff / Referrer-Policy / COOP / CORP / Permissions-Policy。
- **AI 密钥保护**：启用 vault 后 API Key 不再明文存 localStorage，改由 masterKey 加密。

## 测试

```bash
npm test          # 单次运行
npm run test:watch
npm run coverage
```

测试覆盖核心领域：parser、engine、store、finance、ai（client/tools/config/memory）、UI。

## 部署

构建产物 `dist/` 可直接部署到任意静态托管。Cloudflare Pages 已通过 `public/_headers` 与 `public/_redirects` 配置安全头与 SPA 路由 fallback。

### CI/CD 自动部署

push 到 `main` 分支时，`.github/workflows/deploy.yml` 自动执行：

1. **lint + test 门禁**：不通过则阻断部署（冒烟测试已 mock AI 客户端，无外网依赖，CI 稳定）
2. **部署 AI 试用代理 Worker**（检测到 `AGNES_API_KEY` 时自动执行）
   - `wrangler deploy` 部署到 `https://agnes-ai-proxy.<subdomain>.workers.dev`
   - `wrangler secret put AGNES_API_KEY` 注入试用 Key
   - 从部署输出解析 Worker URL，注入 `VITE_TRIAL_PROXY_URL`
3. **构建前端**：Worker URL 编译进产物
4. **部署 Cloudflare Pages**：部署到固定项目 `accounting-ai-tool`（`wrangler@4 pages deploy`）
   - 项目名硬编码为 `accounting-ai-tool`，subdomain 为 `accounting-ai-tool.pages.dev`
   - 首次部署前通过 `wrangler@4 pages project create accounting-ai-tool --production-branch=main` 创建（已存在则跳过，幂等）
   - 统一使用 `wrangler@4`（与 Worker 部署一致，不用 wrangler-action 默认旧版）

#### 需配置的 GitHub Secrets

| Secret | 说明 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | CF Token（需 Workers + Pages 权限） |
| `CLOUDFLARE_ACCOUNT_ID` | CF Account ID（控制台右下角） |
| `AGNES_API_KEY` | 试用 AI API Key（不配置则跳过 Worker，用户需自带 Key） |

## AI 试用代理架构

```
浏览器 ──POST + X-Target-URL──▶ Worker (agnes-ai-proxy)
                                  │
                                  ├─ 限流检查（内存 Map，30次/天/IP）
                                  ├─ 白名单校验（只允许已知上游）
                                  ├─ Key 注入（从 Secret 读取，前端不可见）
                                  └─ 转发到上游 API ──▶ AI 服务
```

- **前端**：`apiKey` 为空字符串，仅持有 `proxyUrl`（Worker URL）
- **Worker**：从 `AGNES_API_KEY` Secret 注入 Key，按 IP 限流，转发请求
- **用户自有 Key**：前端直连 API（不经过 Worker），`X-API-Key` header 携带用户 Key

## 安全历史

- 2026-07-29：发现历史 commit `ad82942` 中硬编码试用 API Key，已通过 `git filter-repo` 重写历史，
  Key 明文已从所有 commit 中擦除。上游 Key 已撤销轮换。
  重写后 commit hash 变更：`ad82942 → bfc1b22`、`b90957e → 6421f30`。

## 许可

私有项目，未发布开源许可。
