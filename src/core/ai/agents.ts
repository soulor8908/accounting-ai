/**
 * Agent 配置：支持多个 AI 人设，用户可在对话中切换
 *
 * 设计原则（卡帕西视角）：
 * - 系统提示词与上下文分离：agent 只定义人设，运行时注入账户/记忆/日期等上下文
 * - 增量迁移：无 agent 配置时回退到默认「记账助手」，兼容旧版
 * - 最小持久化：仅存用户自定义部分，默认 agent 由代码定义
 *
 * 设计原则（乔布斯视角）：
 * - 开箱即用：预置 3 个常用 agent，用户无需配置即可体验
 * - 切换无摩擦：对话页一键切换，当前 agent 一目了然
 */
import { memoryStore, store } from '../../ui/appState';
import { formatMoney } from '../engine/engine';
import type { Account } from '../types';

/** Agent 标识 */
export type AgentId = string;

export interface Agent {
  id: AgentId;
  /** 显示名 */
  name: string;
  /** 一句话描述 */
  description: string;
  /** 系统提示词模板，运行时会拼接上下文 */
  systemPrompt: string;
  /** 是否为预置（不可删除） */
  builtin: boolean;
}

// ---------- 预置 Agent ----------

const ACCOUNTING_AGENT: Agent = {
  id: 'accounting',
  name: '记账助手',
  description: '快速记账、查询流水、管理账户',
  builtin: true,
  systemPrompt: `你是一个智能记账助手。用户可以通过自然语言让你帮他记账、查询、编辑和删除数据。

你可以调用工具来完成用户的请求。如果用户的话不够明确，可以先用 list_transactions 或 query_balance 查看当前数据后再操作。
重要：执行 delete_transaction 删除流水时，必须先用 descriptionKeyword 或 id 查清楚，删除前在回复中向用户确认。
用户可能让你查看/添加/修改/删除记忆（如「你记得我什么」「记住我喜欢…」「忘掉那条」），使用 list_memories / add_memory / update_memory / delete_memory 工具，删除记忆前同样需要先向用户确认。

工具选择指南：
- 用户问「这个月花了多少」「总余额多少」「下个月要还多少」等汇总问题时，优先调用 query_overview 一次性获取全部信息，避免多次调用
- 用户问「下月/未来几个月待还」时调用 query_upcoming_payments
- 用户问「今天花了多少」时调用 query_summary(scope=today)
- 用户问「本月收支」时调用 query_summary(scope=month)
- 用户问「这个月比上个月/去年如何」「消费趋势」「环比/同比」「哪些类别涨了」时，调用 analyze_trends（可传 month 指定月份）获取环比、同比、分类变化与预测，再结合具体流水补充解释
- 用户问「有没有异常消费」「哪笔花得离谱」「这个月有没有不对劲的支出」时，调用 analyze_anomalies（可传 month 指定月份）获取异常清单，再结合具体流水补充说明

回复请简洁，用中文。金额用 ¥ 符号。涉及多个数据时用换行或分号分隔，便于阅读。`,
};

const ADVISOR_AGENT: Agent = {
  id: 'advisor',
  name: '理财顾问',
  description: '分析收支结构，给出节流与配置建议',
  builtin: true,
  systemPrompt: `你是一位温和、务实的个人理财顾问。基于用户的真实账本数据给出建议，不空谈理论。

你的工作方式：
1. 先用 query_balance / list_transactions 等工具了解用户的资产、负债、近期收支结构
2. 结合用户的长期记忆（偏好、习惯）给出个性化建议
3. 建议要具体、可执行，附上预期效果（如「每月预计节省 ¥X」）
4. 涉及投资时只做教育性说明，不推荐具体产品

回复风格：先给结论，再列依据。金额用 ¥ 符号。如果数据不足以判断，坦诚说明需要哪些信息。`,
};

const ANALYST_AGENT: Agent = {
  id: 'analyst',
  name: '消费分析',
  description: '挖掘消费趋势，识别异常支出',
  builtin: true,
  systemPrompt: `你是一位数据驱动的消费分析师。你的任务是帮助用户理解自己的消费模式。

你的工作方式：
1. 优先调用 analyze_trends 获取指定月份的环比、同比、分类变化与全月预测——这是最权威的趋势数据，不要手动用 list_transactions 重算
2. 检测异常支出时，调用 analyze_anomalies 获取基于历史基线的异常清单（高额/偏高/创新高），再结合具体流水判断是否为误报或为真实异常（如一次性大件、旅行）
3. 需要看具体某笔消费时，再用 list_transactions 拉取明细（可指定 month / category 筛选）
4. 按分类、时间、账户维度做解读，识别趋势和异常
5. 用清晰的中文表达，必要时可以用简单的 markdown 表格
6. 指出异常时给出具体数据（如「餐饮类本月 ¥1200，环比 +50%」）
7. 给出可执行的优化建议

金额用 ¥ 符号，百分比保留 1 位小数。`,
};

const BUILTIN_AGENTS: Agent[] = [ACCOUNTING_AGENT, ADVISOR_AGENT, ANALYST_AGENT];

// ---------- 持久化 ----------

const STORAGE_KEY = 'ai-ledger-agents';
const ACTIVE_KEY = 'ai-ledger-active-agent';

interface StoredAgents {
  /** 用户自定义 agent */
  custom: Agent[];
  /** 被用户禁用的预置 agent id */
  disabledBuiltin: AgentId[];
}

function loadStored(): StoredAgents {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { custom: [], disabledBuiltin: [] };
    const parsed = JSON.parse(raw) as StoredAgents;
    return {
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      disabledBuiltin: Array.isArray(parsed.disabledBuiltin) ? parsed.disabledBuiltin : [],
    };
  } catch {
    return { custom: [], disabledBuiltin: [] };
  }
}

function saveStored(s: StoredAgents): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 忽略写入失败（隐私模式 / 配额满）
  }
}

/** 列出所有可用 agent（预置未被禁用的 + 自定义） */
export function listAgents(): Agent[] {
  const stored = loadStored();
  const enabled = BUILTIN_AGENTS.filter((a) => !stored.disabledBuiltin.includes(a.id));
  return [...enabled, ...stored.custom];
}

/** 列出所有 agent（含被禁用的预置），用于设置页管理 */
export function listAllAgents(): Array<Agent & { disabled: boolean }> {
  const stored = loadStored();
  const builtin = BUILTIN_AGENTS.map((a) => ({ ...a, disabled: stored.disabledBuiltin.includes(a.id) }));
  const custom = stored.custom.map((a) => ({ ...a, disabled: false }));
  return [...builtin, ...custom];
}

/** 获取单个 agent */
export function getAgent(id: AgentId): Agent | undefined {
  return listAgents().find((a) => a.id === id);
}

/** 获取当前激活的 agent；缺失时回退到记账助手 */
export function getActiveAgent(): Agent {
  const activeId = localStorage.getItem(ACTIVE_KEY);
  const agents = listAgents();
  if (activeId) {
    const found = agents.find((a) => a.id === activeId);
    if (found) return found;
  }
  return agents[0] ?? ACCOUNTING_AGENT;
}

/** 设置当前激活的 agent */
export function setActiveAgent(id: AgentId): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // 忽略
  }
}

// ---------- 增删改 ----------

/** 新增自定义 agent */
export function addAgent(agent: Omit<Agent, 'id' | 'builtin'>): Agent {
  const stored = loadStored();
  const newAgent: Agent = {
    ...agent,
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    builtin: false,
  };
  stored.custom.push(newAgent);
  saveStored(stored);
  return newAgent;
}

/** 更新 agent（仅自定义可改） */
export function updateAgent(id: AgentId, patch: Partial<Omit<Agent, 'id' | 'builtin'>>): boolean {
  const stored = loadStored();
  const idx = stored.custom.findIndex((a) => a.id === id);
  if (idx < 0) return false;
  stored.custom[idx] = { ...stored.custom[idx], ...patch };
  saveStored(stored);
  return true;
}

/** 删除 agent（仅自定义可删） */
export function removeAgent(id: AgentId): boolean {
  const stored = loadStored();
  const before = stored.custom.length;
  stored.custom = stored.custom.filter((a) => a.id !== id);
  if (stored.custom.length === before) return false;
  saveStored(stored);
  // 如果删的是当前激活的，切回默认
  if (localStorage.getItem(ACTIVE_KEY) === id) {
    localStorage.removeItem(ACTIVE_KEY);
  }
  return true;
}

/** 启用/禁用预置 agent */
export function toggleBuiltinAgent(id: AgentId, enabled: boolean): void {
  const stored = loadStored();
  if (enabled) {
    stored.disabledBuiltin = stored.disabledBuiltin.filter((x) => x !== id);
  } else {
    if (!stored.disabledBuiltin.includes(id)) stored.disabledBuiltin.push(id);
  }
  saveStored(stored);
  // 如果禁用的是当前激活的，切回默认
  if (!enabled && localStorage.getItem(ACTIVE_KEY) === id) {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

// ---------- 系统提示词构建 ----------

/** 构建完整系统提示词：agent 人设 + 运行时上下文 */
export function buildSystemPrompt(agent: Agent): string {
  const today = new Date().toISOString().slice(0, 10);
  const accounts = store.state.accounts.length > 0
    ? store.state.accounts.map((a: Account) => `  - ${a.name}（${a.type}）余额 ¥${formatMoney(a.balance)}`).join('\n')
    : '  （暂无账户）';
  const totalAssets = formatMoney(store.getTotalAssets());
  const totalLiabilities = formatMoney(store.getTotalLiabilities());

  const memories = memoryStore.list();
  const memoryBlock = memories.length > 0
    ? memories.map((m) => `  - [${m.category}${m.source === 'auto' ? '/自动' : ''}] ${m.content}`).join('\n')
    : '  （暂无记忆）';

  return `${agent.systemPrompt}

当前日期：${today}
总资产：¥${totalAssets}
总负债：¥${totalLiabilities}

账户列表：
${accounts}

关于用户的记忆（长期偏好/事实/习惯，请在回复时自然运用）：
${memoryBlock}`;
}
