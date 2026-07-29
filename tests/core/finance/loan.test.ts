import { describe, expect, it } from 'vitest';
import {
  calcMonthlyPayment,
  generateLoanSchedule,
  calcTotalInterest,
} from '../../../src/core/finance/loan';

describe('calcMonthlyPayment - 等额本息', () => {
  it('12万 年息6% 12期 → 月供约10327.93', () => {
    const m = calcMonthlyPayment(120000, 0.06, 12, 'equal_interest');
    expect(m).toBeCloseTo(10327.93, 1);
  });

  it('100万 年息4.9% 360期 → 月供约5307.27', () => {
    const m = calcMonthlyPayment(1000000, 0.049, 360, 'equal_interest');
    expect(m).toBeCloseTo(5307.27, 0);
  });

  it('零利率 → 月供=本金/期数', () => {
    expect(calcMonthlyPayment(12000, 0, 12, 'equal_interest')).toBe(1000);
  });
});

describe('calcMonthlyPayment - 等额本金（返回首月月供）', () => {
  it('12万 年息6% 12期 → 首月10600', () => {
    expect(calcMonthlyPayment(120000, 0.06, 12, 'equal_principal')).toBe(10600);
  });
});

describe('calcMonthlyPayment - 先息后本', () => {
  it('12万 年息6% → 月供600', () => {
    expect(calcMonthlyPayment(120000, 0.06, 12, 'interest_only')).toBe(600);
  });
});

describe('generateLoanSchedule - 等额本金', () => {
  it('月供递减且本金固定', () => {
    const sch = generateLoanSchedule(120000, 0.06, 12, 'equal_principal', '2026-01-15');
    expect(sch).toHaveLength(12);
    expect(sch[0].payment).toBe(10600);
    expect(sch[0].principal).toBe(10000);
    expect(sch[0].interest).toBe(600);
    expect(sch[1].payment).toBe(10550);
    expect(sch[11].payment).toBe(10050);
    expect(sch[11].remaining).toBe(0);
  });

  it('还款日为每月15号', () => {
    const sch = generateLoanSchedule(120000, 0.06, 12, 'equal_principal', '2026-01-15');
    expect(sch[0].date).toBe('2026-02-15');
    expect(sch[11].date).toBe('2027-01-15');
  });
});

describe('generateLoanSchedule - 等额本息', () => {
  it('月供恒定，利息递减，本金递增', () => {
    const sch = generateLoanSchedule(120000, 0.06, 12, 'equal_interest', '2026-01-15');
    const payments = sch.map((s) => s.payment);
    expect(Math.max(...payments) - Math.min(...payments)).toBeLessThan(0.05);
    expect(sch[0].interest).toBe(600);
    expect(sch[0].principal).toBeCloseTo(9727.93, 1);
    expect(sch[11].remaining).toBe(0);
  });
});

describe('generateLoanSchedule - 先息后本', () => {
  it('每月还息，期末还本', () => {
    const sch = generateLoanSchedule(120000, 0.06, 12, 'interest_only', '2026-01-15');
    expect(sch[0].payment).toBe(600);
    expect(sch[11].payment).toBe(120600);
    expect(sch[11].principal).toBe(120000);
  });
});

describe('calcTotalInterest', () => {
  it('等额本金总利息 3900', () => {
    const sch = generateLoanSchedule(120000, 0.06, 12, 'equal_principal', '2026-01-15');
    expect(calcTotalInterest(sch)).toBeCloseTo(3900, 0);
  });

  it('先息后本总利息 7200', () => {
    const sch = generateLoanSchedule(120000, 0.06, 12, 'interest_only', '2026-01-15');
    expect(calcTotalInterest(sch)).toBe(7200);
  });
});

describe('跨月日期钳制', () => {
  it('1月31日放款 → 首期2月28日', () => {
    const sch = generateLoanSchedule(12000, 0, 3, 'equal_interest', '2026-01-31');
    expect(sch[0].date).toBe('2026-02-28');
    expect(sch[1].date).toBe('2026-03-31');
  });
});
