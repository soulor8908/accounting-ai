import { describe, expect, it } from 'vitest';
import { Store } from '../../../src/core/store/store';
import { buildMonthlyReport, reportToCsv } from '../../../src/core/analytics/export';

function seed() {
  const store = new Store();
  store.addAccount({ name: '微信零钱', type: 'wallet', balance: 5000 });
  const acc = store.state.accounts[0];
  store.applyTransaction({ type: 'expense', amount: 1200, accountId: acc.id, category: '餐饮', description: '吃饭', date: '2026-07-03' });
  store.applyTransaction({ type: 'expense', amount: 300, accountId: acc.id, category: '餐饮', description: '咖啡', date: '2026-07-10' });
  store.applyTransaction({ type: 'expense', amount: 800, accountId: acc.id, category: '交通', description: '打车', date: '2026-07-15' });
  store.applyTransaction({ type: 'income', amount: 5000, accountId: acc.id, category: '工资', description: '工资', date: '2026-07-01' });
  return store;
}

describe('P2 报表导出', () => {
  it('buildMonthlyReport 聚合月度汇总与分类', () => {
    const store = seed();
    const r = buildMonthlyReport(store, '2026-07');
    expect(r.expense).toBe(2300);
    expect(r.income).toBe(5000);
    expect(r.count).toBe(4);
    const cate = r.rows.find((x) => x.category === '餐饮');
    expect(cate?.amount).toBe(1500);
    expect(cate?.count).toBe(2);
  });

  it('reportToCsv 含 BOM 与关键字段', () => {
    const store = seed();
    const csv = reportToCsv(buildMonthlyReport(store, '2026-07'));
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('2026-07');
    expect(csv).toContain('支出合计');
    expect(csv).toContain('2300.00');
  });

  it('CSV 对含逗号/引号的类别安全转义', () => {
    const store = seed();
    store.applyTransaction({
      type: 'expense',
      amount: 10,
      accountId: store.state.accounts[0].id,
      category: '买菜,"生鲜"',
      description: 'x',
      date: '2026-07-20',
    });
    const csv = reportToCsv(buildMonthlyReport(store, '2026-07'));
    expect(csv).toContain('"买菜,""生鲜"""');
  });
});
