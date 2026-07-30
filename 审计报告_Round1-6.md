# 智能记账AI助手 — 代码审计报告

> 审计日期：2026-07-25
> 审计范围：src/ 全部核心模块（types/parser/finance/store/engine）与 UI（React 六视图）
> 基线：200/200 单元与冒烟测试通过、`tsc --noEmit` 零错误、生产构建成功、浏览器端到端冒烟通过

---

## 审计轮次结论

### Round 1: 功能正确性（Critical）
| ID | 位置 | 问题 | 严重程度 | 处理 |
|----|------|------|----------|------|
| R1-001 | store.ts `load()` | 损坏的持久化 JSON（accounts 非数组等）会被直接采纳，污染运行时状态 | High | ✅ 新增 `isValidStateShape` 统一校验形状与 schemaVersion，并补 2 个测试 |
| R1-002 | engine 还款账户解析 | 「还了信用卡2000」中"信用卡"被误判为付款账户 | Critical | ✅ 还款目标关键词包含匹配过滤（此前已修复并有测试覆盖） |

其余扫描：无空指针路径（账户/计划查找均有 not_found 分支）、无异步未捕获异常（引擎为同步设计）、TS 严格模式零错误。

### Round 2: 性能与体验（High）
- 日历视图已 `useMemo`，并以 version 驱动 store 变更后的重算。
- 无订阅/定时器，无内存泄漏面。
- 数据量为个人记账级别（年数千条流水），列表渲染与全量 JSON 持久化无性能风险。**零问题**。

### Round 3: 安全规范（High）
| ID | 位置 | 问题 | 严重程度 | 处理 |
|----|------|------|----------|------|
| R3-001 | SettingsView 导入备份 | 仅校验 2 个字段即替换全量状态 | Medium | ✅ 复用 `isValidStateShape` 严格校验 |

- 渲染全部走 React 文本插值，无 `dangerouslySetInnerHTML` / `eval` / `innerHTML`，XSS 面为零。
- 无密钥、无网络请求、无敏感信息硬编码；数据仅存本地 localStorage（隐私优先架构）。
- 金额校验（正数、大额确认、透支/超额确认）在 Store 层强制，UI 无法绕过。

### Round 4: 代码质量与规范（Medium）
| ID | 位置 | 问题 | 处理 |
|----|------|------|------|
| R4-001 | store.ts `applyLoanRepayment` | if/else 两分支完全相同的死代码 | ✅ 合并 |
| R4-002 | store.ts `resolveAccounts` | `.replace(/储蓄|借记|信用/g, m => m)` 无操作 | ✅ 删除 |
| R4-003 | store.ts 注释 | "最多补 24 期"与守卫值 36 不一致 | ✅ 修正 |
| R4-004 | engine.ts | 内联 `import('../types')` 类型引用 | ✅ 统一顶部导入 |

全仓扫描无 TODO/FIXME、无 console 调试残留、无魔法数（大额阈值等均为具名导出常量）。

### Round 5: 可维护性与架构（Medium）
- 分层清晰：parser（纯函数）→ engine（编排）→ store（唯一状态源）→ UI（只读+指令），符合审计文档 P0"AI 不维护状态"原则。
- 测试覆盖：10 个测试文件、200 个用例，覆盖解析器边界、贷款/分期计算、撤销回滚、引擎会话流与 App 冒烟。
- 已知取舍（非缺陷，记录备查）：UI 使用 store/engine 单例，利于本地优先单页架构；如未来多账本需改为 Context 注入。

### Round 6: 工程化与兼容性（Low）
- 构建链路（Vite 6 + TS 5.7 + Vitest 3）版本对齐，构建产物 ~63KB gzip。
- 表单控件均带 aria-label；`<input type="month">` 在 Safari 降级为文本输入，不影响功能。
- 无依赖版本冲突；`npm run build` 含 `tsc --noEmit` 门禁。

### Round 7: 性能调优与体验统一（2026-07-30）
本轮针对 Cloudflare 国内访问慢、对体积敏感的部署场景做端到端调优，并统一三处列表项交互。

| ID | 位置 | 改动 | 严重程度 | 处理 |
|----|------|------|----------|------|
| R7-001 | `src/i18n/*` | 移除国际化模块，文案全部硬编码中文 | Low | ✅ 删除 i18n 目录与测试，首屏 gzip 下降约 5KB |
| R7-002 | `vite.config.ts` | 新增 `rollup-plugin-visualizer` 打包分析（`ANALYZE=1`） | Low | ✅ `npm run analyze` 生成 `dist/stats.html` |
| R7-003 | `scripts/size-guard.mjs` | 新增体积守卫脚本 | Medium | ✅ 设定首屏 100KB / 主包 38KB / react-vendor 47KB / CSS 10KB 预算，构建后扫描 dist，超阈值非零退出 |
| R7-004 | `.github/workflows/ci.yml` | CI 接入体积守卫 | Medium | ✅ PR 流水线增加 `npm run size` 步骤，体积回退自动拦截 |
| R7-005 | `src/ui/LockView.tsx` | 懒加载锁屏视图 | Low | ✅ `React.lazy` + Suspense，首屏不加载加密相关代码 |
| R7-006 | `src/ui/SwipeableRow.tsx`（新增） | 通用左滑操作行组件 | Medium | ✅ pointer events 支持触摸+鼠标；模块级排他状态机（打开新行自动关闭旧行）；4px 拖拽阈值避免误触；已打开行点击内容区收起 |
| R7-007 | `AccountsView.tsx` / `TxListView.tsx` / `SettingsView.tsx` | 三处列表项统一改为左滑露出编辑/删除 | Medium | ✅ 移除原常驻 `tx-actions` / `account-actions` 按钮区，视觉噪音下降，信息密度提升 |
| R7-008 | `src/ui/TxListView.tsx` | 流水默认筛选当前月份 | Low | ✅ `currentMonth()` 计算 YYYY-MM 作为 `month` 初始值，保留「清除」按钮查看全部 |
| R7-009 | `src/core/ai/config.ts` | 默认 AI 模型由 Agnes 切换为 DeepSeek | Medium | ✅ `defaultConfig()` 优先选 `deepseek` preset（`deepseek-v4-flash`），国内访问稳定、CORS 友好；不设 `proxyUrl`，直连官方 API |
| R7-010 | 异步操作 loading 态 | 所有异步请求/加载补 loading 反馈 | Low | ✅ `view-loading` 旋转占位、AI 测试 `testing` 态、数据导入 `dataBusy` 态禁用按钮防重复点击 |

**风险扫描**：
- 左滑组件在桌面端无触摸时仍可用鼠标拖拽，无障碍访问性保留（操作按钮可聚焦）。
- 默认 DeepSeek 不影响已保存自定义配置的用户（`loadAIConfig()` 优先返回用户配置）。
- 体积守卫阈值在当前最优值基础上预留约 8% 余量，避免误报。

**回归验证**：lint / test / build / size 全链路通过。

---

## 统计

| 指标 | 数值 |
|------|------|
| 总发现问题数 / 改进项 | 6（Round 1-6）+ 10（Round 7 体验调优） |
| 已修复 | 全部（修复率 100%，均含回归测试或全量回归验证） |
| 修复后新问题 | 0（lint / test / build / size 全链路通过） |
| Round 2 / 5 / 6 | 零问题 |
| Round 7 | 10 项改进（性能调优 + 体验统一），全部落地 |

## 项目健康度评分：**96 / 100**

扣分项（均为已记录的架构取舍，非缺陷）：
- -2：本地存储未加密（本地优先设计下的已知权衡，已在设置页提示定期导出备份；启用 vault 后可加密）
- -2：UI 层单例依赖，多账本/多用户扩展时需重构为注入式

## 后续维护建议
1. 模糊金额/还款追问的会话状态可加超时，避免跨天遗留 pending。
2. 数据导出可增量附带 schemaVersion 迁移钩子，便于未来模型升级。
3. 记账数据增长后可引入 IndexedDB 与流水分页。
4. 左滑操作的「发现性」可在首次进入列表时增加一次性引导提示。
5. 体积守卫阈值随业务增长需定期复核，必要时拆分更多懒加载 chunk。
