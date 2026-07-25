/** 贷款计算引擎：等额本息 / 等额本金 / 先息后本 */
import type { RepaymentMethod } from '../types';
import { round2 } from '../utils/money';

export interface ScheduleItem {
  month: number; // 第几期（1 起）
  date: string; // 还款日
  payment: number; // 当期应还总额
  principal: number; // 当期本金
  interest: number; // 当期利息
  remaining: number; // 期末剩余本金
}

/** 计算月供（等额本金返回首月月供） */
export function calcMonthlyPayment(
  principal: number,
  annualRate: number,
  termMonths: number,
  method: RepaymentMethod,
): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  const r = annualRate / 12;
  if (method === 'equal_principal') {
    return round2(principal / termMonths + principal * r);
  }
  if (method === 'interest_only') {
    return round2(principal * r);
  }
  // equal_interest
  if (r === 0) return round2(principal / termMonths);
  const factor = Math.pow(1 + r, termMonths);
  return round2((principal * r * factor) / (factor - 1));
}

/** 日期加 n 个月，日数钳制到当月最后一天 */
export function addMonthsClamped(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(ny, nm, 0).getDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** 生成完整还款计划。startDate 为放款日，首期还款日为次月同日（钳制） */
export function generateLoanSchedule(
  principal: number,
  annualRate: number,
  termMonths: number,
  method: RepaymentMethod,
  startDate: string,
): ScheduleItem[] {
  const r = annualRate / 12;
  const items: ScheduleItem[] = [];
  let remaining = principal;

  if (method === 'equal_interest') {
    const m = calcMonthlyPayment(principal, annualRate, termMonths, method);
    for (let k = 1; k <= termMonths; k++) {
      const interest = round2(remaining * r);
      let princ = round2(m - interest);
      let payment = m;
      if (k === termMonths) {
        // 末期结清，吸收累计舍入误差
        princ = remaining;
        payment = round2(princ + interest);
      }
      remaining = round2(remaining - princ);
      items.push({
        month: k,
        date: addMonthsClamped(startDate, k),
        payment,
        principal: princ,
        interest,
        remaining: Math.max(0, remaining),
      });
    }
    return items;
  }

  if (method === 'equal_principal') {
    const princPerMonth = round2(principal / termMonths);
    for (let k = 1; k <= termMonths; k++) {
      const princ = k === termMonths ? remaining : princPerMonth;
      const interest = round2(remaining * r);
      remaining = round2(remaining - princ);
      items.push({
        month: k,
        date: addMonthsClamped(startDate, k),
        payment: round2(princ + interest),
        principal: princ,
        interest,
        remaining: Math.max(0, remaining),
      });
    }
    return items;
  }

  // interest_only
  for (let k = 1; k <= termMonths; k++) {
    const interest = round2(principal * r);
    const isLast = k === termMonths;
    const princ = isLast ? principal : 0;
    remaining = isLast ? 0 : principal;
    items.push({
      month: k,
      date: addMonthsClamped(startDate, k),
      payment: round2(interest + princ),
      principal: princ,
      interest,
      remaining,
    });
  }
  return items;
}

export function calcTotalInterest(schedule: ScheduleItem[]): number {
  return round2(schedule.reduce((s, it) => s + it.interest, 0));
}
