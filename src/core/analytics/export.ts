/**
 * 月度报表导出（P2 报表导出）
 * - buildMonthlyReport：从 Store 聚合月度汇总 + 分类支出 + 异常数（纯函数，可测试）
 * - reportToCsv：导出 CSV 文本（含中文安全转义）
 * UI 侧把文本/图片下载的逻辑放在 src/ui/chartExport.ts，本模块不依赖 DOM。
 */
import type { Store } from '../store/store';
import { detectAnomalies } from './anomaly';

export interface MonthlyReportRow {
  category: string;
  amount: number;
  count: number;
}

export interface MonthlyReport {
  month: string;
  expense: number;
  income: number;
  count: number;
  rows: MonthlyReportRow[];
  anomalyCount: number;
}

export function buildMonthlyReport(store: Store, month: string): MonthlyReport {
  const summary = store.getMonthlySummary(month);
  const anomalies = detectAnomalies(store.state.transactions, { referenceMonth: month });

  // 分类支出 + 笔数（按金额降序）
  const catMap = new Map<string, { amount: number; count: number }>();
  for (const t of store.state.transactions) {
    if (!t.date.startsWith(month) || t.type !== 'expense') continue;
    const e = catMap.get(t.category) ?? { amount: 0, count: 0 };
    e.amount += t.amount;
    e.count += 1;
    catMap.set(t.category, e);
  }
  const rows = [...catMap.entries()]
    .map(([category, v]) => ({ category, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount);

  return {
    month,
    expense: summary.expense,
    income: summary.income,
    count: summary.count,
    rows,
    anomalyCount: anomalies.anomalies.length,
  };
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 月度报表 → CSV 文本（UTF-8，带 BOM 便于 Excel 识别中文） */
export function reportToCsv(r: MonthlyReport, appName = '智能记账AI助手'): string {
  const lines: string[] = [];
  lines.push([csvCell(`${appName} 月度报表`), csvCell(r.month)].join(','));
  lines.push(['月份', '类别', '金额(元)', '笔数'].map(csvCell).join(','));
  for (const row of r.rows) {
    lines.push([r.month, row.category, row.amount.toFixed(2), row.count].map(csvCell).join(','));
  }
  lines.push(['合计', '', '', r.count].map(csvCell).join(','));
  lines.push(['支出合计', csvCell(r.expense.toFixed(2))].join(','));
  lines.push(['收入合计', csvCell(r.income.toFixed(2))].join(','));
  lines.push(['异常笔数', csvCell(r.anomalyCount)].join(','));
  return '﻿' + lines.join('\n');
}
