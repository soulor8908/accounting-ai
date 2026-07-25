/**
 * 状态仓库：账户/流水/分期/周期规则的唯一权威数据源
 * 架构原则（审计文档 P0）：AI 只生成指令，状态由本模块维护并持久化
 */
import {
  type Account,
  type AccountMeta,
  type AccountType,
  type AppState,
  createEmptyState,
  type CreditCardMeta,
  type DueItem,
  type InstallmentPlan,
  type LoanMeta,
  type RecurringRule,
  SCHEMA_VERSION,
  type Transaction,
  type TxType,
} from '../types';
import { createId } from '../utils/id';
import { addMoney, round2, subMoney } from '../utils/money';
import { addMonthsClamped } from '../finance/loan';
import { buildInstallmentPlan, type BuildPlanInput, payInstallmentTerm } from '../finance/installment';

// ---------- 错误 ----------
export type IssueCode =
  | 'account_not_found'
  | 'invalid_amount'
  | 'invalid_operation'
  | 'overdraft'
  | 'limit_exceeded'
  | 'large_amount'
  | 'duplicate_name'
  | 'has_transactions'
  | 'plan_not_found';

export interface ValidationIssue {
  code: IssueCode;
  message: string;
}

export class ValidationError extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(issues.map((i) => i.message).join('；'));
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

// ---------- 存储适配 ----------
export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageAdapter {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

class LocalStorageAdapter implements StorageAdapter {
  getItem(key: string): string | null {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  setItem(key: string, value: string): void {
    globalThis.localStorage?.setItem(key, value);
  }
  removeItem(key: string): void {
    globalThis.localStorage?.removeItem(key);
  }
}

const STORAGE_KEY = 'accounting-ai:state:v1';
export const LARGE_AMOUNT_THRESHOLD = 50000;

const ASSET_TYPES: AccountType[] = ['wallet', 'alipay', 'cash', 'debit'];

/** 校验持久化/导入数据的最小形状，防止损坏数据污染状态 */
export function isValidStateShape(state: unknown): state is AppState {
  if (!state || typeof state !== 'object') return false;
  const s = state as Partial<AppState>;
  return (
    s.schemaVersion === SCHEMA_VERSION &&
    Array.isArray(s.accounts) &&
    Array.isArray(s.transactions) &&
    Array.isArray(s.installmentPlans) &&
    Array.isArray(s.recurringRules)
  );
}

// ---------- 撤销 ----------
interface AccountDelta {
  accountId: string;
  before: number;
  metaBefore?: AccountMeta;
}

interface UndoEntry {
  tx: Transaction;
  deltas: AccountDelta[];
  planBefore?: InstallmentPlan;
  createdPlanId?: string;
  createdTxIds: string[]; // 本操作产生的全部流水（含关联交易）
}

// ---------- 输入 ----------
export interface NewAccountInput {
  name: string;
  type: AccountType;
  balance?: number;
  currency?: string;
  meta?: AccountMeta;
}

export interface TxInput {
  type: TxType;
  amount: number;
  accountId: string;
  category?: string;
  subcategory?: string;
  description?: string;
  date: string;
  time?: string;
  relatedAccountId?: string;
  installmentPlanId?: string;
  tags?: string[];
  estimated?: boolean;
}

interface PersistedShape {
  state: AppState;
  undoStack: UndoEntry[];
}

export class Store {
  state: AppState;
  private undoStack: UndoEntry[] = [];
  private storage: StorageAdapter;

  constructor(storage?: StorageAdapter) {
    this.storage = storage ?? (typeof globalThis.localStorage !== 'undefined' ? new LocalStorageAdapter() : new MemoryStorage());
    this.state = createEmptyState();
  }

  // ---------- 账户 ----------
  addAccount(input: NewAccountInput): Account {
    const name = input.name.trim();
    if (!name) {
      throw new ValidationError([{ code: 'invalid_operation', message: '账户名不能为空' }]);
    }
    if (this.state.accounts.some((a) => a.name === name)) {
      throw new ValidationError([{ code: 'duplicate_name', message: `账户「${name}」已存在` }]);
    }
    const account: Account = {
      id: createId(this.idPrefixFor(input.type)),
      name,
      type: input.type,
      balance: round2(input.balance ?? 0),
      currency: input.currency ?? 'CNY',
      createdAt: new Date().toISOString(),
    };
    if (input.meta) account.meta = input.meta;
    this.state.accounts.push(account);
    this.save();
    return account;
  }

  private idPrefixFor(type: AccountType): string {
    const map: Record<AccountType, string> = {
      wallet: 'wal', alipay: 'ali', cash: 'cash', debit: 'db', credit: 'cc', loan: 'loan', installment: 'inst',
    };
    return map[type];
  }

  getAccount(id: string): Account | undefined {
    return this.state.accounts.find((a) => a.id === id);
  }

  updateAccount(id: string, patch: Partial<Omit<Account, 'id'>>): Account {
    const acc = this.getAccount(id);
    if (!acc) throw new ValidationError([{ code: 'account_not_found', message: '账户不存在' }]);
    Object.assign(acc, patch, { id: acc.id });
    if (patch.balance !== undefined) acc.balance = round2(patch.balance);
    this.save();
    return acc;
  }

  removeAccount(id: string): void {
    if (this.state.transactions.some((t) => t.accountId === id || t.relatedAccountId === id)) {
      throw new ValidationError([{ code: 'has_transactions', message: '该账户已有流水，不可删除' }]);
    }
    this.state.accounts = this.state.accounts.filter((a) => a.id !== id);
    this.save();
  }

  /** 模糊匹配账户名：hint 与 name 互相包含（剥离常见后缀） */
  resolveAccounts(hint: string): Account[] {
    const norm = (s: string) => s.toLowerCase().replace(/[卡账户的零钱余额\s]/g, '');
    const h = norm(hint);
    if (!h) return [];
    const scored: Array<{ acc: Account; score: number }> = [];
    for (const acc of this.state.accounts) {
      const n = norm(acc.name);
      if (n === h) scored.push({ acc, score: 100 });
      else if (n.includes(h)) scored.push({ acc, score: 80 + h.length });
      else if (h.includes(n)) scored.push({ acc, score: 60 + n.length });
    }
    return scored.sort((a, b) => b.score - a.score).map((s) => s.acc);
  }

  // ---------- 流水 ----------
  applyTransaction(input: TxInput, opts?: { confirm?: boolean; skipDuplicateCheck?: boolean }): { tx: Transaction; warnings: string[] } {
    const issues: ValidationIssue[] = [];
    const account = this.getAccount(input.accountId);
    if (!account) {
      throw new ValidationError([{ code: 'account_not_found', message: '账户不存在' }]);
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new ValidationError([{ code: 'invalid_amount', message: '金额必须为正数' }]);
    }
    const amount = round2(input.amount);

    // 大额确认（AC-08）
    if (amount >= LARGE_AMOUNT_THRESHOLD && !opts?.confirm) {
      issues.push({ code: 'large_amount', message: `单笔金额 ¥${amount} 较大，请确认` });
    }

    const related = input.relatedAccountId ? this.getAccount(input.relatedAccountId) : undefined;
    if (input.relatedAccountId && !related) {
      throw new ValidationError([{ code: 'account_not_found', message: '目标账户不存在' }]);
    }

    // 方向校验与余额预检
    switch (input.type) {
      case 'expense':
        if (account.type === 'loan') {
          throw new ValidationError([{ code: 'invalid_operation', message: '贷款账户不能直接消费' }]);
        }
        if (ASSET_TYPES.includes(account.type) && account.balance - amount < 0 && !opts?.confirm) {
          issues.push({ code: 'overdraft', message: `「${account.name}」余额不足（当前 ¥${account.balance}）` });
        }
        if ((account.type === 'credit' || account.type === 'installment')) {
          const limit = this.accountLimit(account);
          if (limit !== null && account.balance + amount > limit && !opts?.confirm) {
            issues.push({ code: 'limit_exceeded', message: `「${account.name}」额度不足（剩余 ¥${round2(limit - account.balance)}）` });
          }
        }
        break;
      case 'transfer':
        if (!related) {
          throw new ValidationError([{ code: 'invalid_operation', message: '转账需要目标账户' }]);
        }
        if (ASSET_TYPES.includes(account.type) && account.balance - amount < 0 && !opts?.confirm) {
          issues.push({ code: 'overdraft', message: `「${account.name}」余额不足（当前 ¥${account.balance}）` });
        }
        break;
      case 'repayment':
        if (!related) {
          throw new ValidationError([{ code: 'invalid_operation', message: '还款需要目标负债账户' }]);
        }
        if (ASSET_TYPES.includes(account.type) && account.balance - amount < 0 && !opts?.confirm) {
          issues.push({ code: 'overdraft', message: `「${account.name}」余额不足（当前 ¥${account.balance}）` });
        }
        break;
      case 'income':
      case 'refund':
      case 'adjustment':
        break;
    }

    if (issues.length > 0) throw new ValidationError(issues);

    // 执行
    const deltas: AccountDelta[] = [];
    const pushDelta = (acc: Account) => {
      if (!deltas.some((d) => d.accountId === acc.id)) {
        deltas.push({ accountId: acc.id, before: acc.balance, metaBefore: acc.meta ? structuredClone(acc.meta) : undefined });
      }
    };

    let planBefore: InstallmentPlan | undefined;

    switch (input.type) {
      case 'expense': {
        pushDelta(account);
        if (account.type === 'credit' || account.type === 'installment') {
          account.balance = addMoney(account.balance, amount); // 已用额度+
        } else {
          account.balance = subMoney(account.balance, amount);
        }
        break;
      }
      case 'income':
      case 'refund': {
        pushDelta(account);
        if (account.type === 'credit' || account.type === 'installment' || account.type === 'loan') {
          account.balance = subMoney(account.balance, amount); // 负债减少
        } else {
          account.balance = addMoney(account.balance, amount);
        }
        break;
      }
      case 'adjustment': {
        pushDelta(account);
        account.balance = addMoney(account.balance, amount); // 正数调增，负数由上层传 amount 符号——但金额必须为正，调减用 expense
        break;
      }
      case 'transfer': {
        pushDelta(account);
        pushDelta(related!);
        account.balance = subMoney(account.balance, amount);
        related!.balance = this.applyInbound(related!, amount);
        break;
      }
      case 'repayment': {
        pushDelta(account);
        pushDelta(related!);
        account.balance = subMoney(account.balance, amount);
        if (related!.type === 'loan' && related!.meta?.kind === 'loan') {
          this.applyLoanRepayment(related!, amount);
        } else {
          related!.balance = subMoney(related!.balance, amount);
        }
        // 分期计划联动
        if (input.installmentPlanId) {
          const plan = this.getPlan(input.installmentPlanId);
          if (plan) {
            planBefore = structuredClone(plan);
            const idx = this.state.installmentPlans.findIndex((p) => p.id === plan.id);
            this.state.installmentPlans[idx] = payInstallmentTerm(plan);
          }
        }
        break;
      }
    }

    const tx: Transaction = {
      id: createId('tx'),
      date: input.date,
      time: input.time,
      type: input.type,
      amount,
      accountId: input.accountId,
      category: input.category ?? (input.type === 'income' ? '其他收入' : input.type === 'repayment' ? '还款' : input.type === 'transfer' ? '转账' : '日常'),
      subcategory: input.subcategory,
      description: input.description ?? '',
      tags: input.tags ?? [],
      relatedAccountId: input.relatedAccountId,
      installmentPlanId: input.installmentPlanId,
      estimated: input.estimated,
      createdAt: new Date().toISOString(),
    };
    this.state.transactions.push(tx);

    // 非阻塞警告
    const warnings: string[] = [];
    if (!opts?.skipDuplicateCheck) {
      const dup = this.state.transactions.find(
        (t) =>
          t.id !== tx.id &&
          t.accountId === tx.accountId &&
          t.type === tx.type &&
          t.amount === tx.amount &&
          t.date === tx.date,
      );
      if (dup) {
        warnings.push(`检测到疑似重复交易（与 ${dup.date} 「${dup.description || dup.category}」金额相同）`);
      }
    }

    this.undoStack.push({ tx, deltas, planBefore, createdTxIds: [tx.id] });
    this.save();
    return { tx, warnings };
  }

  /** 资金流入目标账户（转账/还款目标） */
  private applyInbound(acc: Account, amount: number): number {
    if (acc.type === 'credit' || acc.type === 'installment' || acc.type === 'loan') {
      return subMoney(acc.balance, amount); // 负债减少
    }
    return addMoney(acc.balance, amount);
  }

  private applyLoanRepayment(loan: Account, amount: number): void {
    const meta = loan.meta as LoanMeta;
    const r = meta.annualRate / 12;
    // 先扣除当期利息，剩余部分冲减本金（先息后本/等额方式一致处理）
    const interest = round2(loan.balance * r);
    const principalPart = Math.max(0, round2(amount - interest));
    loan.balance = Math.max(0, subMoney(loan.balance, principalPart));
    meta.paidMonths += 1;
    if (loan.balance > 0) {
      meta.nextDueDate = addMonthsClamped(meta.nextDueDate, 1);
    }
    // 等额本金：下期月供重算
    if (meta.repaymentMethod === 'equal_principal' && loan.balance > 0) {
      const remainingMonths = meta.termMonths - meta.paidMonths;
      if (remainingMonths > 0) {
        meta.monthlyPayment = round2(meta.principal / meta.termMonths + loan.balance * r);
      }
    }
    loan.meta = meta;
  }

  private accountLimit(acc: Account): number | null {
    if (acc.meta?.kind === 'credit') return acc.meta.limit + (acc.meta.tempLimit ?? 0);
    if (acc.meta?.kind === 'installment') return acc.meta.totalLimit;
    return null;
  }

  // ---------- 撤销 ----------
  undoLast(): Transaction | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    // 恢复账户余额与元数据
    for (const d of entry.deltas) {
      const acc = this.getAccount(d.accountId);
      if (acc) {
        acc.balance = d.before;
        if (d.metaBefore !== undefined) acc.meta = d.metaBefore;
      }
    }
    // 恢复分期计划快照
    if (entry.planBefore) {
      const idx = this.state.installmentPlans.findIndex((p) => p.id === entry.planBefore!.id);
      if (idx >= 0) this.state.installmentPlans[idx] = entry.planBefore;
    }
    // 移除随之创建的计划
    if (entry.createdPlanId) {
      this.state.installmentPlans = this.state.installmentPlans.filter((p) => p.id !== entry.createdPlanId);
    }
    // 移除流水
    const ids = new Set(entry.createdTxIds);
    this.state.transactions = this.state.transactions.filter((t) => !ids.has(t.id));
    this.save();
    return entry.tx;
  }

  /** 供引擎使用：把"创建分期计划"挂到最近一次撤销记录上 */
  attachCreatedPlanToLastUndo(planId: string): void {
    const last = this.undoStack[this.undoStack.length - 1];
    if (last) last.createdPlanId = planId;
  }

  // ---------- 分期计划 ----------
  createInstallmentPlan(input: BuildPlanInput): InstallmentPlan {
    const plan = buildInstallmentPlan(input);
    this.state.installmentPlans.push(plan);
    this.attachCreatedPlanToLastUndo(plan.id);
    this.save();
    return plan;
  }

  getPlan(id: string): InstallmentPlan | undefined {
    return this.state.installmentPlans.find((p) => p.id === id);
  }

  /** 还一期分期：从 fromAccountId 扣款，目标为计划关联账户 */
  payInstallment(planId: string, fromAccountId: string, date: string): { tx: Transaction; plan: InstallmentPlan } {
    const plan = this.getPlan(planId);
    if (!plan) throw new ValidationError([{ code: 'plan_not_found', message: '分期计划不存在' }]);
    if (plan.status !== 'active') {
      throw new ValidationError([{ code: 'invalid_operation', message: `分期「${plan.name}」已结清` }]);
    }
    const { tx } = this.applyTransaction({
      type: 'repayment',
      amount: plan.monthlyPayment,
      accountId: fromAccountId,
      relatedAccountId: plan.accountId,
      installmentPlanId: plan.id,
      category: '分期还款',
      description: `${plan.name} 第${plan.paidTerms + 1}期`,
      date,
    });
    return { tx, plan: this.getPlan(planId)! };
  }

  // ---------- 周期规则 ----------
  addRecurringRule(input: Omit<RecurringRule, 'id'>): RecurringRule {
    const rule: RecurringRule = { ...input, id: createId('rule') };
    this.state.recurringRules.push(rule);
    this.save();
    return rule;
  }

  /** 生成所有到期未生成的周期流水（每条规则最多向前补 36 期） */
  generateDueRecurring(upToDate: string): Transaction[] {
    const generated: Transaction[] = [];
    for (const rule of this.state.recurringRules) {
      if (!rule.active) continue;
      const dueDates = this.computeDueDates(rule, upToDate);
      for (const date of dueDates) {
        try {
          const { tx } = this.applyTransaction(
            {
              type: rule.type,
              amount: rule.amount,
              accountId: rule.accountId,
              relatedAccountId: rule.relatedAccountId,
              installmentPlanId: rule.installmentPlanId,
              category: rule.category,
              description: rule.description,
              date,
              tags: ['周期自动记账'],
            },
            { confirm: true, skipDuplicateCheck: true },
          );
          generated.push(tx);
          rule.lastGenerated = date;
        } catch {
          // 账户被删等情况：跳过该规则本期，不阻断其他规则
          rule.lastGenerated = date;
        }
      }
    }
    if (generated.length > 0) this.save();
    return generated;
  }

  private computeDueDates(rule: RecurringRule, upToDate: string): string[] {
    const dates: string[] = [];
    const [sy, sm] = rule.startDate.split('-').map(Number);
    const [uy, um] = upToDate.split('-').map(Number);
    let y = sy;
    let m = sm;
    let guard = 0;
    while ((y < uy || (y === uy && m <= um)) && guard < 36) {
      guard++;
      const lastDay = new Date(y, m, 0).getDate();
      const day = Math.min(rule.dayOfMonth, lastDay);
      const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (date >= rule.startDate && date <= upToDate) {
        if (!rule.lastGenerated || date > rule.lastGenerated) {
          if (!rule.endDate || date <= rule.endDate) dates.push(date);
        }
      }
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return dates;
  }

  // ---------- 查询 ----------
  getMonthlySummary(month: string): { income: number; expense: number; count: number } {
    let income = 0;
    let expense = 0;
    let count = 0;
    for (const t of this.state.transactions) {
      if (!t.date.startsWith(month)) continue;
      if (t.type === 'income' || t.type === 'refund') income = addMoney(income, t.amount);
      else if (t.type === 'expense') expense = addMoney(expense, t.amount);
      count++;
    }
    return { income, expense, count };
  }

  getCategoryStats(month: string): Array<{ category: string; amount: number }> {
    const map = new Map<string, number>();
    for (const t of this.state.transactions) {
      if (!t.date.startsWith(month) || t.type !== 'expense') continue;
      map.set(t.category, addMoney(map.get(t.category) ?? 0, t.amount));
    }
    return [...map.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  getDailyFlows(month: string): Map<string, { income: number; expense: number; txs: Transaction[] }> {
    const map = new Map<string, { income: number; expense: number; txs: Transaction[] }>();
    for (const t of this.state.transactions) {
      if (!t.date.startsWith(month)) continue;
      const day = t.date;
      if (!map.has(day)) map.set(day, { income: 0, expense: 0, txs: [] });
      const e = map.get(day)!;
      if (t.type === 'income' || t.type === 'refund') e.income = addMoney(e.income, t.amount);
      else if (t.type === 'expense') e.expense = addMoney(e.expense, t.amount);
      e.txs.push(t);
    }
    return map;
  }

  getTotalAssets(): number {
    return round2(
      this.state.accounts
        .filter((a) => ASSET_TYPES.includes(a.type))
        .reduce((s, a) => s + a.balance, 0),
    );
  }

  getTotalLiabilities(): number {
    return round2(
      this.state.accounts
        .filter((a) => a.type === 'credit' || a.type === 'installment' || a.type === 'loan')
        .reduce((s, a) => s + Math.max(0, a.balance), 0),
    );
  }

  /** 聚合某月待还提醒：信用卡账单/还款日、贷款月供、分期计划 */
  getDueItems(month: string, today: string): DueItem[] {
    const items: DueItem[] = [];
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const mk = (day: number) => `${month}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;

    for (const acc of this.state.accounts) {
      if (acc.meta?.kind === 'credit') {
        const meta: CreditCardMeta = acc.meta;
        items.push({
          kind: 'credit_bill', date: mk(meta.billDay), label: `${acc.name} 账单日`,
          amount: acc.balance, accountId: acc.id, overdue: false,
        });
        if (acc.balance > 0) {
          const dueDate = mk(meta.dueDay);
          items.push({
            kind: 'credit_due', date: dueDate, label: `${acc.name} 还款日`,
            amount: acc.balance, accountId: acc.id, overdue: dueDate < today,
          });
        }
      }
      if (acc.meta?.kind === 'loan' && acc.balance > 0) {
        const meta: LoanMeta = acc.meta;
        if (meta.nextDueDate.startsWith(month)) {
          items.push({
            kind: 'loan', date: meta.nextDueDate, label: `${acc.name} 月供`,
            amount: meta.monthlyPayment, accountId: acc.id,
            overdue: meta.nextDueDate < today && meta.paidMonths < meta.termMonths,
          });
        }
      }
    }
    for (const plan of this.state.installmentPlans) {
      if (plan.status !== 'active' || !plan.nextDueDate.startsWith(month)) continue;
      items.push({
        kind: 'installment', date: plan.nextDueDate,
        label: `${plan.name} 第${plan.paidTerms + 1}期`,
        amount: plan.monthlyPayment, accountId: plan.accountId, planId: plan.id,
        overdue: plan.nextDueDate < today,
      });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---------- 持久化 ----------
  save(): void {
    const payload: PersistedShape = { state: this.state, undoStack: this.undoStack.slice(-50) };
    this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  load(): boolean {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
      const payload = JSON.parse(raw) as PersistedShape;
      if (!isValidStateShape(payload.state)) return false;
      this.state = payload.state;
      this.undoStack = Array.isArray(payload.undoStack) ? payload.undoStack : [];
      return true;
    } catch {
      return false;
    }
  }

  clearAll(): void {
    this.state = createEmptyState();
    this.undoStack = [];
    this.storage.removeItem(STORAGE_KEY);
  }
}
