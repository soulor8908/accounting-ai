import { describe, expect, it } from 'vitest';
import { detectAnomalies, formatAnomalyReport, type Transaction } from '../../../src/core/analytics/anomaly';

function tx(id: string, date: string, amount: number, category: string): Transaction {
  return {
    id,
    date,
    type: 'expense',
    amount,
    accountId: 'a1',
    category,
    description: category,
    tags: [],
    createdAt: `${date}T00:00:00.000Z`,
  };
}

describe('detectAnomalies', () => {
  it('明显高于历史基线的支出被标记为高严重度', () => {
    const hist = [50, 45, 55, 40, 60, 48, 52, 47, 53, 49];
    const txns: Transaction[] = hist.map((amt, i) =>
      tx(`h${i}`, `2026-05-${String(i + 1).padStart(2, '0')}`, amt, '餐饮'),
    );
    txns.push(tx('spike', '2026-06-10', 200, '餐饮')); // 约 28σ 高于均值 50
    const r = detectAnomalies(txns, { referenceMonth: '2026-06' });
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0].severity).toBe('high');
    expect(r.anomalies[0].category).toBe('餐饮');
    expect(r.anomalies[0].zScore).not.toBeNull();
  });

  it('创新高但历史样本少/方差小 → 低严重度', () => {
    const txns: Transaction[] = [
      tx('h1', '2026-05-01', 50, '娱乐'),
      tx('h2', '2026-05-02', 50, '娱乐'),
      tx('h3', '2026-05-03', 50, '娱乐'),
      tx('new', '2026-06-05', 200, '娱乐'),
    ];
    const r = detectAnomalies(txns, { referenceMonth: '2026-06' });
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0].severity).toBe('low');
    expect(r.anomalies[0].zScore).toBeNull();
  });

  it('低于 floor 的金额不视为异常', () => {
    const txns: Transaction[] = [];
    for (let i = 0; i < 10; i++) {
      txns.push(tx(`h${i}`, `2026-05-${String(i + 1).padStart(2, '0')}`, 30, '餐饮'));
    }
    txns.push(tx('small', '2026-06-01', 80, '餐饮')); // 低于 floor 100
    const r = detectAnomalies(txns, { referenceMonth: '2026-06' });
    expect(r.anomalies).toHaveLength(0);
  });

  it('历史数据不足 → 提示补数据，不报错', () => {
    const txns: Transaction[] = [tx('only', '2026-06-01', 9999, '餐饮')];
    const r = detectAnomalies(txns, { referenceMonth: '2026-06' });
    expect(r.anomalies).toHaveLength(0);
    expect(r.insights.join('')).toContain('历史数据');
  });

  it('参考月无支出 → 友好占位', () => {
    const txns: Transaction[] = [tx('old', '2026-05-01', 50, '餐饮')];
    const r = detectAnomalies(txns, { referenceMonth: '2026-06' });
    expect(r.evaluated).toBe(0);
    expect(r.insights.join('')).toContain('暂无支出');
  });

  it('formatAnomalyReport 输出中文清单', () => {
    const hist = [50, 45, 55, 40, 60, 48, 52, 47, 53, 49];
    const txns: Transaction[] = hist.map((amt, i) =>
      tx(`h${i}`, `2026-05-${String(i + 1).padStart(2, '0')}`, amt, '餐饮'),
    );
    txns.push(tx('spike', '2026-06-10', 200, '餐饮'));
    const out = formatAnomalyReport(detectAnomalies(txns, { referenceMonth: '2026-06' }));
    expect(out).toContain('异常消费检测');
    expect(out).toContain('餐饮');
  });
});
