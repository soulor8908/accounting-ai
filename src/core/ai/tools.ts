/**
 * AI Function Calling 工具定义
 * 让 AI 能通过工具调用完成记账操作
 */
import { formatMoney } from '../engine/engine';
import { analyzeTrends, formatTrendReport } from '../analytics/trends';
import { store, memoryStore } from '../../ui/appState';
import { ValidationError } from '../store/store';
import type { MemoryCategory } from '../store/memory';
import type { Account, AccountType, InstallmentPlan, LoanMeta, RecurringRule, Transaction, TxType } from '../types';

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  result: string;
  success: boolean;
}

/** OpenAI 兼容的 function 定义 */
export const AI_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'add_transaction',
      description: '记一笔账（支出/收入/转账/还款）',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['expense', 'income', 'transfer', 'repayment'],
            description: '交易类型',
          },
          amount: { type: 'number', description: '金额' },
          description: { type: 'string', description: '描述，如"午饭""工资"' },
          accountName: { type: 'string', description: '账户名（可选，不填自动选择）' },
          toAccountName: { type: 'string', description: '转账/还款目标账户名' },
          date: { type: 'string', description: '日期 YYYY-MM-DD（可选，默认今天）' },
        },
        required: ['type', 'amount', 'description'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_transactions',
      description: '查询流水记录，可按月份/账户/类型筛选',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: '月份 YYYY-MM（可选）' },
          accountName: { type: 'string', description: '账户名（可选）' },
          type: { type: 'string', enum: ['expense', 'income', 'transfer', 'repayment', 'refund'], description: '交易类型（可选）' },
          limit: { type: 'number', description: '返回条数上限（默认20）' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_transaction',
      description: '删除指定流水记录（按ID或描述模糊匹配）。必须先不带 confirm 调用获取预览，用户确认后再带 confirm=true 执行删除。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '流水ID（可选）' },
          descriptionKeyword: { type: 'string', description: '描述关键词（可选，用于模糊查找）' },
          confirm: { type: 'boolean', description: '是否确认执行删除（首次调用应为 false 或不传，返回预览；用户确认后传 true）' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_transaction',
      description: '编辑流水记录（修改描述/金额/日期/分类）',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '流水ID（可选）' },
          descriptionKeyword: { type: 'string', description: '描述关键词（可选，用于模糊查找）' },
          newDescription: { type: 'string', description: '新描述' },
          newAmount: { type: 'number', description: '新金额' },
          newDate: { type: 'string', description: '新日期 YYYY-MM-DD' },
          newCategory: { type: 'string', description: '新分类' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_balance',
      description: '查询账户余额和总资产',
      parameters: {
        type: 'object',
        properties: {
          accountName: { type: 'string', description: '账户名（可选，不填返回全部）' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_summary',
      description: '查询统计信息：月度收支、分类统计',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: '月份 YYYY-MM（可选，默认本月）' },
          scope: { type: 'string', enum: ['month', 'today'], description: '统计范围（默认month）' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_overview',
      description: '一次性查询账户全局概览：本月支出、总资产/总负债/净资产、下月待还总额（贷款月供+分期+周期规则）。用户问「这个月花了多少、还剩多少、下月要还多少」等汇总问题时优先调用此工具，避免多次调用。',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: '月份 YYYY-MM（可选，默认本月）' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'analyze_trends',
      description: '消费趋势分析：计算指定月份的支出/收入环比（对比上月）与同比（对比去年同月）、各分类增减、最大涨/跌幅分类，以及按当前节奏预测的全月支出。用户问「这个月比上个月如何」「消费趋势」「环比/同比」「哪些类别涨了」时调用，避免手动翻阅 list_transactions 计算。',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: '参考月份 YYYY-MM（可选，默认本月）' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_upcoming_payments',
      description: '查询未来待还款项明细：贷款月供、分期计划、周期还款规则。用户问「下个月要还多少」「有哪些待还」时调用。',
      parameters: {
        type: 'object',
        properties: {
          months: { type: 'number', description: '查询未来几个月（默认1，即下个月）' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_account',
      description: '添加新账户',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '账户名' },
          type: {
            type: 'string',
            enum: ['wallet', 'alipay', 'cash', 'debit', 'credit', 'loan', 'installment'],
            description: '账户类型',
          },
          balance: { type: 'number', description: '初始余额' },
        },
        required: ['name', 'type', 'balance'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_accounts',
      description: '列出所有账户',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_memories',
      description: '查看 AI 记忆。记忆包含用户的长期偏好、事实、行为习惯，可按类型筛选。用户问「你记得我什么」「我的偏好」时调用。',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['fact', 'habit', 'preference'],
            description: '记忆类型（可选）：fact=事实，habit=行为习惯，preference=偏好',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_memory',
      description: '添加一条 AI 记忆。当用户主动说「记住我喜欢…」「以后记住…」或透露长期偏好/事实时调用。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '记忆内容，简洁陈述句，如「偏好用微信零钱支付」' },
          category: {
            type: 'string',
            enum: ['fact', 'habit', 'preference'],
            description: '记忆类型（默认 fact）',
          },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_memory',
      description: '修改已有记忆的内容。用户说「把那条记忆改成…」时，先按关键词查到 id 再调用。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '记忆ID（可选）' },
          keyword: { type: 'string', description: '内容关键词（可选，用于模糊查找）' },
          newContent: { type: 'string', description: '新内容' },
          newCategory: {
            type: 'string',
            enum: ['fact', 'habit', 'preference'],
            description: '新类型（可选）',
          },
        },
        required: ['newContent'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_memory',
      description: '删除指定记忆。用户说「忘掉…」「删除那条记忆」时调用。建议先列出确认后再删。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '记忆ID（可选）' },
          keyword: { type: 'string', description: '内容关键词（可选，用于模糊查找）' },
          confirm: { type: 'boolean', description: '是否确认执行删除（首次应为 false，返回预览；确认后传 true）' },
        },
      },
    },
  },
];

const TX_TYPE_LABEL: Record<string, string> = {
  income: '收入',
  expense: '支出',
  transfer: '转账',
  repayment: '还款',
  refund: '退款',
  adjustment: '调账',
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 执行工具调用 */
export function executeTool(call: ToolCall): ToolResult {
  try {
    switch (call.name) {
      case 'add_transaction':
        return execAddTransaction(call.arguments);
      case 'list_transactions':
        return execListTransactions(call.arguments);
      case 'delete_transaction':
        return execDeleteTransaction(call.arguments);
      case 'update_transaction':
        return execUpdateTransaction(call.arguments);
      case 'query_balance':
        return execQueryBalance(call.arguments);
      case 'query_summary':
        return execQuerySummary(call.arguments);
      case 'query_overview':
        return execQueryOverview(call.arguments);
      case 'analyze_trends':
        return execAnalyzeTrends(call.arguments);
      case 'query_upcoming_payments':
        return execQueryUpcomingPayments(call.arguments);
      case 'add_account':
        return execAddAccount(call.arguments);
      case 'list_accounts':
        return execListAccounts();
      case 'list_memories':
        return execListMemories(call.arguments);
      case 'add_memory':
        return execAddMemory(call.arguments);
      case 'update_memory':
        return execUpdateMemory(call.arguments);
      case 'delete_memory':
        return execDeleteMemory(call.arguments);
      default:
        return { name: call.name, result: `未知工具: ${call.name}`, success: false };
    }
  } catch (e) {
    const msg = e instanceof ValidationError ? e.message : e instanceof Error ? e.message : '执行失败';
    return { name: call.name, result: msg, success: false };
  }
}

function execAddTransaction(args: Record<string, unknown>): ToolResult {
  const type = args.type as TxType;
  const amount = Number(args.amount);
  const description = args.description as string;
  const accountName = args.accountName as string | undefined;
  const toAccountName = args.toAccountName as string | undefined;
  const date = (args.date as string) || todayStr();

  if (store.state.accounts.length === 0) {
    return { name: 'add_transaction', result: '还没有任何账户，请先添加账户', success: false };
  }

  // 查找账户
  let accountId: string;
  if (accountName) {
    const matches = store.resolveAccounts(accountName);
    if (matches.length === 0) {
      return { name: 'add_transaction', result: `没找到账户「${accountName}」`, success: false };
    }
    accountId = matches[0].id;
  } else {
    // 自动选择第一个资产账户
    const assetTypes = ['wallet', 'alipay', 'cash', 'debit'];
    const acc = store.state.accounts.find((a: Account) => assetTypes.includes(a.type));
    if (!acc) return { name: 'add_transaction', result: '没有可用的资产账户', success: false };
    accountId = acc.id;
  }

  let relatedAccountId: string | undefined;
  if ((type === 'transfer' || type === 'repayment') && toAccountName) {
    const matches = store.resolveAccounts(toAccountName);
    if (matches.length === 0) {
      return { name: 'add_transaction', result: `没找到目标账户「${toAccountName}」`, success: false };
    }
    relatedAccountId = matches[0].id;
  }

  const { tx, warnings } = store.applyTransaction({
    type,
    amount,
    accountId,
    relatedAccountId,
    category: description,
    description,
    date,
  });

  const acc = store.getAccount(accountId);
  let result = `已记${TX_TYPE_LABEL[type]} ¥${formatMoney(tx.amount)}（${description}），「${acc?.name ?? '?'}」余额 ¥${formatMoney(acc?.balance ?? 0)}`;
  if (warnings.length > 0) result += `。⚠️ ${warnings.join('；')}`;
  return { name: 'add_transaction', result, success: true };
}

function execListTransactions(args: Record<string, unknown>): ToolResult {
  const month = args.month as string | undefined;
  const accountName = args.accountName as string | undefined;
  const type = args.type as string | undefined;
  const limit = Number(args.limit) || 20;

  let txs: Transaction[] = [...store.state.transactions];
  if (month) txs = txs.filter((t: Transaction) => t.date.startsWith(month));
  if (type) txs = txs.filter((t: Transaction) => t.type === type);
  if (accountName) {
    const matches = store.resolveAccounts(accountName);
    if (matches.length > 0) txs = txs.filter((t: Transaction) => t.accountId === matches[0].id);
  }
  txs.sort((a: Transaction, b: Transaction) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')));
  txs = txs.slice(0, limit);

  if (txs.length === 0) return { name: 'list_transactions', result: '没有找到符合条件的流水记录', success: true };

  const lines = txs.map((t: Transaction) => {
    const acc = store.getAccount(t.accountId);
    const sign = t.type === 'income' || t.type === 'refund' ? '+' : '-';
    return `${t.date} ${TX_TYPE_LABEL[t.type]} ${sign}¥${formatMoney(t.amount)} ${t.description || t.category}（${acc?.name ?? '?'}）`;
  });
  return { name: 'list_transactions', result: `找到 ${txs.length} 笔：\n${lines.join('\n')}`, success: true };
}

function execDeleteTransaction(args: Record<string, unknown>): ToolResult {
  const id = args.id as string | undefined;
  const keyword = args.descriptionKeyword as string | undefined;
  const confirm = args.confirm === true;

  // 定位目标流水
  let target: Transaction | undefined;
  if (id) {
    target = store.state.transactions.find((t: Transaction) => t.id === id);
    if (!target) return { name: 'delete_transaction', result: `没找到ID为 ${id} 的流水`, success: false };
  } else if (keyword) {
    const found = store.state.transactions.filter((t: Transaction) => (t.description || t.category).includes(keyword));
    if (found.length === 0) return { name: 'delete_transaction', result: `没找到包含「${keyword}」的流水`, success: false };
    if (found.length > 1) {
      const preview = found.slice(0, 5).map((t) => `${t.date} ${t.description || t.category} ¥${formatMoney(t.amount)}（id=${t.id}）`).join('\n');
      return { name: 'delete_transaction', result: `找到 ${found.length} 笔包含「${keyword}」的流水，请提供更精确的信息：\n${preview}`, success: false };
    }
    target = found[0];
  } else {
    return { name: 'delete_transaction', result: '请提供流水ID或描述关键词', success: false };
  }

  // 二次确认：未确认时只返回预览
  if (!confirm) {
    return {
      name: 'delete_transaction',
      result: `即将删除：${target.date} ${target.description || target.category} ¥${formatMoney(target.amount)}（id=${target.id}）。请向用户确认后，带 confirm=true 再次调用以执行删除。`,
      success: true,
    };
  }

  const tx = store.deleteTransaction(target.id);
  if (!tx) return { name: 'delete_transaction', result: `删除失败：流水已不存在`, success: false };
  return { name: 'delete_transaction', result: `已删除：${tx.date} ${tx.description || tx.category} ¥${formatMoney(tx.amount)}`, success: true };
}

function execUpdateTransaction(args: Record<string, unknown>): ToolResult {
  const id = args.id as string | undefined;
  const keyword = args.descriptionKeyword as string | undefined;

  let targetId = id;
  if (!targetId && keyword) {
    const found = store.state.transactions.filter((t: Transaction) => (t.description || t.category).includes(keyword));
    if (found.length === 0) return { name: 'update_transaction', result: `没找到包含「${keyword}」的流水`, success: false };
    if (found.length > 1) return { name: 'update_transaction', result: `找到 ${found.length} 笔，请提供更精确的信息`, success: false };
    targetId = found[0].id;
  }

  if (!targetId) return { name: 'update_transaction', result: '请提供流水ID或描述关键词', success: false };

  const patch: Record<string, unknown> = {};
  if (args.newDescription !== undefined) patch.description = args.newDescription;
  if (args.newAmount !== undefined) patch.amount = Number(args.newAmount);
  if (args.newDate !== undefined) patch.date = args.newDate;
  if (args.newCategory !== undefined) patch.category = args.newCategory;

  const tx = store.updateTransaction(targetId, patch);
  if (!tx) return { name: 'update_transaction', result: `没找到ID为 ${targetId} 的流水`, success: false };

  return { name: 'update_transaction', result: `已更新：${tx.date} ${tx.description || tx.category} ¥${formatMoney(tx.amount)}`, success: true };
}

function execQueryBalance(args: Record<string, unknown>): ToolResult {
  const accountName = args.accountName as string | undefined;
  if (accountName) {
    const matches = store.resolveAccounts(accountName);
    if (matches.length === 0) return { name: 'query_balance', result: `没找到账户「${accountName}」`, success: false };
    const acc = matches[0];
    return { name: 'query_balance', result: `「${acc.name}」当前余额 ¥${formatMoney(acc.balance)}`, success: true };
  }
  const assets = store.getTotalAssets();
  const liabilities = store.getTotalLiabilities();
  const lines = store.state.accounts.map((a: Account) => `「${a.name}」¥${formatMoney(a.balance)}`);
  return {
    name: 'query_balance',
    result: `${lines.join('，')}。总资产 ¥${formatMoney(assets)}，总负债 ¥${formatMoney(liabilities)}，净资产 ¥${formatMoney(assets - liabilities)}`,
    success: true,
  };
}

function execQuerySummary(args: Record<string, unknown>): ToolResult {
  const scope = (args.scope as string) || 'month';
  const today = todayStr();
  if (scope === 'today') {
    const txs = store.state.transactions.filter((t: Transaction) => t.date === today);
    const expense = txs.filter((t: Transaction) => t.type === 'expense').reduce((s: number, t: Transaction) => s + t.amount, 0);
    const income = txs.filter((t: Transaction) => t.type === 'income' || t.type === 'refund').reduce((s: number, t: Transaction) => s + t.amount, 0);
    return { name: 'query_summary', result: `今天（${today}）支出 ¥${formatMoney(expense)}，收入 ¥${formatMoney(income)}，共 ${txs.length} 笔`, success: true };
  }
  const month = (args.month as string) || today.slice(0, 7);
  const s = store.getMonthlySummary(month);
  const cats = store.getCategoryStats(month).slice(0, 5);
  const catLines = cats.map((c: { category: string; amount: number }) => `${c.category} ¥${formatMoney(c.amount)}`).join('，');
  let result = `本月（${month}）支出 ¥${formatMoney(s.expense)}，收入 ¥${formatMoney(s.income)}，结余 ¥${formatMoney(s.income - s.expense)}，共 ${s.count} 笔`;
  if (catLines) result += `。分类：${catLines}`;
  return { name: 'query_summary', result, success: true };
}

/** 计算「下个月」的 YYYY-MM */
function nextMonthStr(yyyy_mm: string): string {
  const [y, m] = yyyy_mm.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 收集所有「下月待还」项：贷款月供 + 进行中的分期 + 生效中的周期还款规则 */
function collectUpcomingPayments(targetMonth: string): Array<{ name: string; amount: number; dueDate: string; kind: string }> {
  const items: Array<{ name: string; amount: number; dueDate: string; kind: string }> = [];

  // 1. 贷款账户月供
  for (const acc of store.state.accounts) {
    if (acc.meta?.kind === 'loan') {
      const loan = acc.meta as LoanMeta;
      // nextDueDate 落在目标月份即计入
      if (loan.nextDueDate?.startsWith(targetMonth)) {
        items.push({ name: `${acc.name}月供`, amount: loan.monthlyPayment, dueDate: loan.nextDueDate, kind: '贷款' });
      }
    }
  }

  // 2. 进行中的分期计划
  for (const plan of store.state.installmentPlans as InstallmentPlan[]) {
    if (plan.status === 'active' && plan.nextDueDate?.startsWith(targetMonth)) {
      items.push({ name: `${plan.name} 第${plan.paidTerms + 1}期`, amount: plan.monthlyPayment, dueDate: plan.nextDueDate, kind: '分期' });
    }
  }

  // 3. 生效中的周期还款规则（按 dayOfMonth 落在目标月）
  for (const rule of store.state.recurringRules as RecurringRule[]) {
    if (!rule.active) continue;
    if (rule.type === 'repayment' || rule.type === 'expense') {
      // 构造目标月的还款日
      const [yy, mm] = targetMonth.split('-').map(Number);
      const dueDate = `${targetMonth}-${String(rule.dayOfMonth).padStart(2, '0')}`;
      items.push({ name: rule.name || rule.description, amount: rule.amount, dueDate, kind: '周期规则' });
      void yy; void mm;
    }
  }

  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function execQueryOverview(args: Record<string, unknown>): ToolResult {
  const today = todayStr();
  const month = (args.month as string) || today.slice(0, 7);
  const nextMonth = nextMonthStr(month);

  // 本月收支
  const s = store.getMonthlySummary(month);
  // 总资产/负债/净资产
  const assets = store.getTotalAssets();
  const liabilities = store.getTotalLiabilities();
  const netWorth = assets - liabilities;
  // 下月待还
  const upcoming = collectUpcomingPayments(nextMonth);
  const upcomingTotal = upcoming.reduce((sum, x) => sum + x.amount, 0);

  const lines: string[] = [];
  lines.push(`【本月收支 ${month}】支出 ¥${formatMoney(s.expense)}，收入 ¥${formatMoney(s.income)}，结余 ¥${formatMoney(s.income - s.expense)}`);
  lines.push(`【账户总览】总资产 ¥${formatMoney(assets)}，总负债 ¥${formatMoney(liabilities)}，净资产 ¥${formatMoney(netWorth)}`);
  if (upcoming.length > 0) {
    const detail = upcoming.map((x) => `${x.name} ¥${formatMoney(x.amount)}（${x.dueDate}）`).join('；');
    lines.push(`【下月待还 ${nextMonth}】共 ¥${formatMoney(upcomingTotal)}，${upcoming.length} 项：${detail}`);
  } else {
    lines.push(`【下月待还 ${nextMonth}】无待还款项`);
  }
  return { name: 'query_overview', result: lines.join('\n'), success: true };
}

function execAnalyzeTrends(args: Record<string, unknown>): ToolResult {
  const month = (args.month as string) || todayStr().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { name: 'analyze_trends', result: 'month 格式应为 YYYY-MM', success: false };
  }
  const report = analyzeTrends(store.state.transactions, { referenceMonth: month });
  return { name: 'analyze_trends', result: formatTrendReport(report), success: true };
}

function execQueryUpcomingPayments(args: Record<string, unknown>): ToolResult {
  const months = Math.max(1, Math.min(6, Number(args.months) || 1));
  const today = todayStr();
  const lines: string[] = [];
  let grandTotal = 0;

  for (let i = 1; i <= months; i++) {
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() + i);
    const targetMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const items = collectUpcomingPayments(targetMonth);
    const monthTotal = items.reduce((sum, x) => sum + x.amount, 0);
    grandTotal += monthTotal;
    if (items.length > 0) {
      const detail = items.map((x) => `${x.name} ¥${formatMoney(x.amount)}（${x.dueDate}）`).join('；');
      lines.push(`${targetMonth}：共 ¥${formatMoney(monthTotal)}，${items.length} 项 — ${detail}`);
    } else {
      lines.push(`${targetMonth}：无待还款项`);
    }
  }

  if (months > 1) {
    lines.push(`合计：¥${formatMoney(grandTotal)}`);
  }
  return { name: 'query_upcoming_payments', result: lines.join('\n'), success: true };
}

function execAddAccount(args: Record<string, unknown>): ToolResult {
  const name = args.name as string;
  const type = args.type as AccountType;
  const balance = Number(args.balance) || 0;
  store.addAccount({ name, type, balance });
  return { name: 'add_account', result: `已添加账户「${name}」`, success: true };
}

function execListAccounts(): ToolResult {
  if (store.state.accounts.length === 0) return { name: 'list_accounts', result: '还没有任何账户', success: true };
  const lines = store.state.accounts.map((a: Account) => `「${a.name}」（${a.type}）余额 ¥${formatMoney(a.balance)}`);
  return { name: 'list_accounts', result: lines.join('；'), success: true };
}

const MEMORY_CATEGORY_LABEL: Record<MemoryCategory, string> = {
  fact: '事实',
  habit: '习惯',
  preference: '偏好',
};

function execListMemories(args: Record<string, unknown>): ToolResult {
  const category = args.category as MemoryCategory | undefined;
  const memories = category ? memoryStore.listByCategory(category) : memoryStore.list();
  if (memories.length === 0) {
    return {
      name: 'list_memories',
      result: category ? `没有${MEMORY_CATEGORY_LABEL[category]}类记忆` : '暂无任何记忆',
      success: true,
    };
  }
  const lines = memories.map(
    (m) => `[${MEMORY_CATEGORY_LABEL[m.category]}${m.source === 'auto' ? '/自动' : ''}] ${m.content}（id=${m.id}）`,
  );
  return { name: 'list_memories', result: `共 ${memories.length} 条记忆：\n${lines.join('\n')}`, success: true };
}

function execAddMemory(args: Record<string, unknown>): ToolResult {
  const content = (args.content as string | undefined)?.trim();
  if (!content) return { name: 'add_memory', result: '记忆内容不能为空', success: false };
  const category = (args.category as MemoryCategory | undefined) ?? 'fact';
  // 去重：与已有记忆相似则提示
  if (memoryStore.hasSimilar(content)) {
    return { name: 'add_memory', result: `已存在相似记忆，未重复添加：「${content}」`, success: true };
  }
  const m = memoryStore.add({ content, category, source: 'manual' });
  return {
    name: 'add_memory',
    result: `已记住（${MEMORY_CATEGORY_LABEL[m.category]}）：${m.content}`,
    success: true,
  };
}

function execUpdateMemory(args: Record<string, unknown>): ToolResult {
  const id = args.id as string | undefined;
  const keyword = args.keyword as string | undefined;
  const newContent = (args.newContent as string | undefined)?.trim();
  const newCategory = args.newCategory as MemoryCategory | undefined;

  if (!newContent) return { name: 'update_memory', result: '新内容不能为空', success: false };

  let targetId = id;
  if (!targetId && keyword) {
    const found = memoryStore.list().filter((m) => m.content.includes(keyword));
    if (found.length === 0) return { name: 'update_memory', result: `没找到包含「${keyword}」的记忆`, success: false };
    if (found.length > 1) {
      const preview = found.slice(0, 5).map((m) => `${m.content}（id=${m.id}）`).join('\n');
      return { name: 'update_memory', result: `找到 ${found.length} 条，请提供更精确的信息：\n${preview}`, success: false };
    }
    targetId = found[0].id;
  }
  if (!targetId) return { name: 'update_memory', result: '请提供记忆ID或关键词', success: false };

  const patch: { content?: string; category?: MemoryCategory } = { content: newContent };
  if (newCategory) patch.category = newCategory;
  const m = memoryStore.update(targetId, patch);
  if (!m) return { name: 'update_memory', result: `没找到ID为 ${targetId} 的记忆`, success: false };
  return { name: 'update_memory', result: `已更新记忆：${m.content}`, success: true };
}

function execDeleteMemory(args: Record<string, unknown>): ToolResult {
  const id = args.id as string | undefined;
  const keyword = args.keyword as string | undefined;
  const confirm = args.confirm === true;

  let target = id ? memoryStore.get(id) : undefined;
  if (!target && keyword) {
    const found = memoryStore.list().filter((m) => m.content.includes(keyword));
    if (found.length === 0) return { name: 'delete_memory', result: `没找到包含「${keyword}」的记忆`, success: false };
    if (found.length > 1) {
      const preview = found.slice(0, 5).map((m) => `${m.content}（id=${m.id}）`).join('\n');
      return { name: 'delete_memory', result: `找到 ${found.length} 条，请提供更精确的信息：\n${preview}`, success: false };
    }
    target = found[0];
  }
  if (!target) return { name: 'delete_memory', result: '请提供记忆ID或关键词', success: false };

  if (!confirm) {
    return {
      name: 'delete_memory',
      result: `即将删除记忆：「${target.content}」（id=${target.id}）。请向用户确认后，带 confirm=true 再次调用以执行删除。`,
      success: true,
    };
  }

  const removed = memoryStore.remove(target.id);
  if (!removed) return { name: 'delete_memory', result: '删除失败：记忆已不存在', success: false };
  return { name: 'delete_memory', result: `已删除记忆：「${removed.content}」`, success: true };
}
