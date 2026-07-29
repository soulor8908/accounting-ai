import { describe, expect, it } from 'vitest';
import { parse } from '../../../src/core/parser/parser';

// 2026-07-24 周五 15:30
const NOW = new Date(2026, 6, 24, 15, 30);

describe('parse - 支出', () => {
  it('中午吃了碗面25 → 支出25 餐饮/午餐 今天', () => {
    const r = parse('中午吃了碗面25', NOW);
    expect(r.kind).toBe('expense');
    if (r.kind !== 'expense') return;
    expect(r.amount.value).toBe(25);
    expect(r.amount.estimated).toBe(false);
    expect(r.category).toBe('餐饮');
    expect(r.subcategory).toBe('午餐');
    expect(r.date).toBe('2026-07-24');
  });

  it('昨晚请同事吃饭花了三百多 → 支出300 估算 昨天', () => {
    const r = parse('昨晚请同事吃饭花了三百多', NOW);
    expect(r.kind).toBe('expense');
    if (r.kind !== 'expense') return;
    expect(r.amount.value).toBe(300);
    expect(r.amount.estimated).toBe(true);
    expect(r.date).toBe('2026-07-23');
    expect(r.category).toBe('餐饮');
  });

  it('7月15号打车三十五块五 → 支出35.5 指定日期', () => {
    const r = parse('7月15号打车三十五块五', NOW);
    expect(r.kind).toBe('expense');
    if (r.kind !== 'expense') return;
    expect(r.amount.value).toBe(35.5);
    expect(r.date).toBe('2026-07-15');
    expect(r.category).toBe('交通');
  });

  it('用微信买了件衣服两百 → 账户提示 微信', () => {
    const r = parse('用微信买了件衣服两百', NOW);
    expect(r.kind).toBe('expense');
    if (r.kind !== 'expense') return;
    expect(r.amount.value).toBe(200);
    expect(r.accountHint).toBe('微信');
  });
});

describe('parse - 收入', () => {
  it('3k工资到账 → 收入3000 工资', () => {
    const r = parse('3k工资到账', NOW);
    expect(r.kind).toBe('income');
    if (r.kind !== 'income') return;
    expect(r.amount.value).toBe(3000);
    expect(r.category).toBe('工资');
  });

  it('报销了八百到招行卡', () => {
    const r = parse('报销了八百到招行卡', NOW);
    expect(r.kind).toBe('income');
    if (r.kind !== 'income') return;
    expect(r.amount.value).toBe(800);
    expect(r.category).toBe('报销');
  });
});

describe('parse - 转账', () => {
  it('从招行卡转了两千五到微信', () => {
    const r = parse('从招行卡转了两千五到微信', NOW);
    expect(r.kind).toBe('transfer');
    if (r.kind !== 'transfer') return;
    expect(r.amount.value).toBe(2500);
    expect(r.fromHint).toBe('招行卡');
    expect(r.toHint).toBe('微信');
  });

  it('转了500到支付宝', () => {
    const r = parse('转了500到支付宝', NOW);
    expect(r.kind).toBe('transfer');
    if (r.kind !== 'transfer') return;
    expect(r.amount.value).toBe(500);
    expect(r.toHint).toBe('支付宝');
    expect(r.fromHint).toBeUndefined();
  });
});

describe('parse - 还款', () => {
  it('还了信用卡2000', () => {
    const r = parse('还了信用卡2000', NOW);
    expect(r.kind).toBe('repayment');
    if (r.kind !== 'repayment') return;
    expect(r.amount?.value).toBe(2000);
    expect(r.targetHint).toBe('信用卡');
  });

  it('还了信用卡一部分 → 金额为空，待追问', () => {
    const r = parse('还了信用卡一部分', NOW);
    expect(r.kind).toBe('repayment');
    if (r.kind !== 'repayment') return;
    expect(r.amount).toBeNull();
  });

  it('还了5000房贷', () => {
    const r = parse('还了5000房贷', NOW);
    expect(r.kind).toBe('repayment');
    if (r.kind !== 'repayment') return;
    expect(r.amount?.value).toBe(5000);
    expect(r.targetHint).toBe('房贷');
  });
});

describe('parse - 分期', () => {
  it('买了部手机8000，招行信用卡分12期', () => {
    const r = parse('买了部手机8000，招行信用卡分12期', NOW);
    expect(r.kind).toBe('installment');
    if (r.kind !== 'installment') return;
    expect(r.amount.value).toBe(8000);
    expect(r.term).toBe(12);
    expect(r.accountHint).toBe('招行信用卡');
  });

  it('白条分3期买了个耳机900', () => {
    const r = parse('白条分3期买了个耳机900', NOW);
    expect(r.kind).toBe('installment');
    if (r.kind !== 'installment') return;
    expect(r.term).toBe(3);
    expect(r.amount.value).toBe(900);
    expect(r.accountHint).toBe('白条');
  });
});

describe('parse - 周期性记账', () => {
  it('每月10号还房贷5000', () => {
    const r = parse('每月10号还房贷5000', NOW);
    expect(r.kind).toBe('recurring');
    if (r.kind !== 'recurring') return;
    expect(r.dayOfMonth).toBe(10);
    expect(r.txKind).toBe('repayment');
    expect(r.amount?.value).toBe(5000);
  });

  it('每月1号交房租3000', () => {
    const r = parse('每月1号交房租3000', NOW);
    expect(r.kind).toBe('recurring');
    if (r.kind !== 'recurring') return;
    expect(r.dayOfMonth).toBe(1);
    expect(r.txKind).toBe('expense');
    expect(r.category).toBe('住房');
  });
});

describe('parse - 查询', () => {
  it('微信还有多少余额 → 查余额', () => {
    const r = parse('微信还有多少余额', NOW);
    expect(r.kind).toBe('query_balance');
    if (r.kind !== 'query_balance') return;
    expect(r.accountHint).toBe('微信');
  });

  it('这个月花了多少 → 月度汇总', () => {
    const r = parse('这个月花了多少', NOW);
    expect(r.kind).toBe('query_summary');
    if (r.kind !== 'query_summary') return;
    expect(r.scope).toBe('month');
  });

  it('今天收入多少 → 今日汇总', () => {
    const r = parse('今天收入多少', NOW);
    expect(r.kind).toBe('query_summary');
    if (r.kind !== 'query_summary') return;
    expect(r.scope).toBe('today');
  });
});

describe('parse - 撤销', () => {
  it.each(['撤销上一笔', '取消刚才那笔', '撤回'])('%s → undo', (input) => {
    expect(parse(input, NOW).kind).toBe('undo');
  });
});

describe('parse - 无法识别', () => {
  it('你好 → unknown', () => {
    expect(parse('你好', NOW).kind).toBe('unknown');
  });
});
