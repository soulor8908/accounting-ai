import { describe, expect, it } from 'vitest';
import { analyzeTrends, formatTrendReport, pctChange, prevMonth, yearAgoMonth } from '../../../src/core/analytics/trends';
import type { Transaction } from '../../../src/core/types';

function tx(date: string, type: Transaction['type'], amount: number, category: string): Transaction {
  return {
    id: `t-${date}-${category}-${amount}`,
    date,
    type,
    amount,
    accountId: 'a1',
    category,
    description: category,
    tags: [],
    createdAt: `${date}T00:00:00.000Z`,
  };
}

/** 三个月数据：2025-06（同比基准）、2026-05（上月）、2026-06（本月） */
function sampleTxns(): Transaction[] {
  return [
    // 2026-06 本月
    tx('2026-06-03', 'expense', 900, '餐饮'),
    tx('2026-06-10', 'expense', 400, '交通'),
    tx('2026-06-15', 'income', 5000, '工资'),
    // 2026-05 上月
    tx('2026-05-04', 'expense', 600, '餐饮'),
    tx('2026-05-12', 'expense', 400, '交通'),
    tx('2026-05-20', 'income', 5000, '工资'),
    // 2025-06 去年同月
    tx('2025-06-05', 'expense', 700, '餐饮'),
    tx('2025-06-18', 'expense', 400, '交通'),
    tx('2025-06-22', 'income', 4000, '工资'),
  ];
}

describe('trends helpers', () => {
  it('prevMonth / yearAgoMonth 跨年正确', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(prevMonth('2026-03')).toBe('2026-02');
    expect(yearAgoMonth('2026-01')).toBe('2025-01');
    expect(yearAgoMonth('2026-12')).toBe('2025-12');
  });

  it('pctChange 正常与除零保护', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(0, 100)).toBe(-100);
  });
});

describe('analyzeTrends', () => {
  const now = new Date(2026, 5, 15); // 2026-06-15，本月进行中

  it('计算环比/同比/分类变化/预测', () => {
    const r = analyzeTrends(sampleTxns(), { now, referenceMonth: '2026-06' });

    expect(r.referenceMonth).toBe('2026-06');
    // 支出：本月 1300，上月 1000 → +30%
    expect(r.expense.current).toBe(1300);
    expect(r.expense.previous).toBe(1000);
    expect(r.expense.delta).toBe(300);
    expect(r.expense.pct).toBe(30);
    // 同比：去年 1100 → (1300-1100)/1100 = 18.18%
    expect(r.expense.yearAgo).toBe(1100);
    expect(r.expense.yoyPct).toBe(18.18);

    // 收入：本月 5000，上月 5000 → 0%
    expect(r.income.current).toBe(5000);
    expect(r.income.pct).toBe(0);
    expect(r.income.yoyPct).toBe(25);

    // 分类变化：餐饮 current 900 prev 600 delta 300 pct 50；交通 400/400 0
    const food = r.categoryChanges.find((c) => c.category === '餐饮')!;
    expect(food.current).toBe(900);
    expect(food.previous).toBe(600);
    expect(food.delta).toBe(300);
    expect(food.pct).toBe(50);

    expect(r.topRisers.map((c) => c.category)).toEqual(['餐饮']);
    expect(r.topFallers).toHaveLength(0);

    // 进行中月份：第 15 天，日均 = 1300/15，预计 = 日均 * 30
    expect(r.daysElapsed).toBe(15);
    expect(r.daysInMonth).toBe(30);
    expect(r.dailyAvgExpense).toBeCloseTo(86.67, 2);
    expect(r.projectedMonthExpense).toBe(2600);
  });

  it('已结束月份：按完整月天数推算，预计=实际', () => {
    const r = analyzeTrends(sampleTxns(), { now: new Date(2026, 6, 15), referenceMonth: '2026-06' });
    expect(r.daysElapsed).toBe(30);
    expect(r.projectedMonthExpense).toBe(1300);
  });

  it('空数据：不产生 NaN，提示先记账', () => {
    const r = analyzeTrends([], { now, referenceMonth: '2026-06' });
    expect(r.expense.current).toBe(0);
    expect(r.expense.pct).toBeNull();
    expect(r.insights.some((s) => s.includes('暂无支出'))).toBe(true);
    expect(Number.isNaN(r.projectedMonthExpense)).toBe(false);
  });
});

describe('formatTrendReport', () => {
  it('输出含标题、环比、涨跌与洞察', () => {
    const r = analyzeTrends(sampleTxns(), { now: new Date(2026, 5, 15), referenceMonth: '2026-06' });
    const text = formatTrendReport(r);
    expect(text).toContain('【消费趋势 2026年6月】');
    expect(text).toContain('支出');
    expect(text).toContain('↑ 增长');
    expect(text).toContain('餐饮');
    expect(text).toContain('按当前节奏');
  });
});
