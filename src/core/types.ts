/**
 * 数据模型 v2.0（基于产品审计文档附录A，并落地 P0/P1 改进建议）
 * - 账户模型拆分：信用卡/贷款/分期额度 使用扩展 meta
 * - 交易类型扩展：refund / adjustment
 * - 分期计划独立表，支持手续费、自动扣款标记、关联原始流水
 */

// ---------- 账户 ----------
export type AccountType =
  | 'wallet' // 微信零钱等电子钱包
  | 'alipay' // 支付宝余额
  | 'cash' // 现金
  | 'debit' // 储蓄卡
  | 'credit' // 信用卡
  | 'loan' // 贷款
  | 'installment'; // 白条/花呗等信用分期额度账户

export interface CreditCardMeta {
  kind: 'credit';
  limit: number; // 固定额度
  billDay: number; // 账单日（每月几号）
  dueDay: number; // 还款日（每月几号）
  dueNextMonth?: boolean; // 还款日在次月（账单日下个月的 dueDay）
  tempLimit?: number; // 临时额度
}

export type RepaymentMethod = 'equal_interest' | 'equal_principal' | 'interest_only';

export interface LoanMeta {
  kind: 'loan';
  principal: number; // 贷款本金
  annualRate: number; // 年利率，如 0.049
  termMonths: number; // 期数（月）
  startDate: string; // 放款日 YYYY-MM-DD
  repaymentMethod: RepaymentMethod;
  monthlyPayment: number; // 月供（等额本金为首月月供）
  autoDeduct: boolean; // 是否自动扣款
  deductAccountId?: string; // 关联扣款账户
  paidMonths: number; // 已还月数
  dueDay: number; // 每月还款日
  nextDueDate: string; // 下期还款日
}

export interface InstallmentAccountMeta {
  kind: 'installment';
  totalLimit: number; // 总额度（白条/花呗）
}

export type AccountMeta = CreditCardMeta | LoanMeta | InstallmentAccountMeta;

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /**
   * balance 语义约定：
   * - wallet/alipay/cash/debit: 当前余额（正数）
   * - credit: 已用额度（正数 = 欠款）
   * - loan: 剩余本金（正数 = 未还）
   * - installment: 已占用额度（正数 = 欠款）
   */
  balance: number;
  currency: string;
  createdAt: string;
  meta?: AccountMeta;
}

// ---------- 交易流水 ----------
export type TxType =
  | 'income' // 收入
  | 'expense' // 支出
  | 'transfer' // 转账（账户间）
  | 'repayment' // 还款（还信用卡/贷款/分期）
  | 'refund' // 退款（冲正）
  | 'adjustment'; // 调账

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
  type: TxType;
  amount: number; // 正数，方向由 type 决定
  accountId: string; // 主账户（支出/还款=出账方，收入/退款=入账方）
  category: string;
  subcategory?: string;
  description: string;
  tags: string[];
  relatedAccountId?: string; // 转账目标 / 还款目标（信用卡/贷款/分期账户）
  installmentPlanId?: string; // 关联分期计划
  estimated?: boolean; // 模糊金额（"三百多"），需用户确认
  createdAt: string;
}

// ---------- 分期计划（独立表） ----------
export type InstallmentPlanType = 'credit_card' | 'bt' | 'consumer';

export interface InstallmentPlan {
  id: string;
  name: string;
  type: InstallmentPlanType;
  totalAmount: number; // 分期本金
  fee: number; // 总手续费
  term: number; // 总期数
  paidTerms: number; // 已还期数
  monthlyPayment: number; // 每期应还（含手续费摊分）
  nextDueDate: string; // 下期还款日
  accountId: string; // 扣款/负债账户
  parentTxId?: string; // 关联原始消费流水
  status: 'active' | 'completed' | 'prepaid';
  autoDeduct: boolean; // 是否自动扣款
  createdAt: string;
}

// ---------- 周期性记账规则 ----------
export interface RecurringRule {
  id: string;
  name: string; // 如 "房贷月供"
  type: 'income' | 'expense' | 'repayment';
  amount: number;
  accountId: string; // 出账/入账账户
  category: string;
  description: string;
  dayOfMonth: number; // 每月几号执行
  startDate: string; // 首次执行日
  endDate?: string; // 截止日（贷款类可用）
  relatedAccountId?: string; // repayment 时的目标负债账户
  installmentPlanId?: string;
  lastGenerated?: string; // 上次生成日期 YYYY-MM-DD
  active: boolean;
}

// ---------- 应用状态 ----------
export interface AppState {
  accounts: Account[];
  transactions: Transaction[];
  installmentPlans: InstallmentPlan[];
  recurringRules: RecurringRule[];
  schemaVersion: number;
}

export const SCHEMA_VERSION = 1;

export function createEmptyState(): AppState {
  return {
    accounts: [],
    transactions: [],
    installmentPlans: [],
    recurringRules: [],
    schemaVersion: SCHEMA_VERSION,
  };
}

// ---------- 负债/提醒视图模型 ----------
export interface DueItem {
  kind: 'credit_bill' | 'credit_due' | 'loan' | 'installment';
  date: string; // 应还/账单日期
  label: string;
  amount: number;
  accountId: string;
  planId?: string;
  overdue: boolean;
}
