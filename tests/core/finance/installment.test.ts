import { describe, expect, it } from 'vitest';
import {
  buildInstallmentPlan,
  calcInstallmentMonthly,
  payInstallmentTerm,
} from '../../../src/core/finance/installment';

describe('calcInstallmentMonthly', () => {
  it('9999 分12期 无手续费 → 833.25', () => {
    expect(calcInstallmentMonthly(9999, 0, 12)).toBe(833.25);
  });

  it('8000 + 手续费288 分12期 → 690.67', () => {
    expect(calcInstallmentMonthly(8000, 288, 12)).toBeCloseTo(690.67, 2);
  });

  it('1000 分3期 → 333.33', () => {
    expect(calcInstallmentMonthly(1000, 0, 3)).toBe(333.33);
  });
});

describe('buildInstallmentPlan', () => {
  it('构建信用卡分期计划', () => {
    const p = buildInstallmentPlan({
      name: 'iPhone 16 分期',
      type: 'credit_card',
      totalAmount: 9999,
      fee: 0,
      term: 12,
      accountId: 'cc_001',
      firstDueDate: '2026-08-05',
      autoDeduct: true,
    });
    expect(p.monthlyPayment).toBe(833.25);
    expect(p.paidTerms).toBe(0);
    expect(p.status).toBe('active');
    expect(p.nextDueDate).toBe('2026-08-05');
    expect(p.autoDeduct).toBe(true);
  });
});

describe('payInstallmentTerm', () => {
  it('还一期后 paidTerms+1，下期还款日+1月', () => {
    const p = buildInstallmentPlan({
      name: '白条分期',
      type: 'bt',
      totalAmount: 3000,
      fee: 0,
      term: 3,
      accountId: 'bt_001',
      firstDueDate: '2026-08-10',
      autoDeduct: false,
    });
    const r = payInstallmentTerm(p);
    expect(r.paidTerms).toBe(1);
    expect(r.nextDueDate).toBe('2026-09-10');
    expect(r.status).toBe('active');
  });

  it('还完最后一期 → completed', () => {
    let p = buildInstallmentPlan({
      name: '耳机分期',
      type: 'bt',
      totalAmount: 900,
      fee: 0,
      term: 3,
      accountId: 'bt_001',
      firstDueDate: '2026-08-10',
      autoDeduct: false,
    });
    p = payInstallmentTerm(p);
    p = payInstallmentTerm(p);
    p = payInstallmentTerm(p);
    expect(p.paidTerms).toBe(3);
    expect(p.status).toBe('completed');
  });

  it('已完成的计划再还款 → 抛错', () => {
    let p = buildInstallmentPlan({
      name: 'x',
      type: 'bt',
      totalAmount: 100,
      fee: 0,
      term: 1,
      accountId: 'bt_001',
      firstDueDate: '2026-08-10',
      autoDeduct: false,
    });
    p = payInstallmentTerm(p);
    expect(() => payInstallmentTerm(p)).toThrow();
  });
});
