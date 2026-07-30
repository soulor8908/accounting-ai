/**
 * 异常消费检测（确定性纯函数，无 DOM / 无 AI 依赖）
 *
 * 思想（卡帕西视角）：异常识别是统计问题，不该交给 LLM 凭感觉。
 * 用「参考月之前」的历史支出为每个分类建立基线（均值/标准差/最高值），
 * 再对参考月内的每笔支出打分：
 *   - z 分数 = (金额 - 基线均值) / 基线标准差，z ≥ 阈值 → 异常（高/中）
 *   - 创分类历史新高（且金额过 floor）→ 低严重度提示
 *
 * 输出可直接喂给「消费分析」Agent，也可在统计页直接列出。
 */
import { type Transaction } from '../types';
import { round2 } from '../utils/money';

export type Severity = 'high' | 'medium' | 'low';

export interface Anomaly {
  txn: Transaction;
  category: string;
  amount: number;
  baselineMean: number;
  baselineStd: number;
  /** z 分数；历史样本不足时为 null */
  zScore: number | null;
  severity: Severity;
  reason: string;
}

export interface AnomalyReport {
  referenceMonth: string;
  /** 参考月内被评估的支出笔数 */
  evaluated: number;
  /** 已按严重度 + 金额排序的异常列表 */
  anomalies: Anomaly[];
  insights: string[];
}

export interface AnomalyOptions {
  now?: Date;
  /** 参考月份 YYYY-MM，默认 now 所在月 */
  referenceMonth?: string;
  /** z 分数阈值（中严重度起点），默认 2.5 */
  zThreshold?: number;
  /** 金额绝对下限，低于此不视为异常，默认 100 */
  floor?: number;
  /** 计算 z 所需的最少历史样本，默认 5 */
  minSamples?: number;
  /** 返回条数上限，默认 8 */
  limit?: number;
}

const EPS = 0.0001;

function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

interface CatStats {
  mean: number;
  std: number;
  max: number;
  count: number;
}

function computeStats(values: number[]): CatStats {
  const count = values.length;
  if (count === 0) return { mean: 0, std: 0, max: 0, count: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / count;
  const variance = count > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (count - 1) : 0;
  const std = Math.sqrt(variance);
  const max = values.reduce((m, v) => (v > m ? v : m), values[0]);
  return { mean: round2(mean), std: round2(std), max: round2(max), count };
}

function fmt(n: number): string {
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function detectAnomalies(txns: Transaction[], opts: AnomalyOptions = {}): AnomalyReport {
  const now = opts.now ?? new Date();
  const referenceMonth = opts.referenceMonth ?? monthKeyOf(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  );
  const zThreshold = opts.zThreshold ?? 2.5;
  const floor = opts.floor ?? 100;
  const minSamples = opts.minSamples ?? 5;
  const limit = opts.limit ?? 8;

  // 基线：参考月之前、每个分类的全部历史支出
  const baseline = new Map<string, number[]>();
  for (const t of txns) {
    if (t.type !== 'expense') continue;
    if (monthKeyOf(t.date) >= referenceMonth) continue;
    const arr = baseline.get(t.category) ?? [];
    arr.push(t.amount);
    baseline.set(t.category, arr);
  }
  const statsMap = new Map<string, CatStats>();
  for (const [cat, vals] of baseline) statsMap.set(cat, computeStats(vals));

  // 评估参考月内的每笔支出
  const candidates: Anomaly[] = [];
  let evaluated = 0;
  for (const t of txns) {
    if (t.type !== 'expense') continue;
    if (monthKeyOf(t.date) !== referenceMonth) continue;
    evaluated++;
    if (t.amount < floor) continue;
    const s = statsMap.get(t.category);
    if (!s || s.count === 0) continue;

    const z = s.count >= minSamples && s.std >= EPS ? (t.amount - s.mean) / s.std : null;
    const isNewHigh = t.amount > s.max + EPS;

    let severity: Severity | null = null;
    if (z !== null && z >= 3) severity = 'high';
    else if (z !== null && z >= zThreshold) severity = 'medium';
    else if (isNewHigh && s.count >= 3) severity = 'low';

    if (!severity) continue;

    const reasonParts: string[] = [];
    if (z !== null) {
      reasonParts.push(`是「${t.category}」历史均值 ${fmt(s.mean)} 的约 ${round2(z).toFixed(1)} 倍`);
    }
    if (isNewHigh) reasonParts.push('创该分类历史新高');
    const reason = reasonParts.join('，') || '金额明显高于日常';

    candidates.push({
      txn: t,
      category: t.category,
      amount: t.amount,
      baselineMean: s.mean,
      baselineStd: s.std,
      zScore: z === null ? null : round2(z),
      severity,
      reason,
    });
  }

  const rank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
  candidates.sort((a, b) => rank[b.severity] - rank[a.severity] || b.amount - a.amount);
  const anomalies = candidates.slice(0, limit);

  const insights = buildInsights({ referenceMonth, evaluated, anomalies, hasBaseline: statsMap.size > 0 });
  return { referenceMonth, evaluated, anomalies, insights };
}

function buildInsights(ctx: {
  referenceMonth: string;
  evaluated: number;
  anomalies: Anomaly[];
  hasBaseline: boolean;
}): string[] {
  const out: string[] = [];
  const [y, m] = ctx.referenceMonth.split('-').map(Number);

  if (ctx.evaluated === 0) {
    out.push(`${y}年${m}月暂无支出记录，记几笔就能识别异常啦。`);
    return out;
  }
  if (!ctx.hasBaseline) {
    out.push('历史数据还太少，先多记几个月，异常识别会更准～');
    return out;
  }
  if (ctx.anomalies.length === 0) {
    out.push(`${y}年${m}月支出都在正常范围内，没发现明显异常 👍`);
    return out;
  }

  const high = ctx.anomalies.filter((a) => a.severity === 'high');
  const med = ctx.anomalies.filter((a) => a.severity === 'medium');
  out.push(`本月发现 ${ctx.anomalies.length} 笔可疑支出（高 ${high.length} / 中 ${med.length} / 低 ${ctx.anomalies.length - high.length - med.length}）。`);
  for (const a of ctx.anomalies.slice(0, 3)) {
    const tag = a.severity === 'high' ? '⚠️ 高额' : a.severity === 'medium' ? '⚠ 偏高' : '· 创新高';
    out.push(`${tag} ${a.txn.date} 「${a.category}」${fmt(a.amount)}（${a.reason}）`);
  }
  return out;
}

/** 把结构化报告渲染为中文自然语言，供对话/AI 直接使用 */
export function formatAnomalyReport(r: AnomalyReport): string {
  const [y, m] = r.referenceMonth.split('-').map(Number);
  const lines: string[] = [`【异常消费检测 ${y}年${m}月】`];
  if (r.anomalies.length === 0) {
    lines.push(r.insights[0] ?? '本月支出正常，未发现异常。');
    return lines.join('\n');
  }
  for (const a of r.anomalies) {
    const tag = a.severity === 'high' ? '高额' : a.severity === 'medium' ? '偏高' : '创新高';
    lines.push(`· ${a.txn.date} ${a.category} ${fmt(a.amount)} [${tag}] ${a.reason}`);
  }
  lines.push('', ...r.insights);
  return lines.join('\n');
}
