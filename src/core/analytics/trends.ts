/**
 * 消费趋势分析（确定性纯函数，无 DOM / 无 AI 依赖）
 *
 * 输入交易流水 + 参考日期，输出：
 *   - 支出/收入的 环比（上月）与 同比（去年同月）
 *   - 各分类相对上月的增减与变化率（找最大涨/跌幅分类）
 *   - 按当前节奏预测全月支出（run-rate）
 *   - 可直接喂给 AI 的结构化报告 + 中文自然语言洞察
 *
 * 这是「消费分析」Agent 的喂数据层，也是离线引擎与统计页共用的计算内核。
 * 设计原则（卡帕西视角）：AI 只负责"表达洞察"，所有数值由本模块确定性算出。
 */
import { type Transaction } from '../types';
import { round2 } from '../utils/money';

/** 单个指标（支出/收入）的环比 + 同比对照 */
export interface MonthMetric {
  current: number;
  previous: number;
  delta: number;
  /** 环比变化率（%），前值为 0 时为 null */
  pct: number | null;
  /** 去年同月数值（无数据则 null） */
  yearAgo: number | null;
  /** 同比变化率（%），null 表示去年无数据 */
  yoyPct: number | null;
}

/** 单个分类相对上月的增减 */
export interface CategoryChange {
  category: string;
  current: number;
  previous: number;
  delta: number;
  /** 变化率（%），上月为 0 时为 null（视为新增分类） */
  pct: number | null;
}

export interface TrendReport {
  referenceMonth: string; // YYYY-MM
  reportDate: string; // YYYY-MM-DD
  daysElapsed: number;
  daysInMonth: number;
  expense: MonthMetric;
  income: MonthMetric;
  dailyAvgExpense: number;
  projectedMonthExpense: number;
  categoryChanges: CategoryChange[];
  topRisers: CategoryChange[];
  topFallers: CategoryChange[];
  insights: string[];
}

const EPS = 0.0001;

function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

export function prevMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function yearAgoMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return `${y - 1}-${String(m).padStart(2, '0')}`;
}

function daysInMonthOf(yyyymm: string): number {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function aggregate(txns: Transaction[], yyyymm: string) {
  const byCategory = new Map<string, number>();
  let expense = 0;
  let income = 0;
  let count = 0;
  for (const t of txns) {
    if (monthKeyOf(t.date) !== yyyymm) continue;
    count++;
    if (t.type === 'expense') {
      expense = round2(expense + t.amount);
      byCategory.set(t.category, round2((byCategory.get(t.category) ?? 0) + t.amount));
    } else if (t.type === 'income' || t.type === 'refund') {
      income = round2(income + t.amount);
    }
  }
  return { expense, income, count, byCategory };
}

/** 变化率：相对 previous 的百分比；previous 为 0 时返回 null */
export function pctChange(current: number, previous: number): number | null {
  if (Math.abs(previous) < EPS) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

export interface AnalyzeOptions {
  /** 参考日期，默认当前时间 */
  now?: Date;
  /** 参考月份 YYYY-MM，默认 now 所在月 */
  referenceMonth?: string;
}

export function analyzeTrends(txns: Transaction[], opts: AnalyzeOptions = {}): TrendReport {
  const now = opts.now ?? new Date();
  const reportDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const referenceMonth = opts.referenceMonth ?? monthKeyOf(reportDate);
  const daysInMonth = daysInMonthOf(referenceMonth);

  const cur = aggregate(txns, referenceMonth);
  const prev = aggregate(txns, prevMonth(referenceMonth));
  const yoy = aggregate(txns, yearAgoMonth(referenceMonth));

  const expensePct = pctChange(cur.expense, prev.expense);
  const incomePct = pctChange(cur.income, prev.income);
  const expenseYoYPct = pctChange(cur.expense, yoy.expense);
  const incomeYoYPct = pctChange(cur.income, yoy.income);

  // 分类变化（取本月与上月出现过的全部分类并集）
  const allCats = new Set([...cur.byCategory.keys(), ...prev.byCategory.keys()]);
  const categoryChanges: CategoryChange[] = [];
  for (const cat of allCats) {
    const c = cur.byCategory.get(cat) ?? 0;
    const p = prev.byCategory.get(cat) ?? 0;
    categoryChanges.push({ category: cat, current: c, previous: p, delta: round2(c - p), pct: pctChange(c, p) });
  }
  categoryChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const topRisers = categoryChanges.filter((c) => c.delta > EPS).slice(0, 3);
  const topFallers = categoryChanges.filter((c) => c.delta < -EPS).slice(0, 3);

  const isCurrentMonth = referenceMonth === monthKeyOf(reportDate);
  const elapsed = isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth;
  const dailyAvgExpense = elapsed > 0 ? round2(cur.expense / elapsed) : 0;
  // 预测直接由总支出推算，避免先四舍五入日均再乘造成误差累积
  const projectedMonthExpense = elapsed > 0 ? round2((cur.expense / elapsed) * daysInMonth) : 0;

  const insights = buildInsights({
    referenceMonth,
    expense: { current: cur.expense, previous: prev.expense, pct: expensePct },
    income: { current: cur.income, previous: prev.income, pct: incomePct },
    topRisers,
    topFallers,
    projectedMonthExpense,
    hasExpense: cur.expense > EPS || prev.expense > EPS,
  });

  return {
    referenceMonth,
    reportDate,
    daysElapsed: elapsed,
    daysInMonth,
    expense: {
      current: cur.expense,
      previous: prev.expense,
      delta: round2(cur.expense - prev.expense),
      pct: expensePct,
      yearAgo: yoy.expense,
      yoyPct: expenseYoYPct,
    },
    income: {
      current: cur.income,
      previous: prev.income,
      delta: round2(cur.income - prev.income),
      pct: incomePct,
      yearAgo: yoy.income,
      yoyPct: incomeYoYPct,
    },
    dailyAvgExpense,
    projectedMonthExpense,
    categoryChanges,
    topRisers,
    topFallers,
    insights,
  };
}

interface InsightCtx {
  referenceMonth: string;
  expense: { current: number; previous: number; pct: number | null };
  income: { current: number; previous: number; pct: number | null };
  topRisers: CategoryChange[];
  topFallers: CategoryChange[];
  projectedMonthExpense: number;
  hasExpense: boolean;
}

function buildInsights(ctx: InsightCtx): string[] {
  const out: string[] = [];
  const fmt = (n: number) => `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pctStr = (p: number | null) => (p === null ? '新增' : `${p > 0 ? '+' : ''}${p}%`);
  const [y, m] = ctx.referenceMonth.split('-').map(Number);

  if (!ctx.hasExpense) {
    out.push(`${y}年${m}月暂无支出记录，先记几笔就能看到趋势啦。`);
    return out;
  }

  if (ctx.expense.previous <= EPS) {
    out.push(`${y}年${m}月支出 ${fmt(ctx.expense.current)}，上月无支出记录（开始记账的第一月）。`);
  } else {
    const dir = ctx.expense.pct === null ? '—' : ctx.expense.pct > 0 ? '上升' : ctx.expense.pct < 0 ? '下降' : '基本持平';
    const pctPart = ctx.expense.pct !== null && ctx.expense.pct !== 0 ? ` ${pctStr(ctx.expense.pct)}` : '';
    out.push(`${y}年${m}月支出 ${fmt(ctx.expense.current)}，环比${dir}${pctPart}（上月 ${fmt(ctx.expense.previous)}）。`);
  }

  if (ctx.income.current > EPS && ctx.income.previous > EPS && ctx.income.pct !== null) {
    const dir = ctx.income.pct > 0 ? '上升' : ctx.income.pct < 0 ? '下降' : '基本持平';
    const pctPart = ctx.income.pct !== 0 ? ` ${pctStr(ctx.income.pct)}` : '';
    out.push(`收入 ${fmt(ctx.income.current)}，环比${dir}${pctPart}。`);
  }

  if (ctx.topRisers.length > 0) {
    const top = ctx.topRisers[0];
    out.push(`涨幅最大：「${top.category}」${fmt(top.current)}（${pctStr(top.pct)}）。`);
  }
  if (ctx.topFallers.length > 0) {
    const top = ctx.topFallers[0];
    out.push(`降幅最大：「${top.category}」${fmt(top.current)}（${pctStr(top.pct)}）。`);
  }

  if (ctx.projectedMonthExpense > EPS && ctx.expense.current > 0) {
    out.push(`按当前节奏，本月预计总支出约 ${fmt(ctx.projectedMonthExpense)}。`);
  }

  return out;
}

/** 把结构化报告渲染为中文自然语言，供对话/AI 直接使用 */
export function formatTrendReport(r: TrendReport): string {
  const fmt = (n: number) => `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (p: number | null) => (p === null ? '—' : `${p > 0 ? '+' : ''}${p}%`);
  const [y, m] = r.referenceMonth.split('-').map(Number);
  const lines: string[] = [];
  lines.push(`【消费趋势 ${y}年${m}月】`);
  lines.push(`支出 ${fmt(r.expense.current)}（环比 ${pct(r.expense.pct)}，同比 ${pct(r.expense.yoyPct)}）`);
  lines.push(`收入 ${fmt(r.income.current)}（环比 ${pct(r.income.pct)}，同比 ${pct(r.income.yoyPct)}）`);
  if (r.daysElapsed < r.daysInMonth && r.expense.current > 0) {
    lines.push(`日均支出 ${fmt(r.dailyAvgExpense)}，预计全月约 ${fmt(r.projectedMonthExpense)}`);
  }
  if (r.topRisers.length > 0) {
    lines.push(`↑ 增长：${r.topRisers.map((c) => `${c.category} ${fmt(c.current)}（${pct(c.pct)}）`).join('；')}`);
  }
  if (r.topFallers.length > 0) {
    lines.push(`↓ 下降：${r.topFallers.map((c) => `${c.category} ${fmt(c.current)}（${pct(c.pct)}）`).join('；')}`);
  }
  if (r.insights.length > 0) {
    lines.push('', ...r.insights);
  }
  return lines.join('\n');
}
