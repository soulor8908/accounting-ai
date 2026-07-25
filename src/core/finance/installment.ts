/** 分期计划计算与生命周期 */
import type { InstallmentPlan, InstallmentPlanType } from '../types';
import { createId } from '../utils/id';
import { round2 } from '../utils/money';
import { addMonthsClamped } from './loan';

/** 每期应还 = (本金 + 总手续费) / 期数，四舍五入到分 */
export function calcInstallmentMonthly(totalAmount: number, fee: number, term: number): number {
  if (term <= 0) return 0;
  return round2((totalAmount + fee) / term);
}

export interface BuildPlanInput {
  name: string;
  type: InstallmentPlanType;
  totalAmount: number;
  fee: number;
  term: number;
  accountId: string;
  firstDueDate: string;
  parentTxId?: string;
  autoDeduct: boolean;
}

export function buildInstallmentPlan(input: BuildPlanInput): InstallmentPlan {
  return {
    id: createId('inst'),
    name: input.name,
    type: input.type,
    totalAmount: round2(input.totalAmount),
    fee: round2(input.fee),
    term: input.term,
    paidTerms: 0,
    monthlyPayment: calcInstallmentMonthly(input.totalAmount, input.fee, input.term),
    nextDueDate: input.firstDueDate,
    accountId: input.accountId,
    parentTxId: input.parentTxId,
    status: 'active',
    autoDeduct: input.autoDeduct,
    createdAt: new Date().toISOString(),
  };
}

/** 还一期：paidTerms+1，下期还款日 +1 月，还完置 completed */
export function payInstallmentTerm(plan: InstallmentPlan): InstallmentPlan {
  if (plan.status !== 'active') {
    throw new Error(`分期计划 ${plan.name} 已${plan.status === 'completed' ? '结清' : '提前结清'}，无法重复还款`);
  }
  const paidTerms = plan.paidTerms + 1;
  const completed = paidTerms >= plan.term;
  return {
    ...plan,
    paidTerms,
    status: completed ? 'completed' : 'active',
    nextDueDate: completed ? plan.nextDueDate : addMonthsClamped(plan.nextDueDate, 1),
  };
}

/** 提前结清：返回应还的剩余总额（剩余期数 × 月供） */
export function prepayInstallment(plan: InstallmentPlan): { plan: InstallmentPlan; payoffAmount: number } {
  if (plan.status !== 'active') {
    throw new Error(`分期计划 ${plan.name} 无法提前结清`);
  }
  const remainingTerms = plan.term - plan.paidTerms;
  return {
    plan: { ...plan, paidTerms: plan.term, status: 'prepaid' },
    payoffAmount: round2(remainingTerms * plan.monthlyPayment),
  };
}
