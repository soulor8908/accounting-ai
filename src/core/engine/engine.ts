/**
 * 指令引擎：用户输入 → 解析 → 校验 → 执行 → 反馈
 * 职责边界（审计文档 P0）：只编排解析器与 Store，不直接维护业务状态
 * 支持：追问（金额/账户）、确认（模糊金额/大额/透支/超额）、撤销、查询
 */
import { type AmountMatch, extractAmount } from '../parser/amount';
import { formatDate } from '../parser/dateParser';
import { type Intent, parse } from '../parser/parser';
import { analyzeTrends, formatTrendReport } from '../analytics/trends';
import { addMonthsClamped } from '../finance/loan';
import { Store, ValidationError } from '../store/store';
import type { Account, AccountType, Transaction } from '../types';
import { round2 } from '../utils/money';

export type EngineStatus = 'ok' | 'error' | 'clarify' | 'confirm';

export interface EngineResult {
  status: EngineStatus;
  message: string;
  clarifyOptions?: string[];
}

const ASSET_TYPES: AccountType[] = ['wallet', 'alipay', 'cash', 'debit'];
/** 还款目标关键词（口语中常带前缀，如"还了信用卡"，用包含匹配） */
const REPAY_TARGET_WORDS = /信用卡|花呗|白条|房贷|车贷|贷款|欠款|借款/;

export function formatMoney(n: number): string {
  const fixed = round2(n).toFixed(2);
  const sign = fixed.startsWith('-') ? '-' : '';
  const [int, dec] = (sign ? fixed.slice(1) : fixed).split('.');
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

type Pending =
  | { kind: 'amount'; intent: Intent; clarifyUsed: boolean; allowEstimate: boolean }
  | { kind: 'account'; intent: Intent; clarifyUsed: boolean }
  | { kind: 'execute'; intent: Intent; clarifyUsed: boolean };

const CONFIRM_WORDS = /^(对|是的|是|嗯|好|好的|确认|可以|行)$/;
const CANCEL_WORDS = /^(取消|算了|不用了|否|不)$/;

export class Engine {
  private pending: Pending | null = null;

  constructor(
    private store: Store,
    private now: () => Date = () => new Date(),
  ) {}

  // ---------- 入口 ----------
  handle(text: string): EngineResult {
    const input = text.trim();
    if (!input) return { status: 'error', message: '没听清，请再说一次' };
    if (this.pending) return this.handlePending(input);
    const intent = parse(input, this.now());
    return this.execute(intent, { clarifyUsed: false, forceConfirm: false });
  }

  /** 确认待执行操作（大额/透支/超额）；对模糊金额待确认则按估算值入账 */
  confirmPending(): EngineResult {
    const p = this.pending;
    if (!p) return { status: 'error', message: '没有待确认的操作' };
    this.pending = null;
    if (p.kind === 'amount') {
      if (!p.allowEstimate) {
        return { status: 'error', message: '信息还不完整，请回复具体金额' };
      }
      return this.execute(p.intent, { clarifyUsed: p.clarifyUsed, forceConfirm: true });
    }
    if (p.kind === 'execute') {
      return this.execute(p.intent, { clarifyUsed: p.clarifyUsed, forceConfirm: true });
    }
    return { status: 'error', message: '信息还不完整，请按提示补充' };
  }

  /** 取消待执行操作 */
  cancelPending(): EngineResult {
    if (!this.pending) return { status: 'error', message: '没有待取消的操作' };
    this.pending = null;
    return { status: 'error', message: '已取消，未入账' };
  }

  // ---------- 待处理会话 ----------
  private handlePending(input: string): EngineResult {
    const p = this.pending!;
    if (CANCEL_WORDS.test(input)) return this.cancelPending();

    if (p.kind === 'execute') {
      if (CONFIRM_WORDS.test(input)) return this.confirmPending();
      return { status: 'confirm', message: '请回复"确认"入账，或"取消"放弃' };
    }

    if (p.kind === 'amount') {
      if (p.allowEstimate && CONFIRM_WORDS.test(input)) return this.confirmPending();
      const m = extractAmount(input);
      if (m) {
        this.pending = null;
        return this.execute(this.withAmount(p.intent, m.value), { clarifyUsed: true, forceConfirm: false });
      }
      return { status: 'clarify', message: '没听清金额，请回复具体数字（如 350）' };
    }

    // kind === 'account'
    const matches = this.store.resolveAccounts(input);
    if (matches.length === 0) {
      this.pending = null;
      return { status: 'error', message: `没找到账户「${input}」。${this.accountListHint()}` };
    }
    this.pending = null;
    return this.execute(this.withAccountHint(p.intent, matches[0].name), { clarifyUsed: true, forceConfirm: false });
  }

  private withAmount(intent: Intent, value: number): Intent {
    const amount: AmountMatch = { value, estimated: false, raw: String(value), index: 0, length: 0 };
    if (intent.kind === 'repayment' || intent.kind === 'recurring') return { ...intent, amount };
    if (intent.kind === 'expense' || intent.kind === 'income' || intent.kind === 'transfer' || intent.kind === 'installment') {
      return { ...intent, amount };
    }
    return intent;
  }

  private withAccountHint(intent: Intent, name: string): Intent {
    if ('accountHint' in intent) return { ...intent, accountHint: name };
    return intent;
  }

  // ---------- 执行 ----------
  private execute(intent: Intent, ctx: { clarifyUsed: boolean; forceConfirm: boolean }): EngineResult {
    switch (intent.kind) {
      case 'unknown':
        return {
          status: 'error',
          message: '没听懂。可以这样记账：「吃午饭25」「3k工资到账」「从招行卡转500到微信」「还了信用卡2000」，也可以问「微信还有多少余额」',
        };
      case 'undo':
        return this.executeUndo();
      case 'query_balance':
        return this.executeQueryBalance(intent.accountHint);
      case 'query_summary':
        return this.executeQuerySummary(intent.scope);
      case 'analyze_trend':
        return this.executeAnalyzeTrend();
      case 'expense':
      case 'income':
        return this.executeBasic(intent, ctx);
      case 'transfer':
        return this.executeTransfer(intent, ctx);
      case 'repayment':
        return this.executeRepayment(intent, ctx);
      case 'installment':
        return this.executeInstallment(intent, ctx);
      case 'recurring':
        return this.executeRecurring(intent, ctx);
    }
  }

  // ---------- 支出/收入 ----------
  private executeBasic(
    intent: Extract<Intent, { kind: 'expense' | 'income' }>,
    ctx: { clarifyUsed: boolean; forceConfirm: boolean },
  ): EngineResult {
    if (this.store.state.accounts.length === 0) {
      return { status: 'error', message: '还没有任何账户，请到「账户」标签页先创建一个账户（如微信零钱、储蓄卡）' };
    }
    const picked = this.pickAssetAccount(intent.accountHint, ctx.clarifyUsed, intent, 'first');
    if (picked.result) return picked.result;
    const account = picked.acc!;

    if (intent.amount.estimated && !ctx.forceConfirm) {
      this.pending = { kind: 'amount', intent, clarifyUsed: ctx.clarifyUsed, allowEstimate: true };
      return {
        status: 'confirm',
        message: `金额约为 ¥${formatMoney(intent.amount.value)}，请回复精确金额，或回复"对"按 ¥${formatMoney(intent.amount.value)} 入账`,
      };
    }

    return this.tryApply(intent, ctx, {
      type: intent.kind,
      amount: intent.amount.value,
      accountId: account.id,
      category: intent.category,
      subcategory: intent.subcategory,
      description: intent.description,
      date: intent.date,
      time: intent.time,
      estimated: intent.amount.estimated || undefined,
    }, (tx) => {
      const acc = this.store.getAccount(account.id)!;
      const verb = intent.kind === 'expense' ? '支出' : '收入';
      return `已记${verb} ¥${formatMoney(tx.amount)}（${tx.category}），「${acc.name}」余额 ¥${formatMoney(acc.balance)}`;
    });
  }

  // ---------- 转账 ----------
  private executeTransfer(
    intent: Extract<Intent, { kind: 'transfer' }>,
    ctx: { clarifyUsed: boolean; forceConfirm: boolean },
  ): EngineResult {
    const from = intent.fromHint ? this.store.resolveAccounts(intent.fromHint)[0] : this.firstAssetAccount();
    if (!from) {
      return { status: 'error', message: `没找到转出账户${intent.fromHint ? `「${intent.fromHint}」` : ''}。${this.accountListHint()}` };
    }
    const to = this.store.resolveAccounts(intent.toHint)[0];
    if (!to) {
      return { status: 'error', message: `没找到目标账户「${intent.toHint}」。${this.accountListHint()}` };
    }
    if (from.id === to.id) {
      return { status: 'error', message: '转出与目标账户相同，无需转账' };
    }
    return this.tryApply(intent, ctx, {
      type: 'transfer',
      amount: intent.amount.value,
      accountId: from.id,
      relatedAccountId: to.id,
      category: '转账',
      description: intent.description,
      date: intent.date,
      time: intent.time,
    }, (tx) => {
      const f = this.store.getAccount(from.id)!;
      const t = this.store.getAccount(to.id)!;
      return `已从「${f.name}」转出 ¥${formatMoney(tx.amount)} 到「${t.name}」；「${f.name}」余额 ¥${formatMoney(f.balance)}，「${t.name}」余额 ¥${formatMoney(t.balance)}`;
    });
  }

  // ---------- 还款 ----------
  private executeRepayment(
    intent: Extract<Intent, { kind: 'repayment' }>,
    ctx: { clarifyUsed: boolean; forceConfirm: boolean },
  ): EngineResult {
    if (!intent.amount) {
      this.pending = { kind: 'amount', intent, clarifyUsed: ctx.clarifyUsed, allowEstimate: false };
      return { status: 'clarify', message: `还了多少？请回复金额（如 2000）` };
    }
    const target = this.findDebtAccount(intent.targetHint);
    if (!target) {
      return { status: 'error', message: `没有找到对应的负债账户（${intent.targetHint ?? '欠款'}）。${this.accountListHint()}` };
    }
    // "还了信用卡2000"中的"信用卡"是还款目标，不是付款账户
    const hint = intent.accountHint && !REPAY_TARGET_WORDS.test(intent.accountHint) ? intent.accountHint : undefined;
    const picked = this.pickAssetAccount(hint, ctx.clarifyUsed, intent, 'richest');
    if (picked.result) return picked.result;
    const source = picked.acc!;

    return this.tryApply(intent, ctx, {
      type: 'repayment',
      amount: intent.amount.value,
      accountId: source.id,
      relatedAccountId: target.id,
      category: '还款',
      description: intent.description,
      date: intent.date,
      time: intent.time,
    }, (tx) => {
      const t = this.store.getAccount(target.id)!;
      const s = this.store.getAccount(source.id)!;
      return `已还「${t.name}」¥${formatMoney(tx.amount)}（从「${s.name}」扣款），「${t.name}」剩余负债 ¥${formatMoney(Math.max(0, t.balance))}`;
    });
  }

  // ---------- 分期 ----------
  private executeInstallment(
    intent: Extract<Intent, { kind: 'installment' }>,
    ctx: { clarifyUsed: boolean; forceConfirm: boolean },
  ): EngineResult {
    const account = this.resolveDebtAccountForPlan(intent.accountHint);
    if (!account) {
      return { status: 'error', message: `没有找到可分期的信用账户。${this.accountListHint()}` };
    }
    return this.tryApply(intent, ctx, {
      type: 'expense',
      amount: intent.amount.value,
      accountId: account.id,
      category: intent.category,
      subcategory: intent.subcategory,
      description: intent.description,
      date: intent.date,
      time: intent.time,
    }, (tx) => {
      const plan = this.store.createInstallmentPlan({
        name: intent.description || '分期消费',
        type: account.type === 'credit' ? 'credit_card' : 'bt',
        totalAmount: tx.amount,
        fee: 0,
        term: intent.term,
        accountId: account.id,
        firstDueDate: this.firstDueDate(account),
        parentTxId: tx.id,
        autoDeduct: false,
      });
      return `已创建分期计划「${plan.name}」：¥${formatMoney(plan.totalAmount)} 分 ${plan.term} 期，每期 ¥${formatMoney(plan.monthlyPayment)}，下期还款日 ${plan.nextDueDate}`;
    });
  }

  // ---------- 周期记账 ----------
  private executeRecurring(
    intent: Extract<Intent, { kind: 'recurring' }>,
    _ctx: { clarifyUsed: boolean; forceConfirm: boolean },
  ): EngineResult {
    if (!intent.amount) {
      this.pending = { kind: 'amount', intent, clarifyUsed: _ctx.clarifyUsed, allowEstimate: false };
      return { status: 'clarify', message: '每月多少钱？请回复金额' };
    }
    const hint = intent.accountHint && !REPAY_TARGET_WORDS.test(intent.accountHint) ? intent.accountHint : undefined;
    const picked = this.pickAssetAccount(hint, _ctx.clarifyUsed, intent, 'richest');
    if (picked.result) return picked.result;
    const account = picked.acc!;
    const related = intent.txKind === 'repayment' ? this.findDebtAccount(intent.targetHint) : undefined;

    const today = formatDate(this.now());
    const rule = this.store.addRecurringRule({
      name: intent.description || intent.category,
      type: intent.txKind,
      amount: intent.amount.value,
      accountId: account.id,
      category: intent.category,
      description: intent.description,
      dayOfMonth: intent.dayOfMonth,
      startDate: this.nextMonthlyDate(today, intent.dayOfMonth),
      relatedAccountId: related?.id,
      active: true,
    });
    return {
      status: 'ok',
      message: `已创建周期记账：每月 ${rule.dayOfMonth} 号「${rule.description}」¥${formatMoney(rule.amount)}（自 ${rule.startDate} 起自动入账）`,
    };
  }

  // ---------- 撤销 ----------
  private executeUndo(): EngineResult {
    const tx = this.store.undoLast();
    if (!tx) return { status: 'error', message: '没有可撤销的记录' };
    return { status: 'ok', message: `已撤销上一笔：${tx.date} ${tx.description || tx.category} ¥${formatMoney(tx.amount)}` };
  }

  // ---------- 查询 ----------
  private executeQueryBalance(hint?: string): EngineResult {
    if (hint) {
      const acc = this.store.resolveAccounts(hint)[0];
      if (!acc) return { status: 'error', message: `没找到账户「${hint}」。${this.accountListHint()}` };
      return { status: 'ok', message: `「${acc.name}」当前余额 ¥${formatMoney(acc.balance)}` };
    }
    const assets = this.store.state.accounts.filter((a) => ASSET_TYPES.includes(a.type));
    if (assets.length === 0) return { status: 'error', message: '还没有资产账户，请先创建' };
    const lines = assets.map((a) => `「${a.name}」¥${formatMoney(a.balance)}`);
    return { status: 'ok', message: `${lines.join('，')}；总资产 ¥${formatMoney(this.store.getTotalAssets())}` };
  }

  private executeAnalyzeTrend(): EngineResult {
    const report = analyzeTrends(this.store.state.transactions, { now: this.now() });
    return { status: 'ok', message: formatTrendReport(report) };
  }

  private executeQuerySummary(scope: 'today' | 'month'): EngineResult {
    const today = formatDate(this.now());
    if (scope === 'today') {
      const txs = this.store.state.transactions.filter((t) => t.date === today);
      const expense = round2(txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
      const income = round2(txs.filter((t) => t.type === 'income' || t.type === 'refund').reduce((s, t) => s + t.amount, 0));
      return { status: 'ok', message: `今天（${today}）支出 ¥${formatMoney(expense)}，收入 ¥${formatMoney(income)}，共 ${txs.length} 笔` };
    }
    const month = today.slice(0, 7);
    const s = this.store.getMonthlySummary(month);
    return { status: 'ok', message: `本月（${month}）支出 ¥${formatMoney(s.expense)}，收入 ¥${formatMoney(s.income)}，共 ${s.count} 笔` };
  }

  // ---------- 应用流水（统一确认流） ----------
  private tryApply(
    intent: Intent,
    ctx: { clarifyUsed: boolean; forceConfirm: boolean },
    input: Parameters<Store['applyTransaction']>[0],
    onOk: (tx: Transaction) => string,
  ): EngineResult {
    try {
      const { tx, warnings } = this.store.applyTransaction(input, { confirm: ctx.forceConfirm });
      let message = onOk(tx);
      if (warnings.length > 0) message += `；⚠️ ${warnings.join('；')}`;
      return { status: 'ok', message };
    } catch (e) {
      if (e instanceof ValidationError) {
        const confirmable = e.issues.some((i) => i.code === 'large_amount' || i.code === 'overdraft' || i.code === 'limit_exceeded');
        if (confirmable && !ctx.forceConfirm) {
          this.pending = { kind: 'execute', intent, clarifyUsed: ctx.clarifyUsed };
          const parts = e.issues.map((i) =>
            i.code === 'large_amount' ? `大额交易（¥${formatMoney(input.amount)}）` : i.message,
          );
          return { status: 'confirm', message: `${parts.join('；')}。确认入账吗？（回复"确认"或"取消"）` };
        }
        return { status: 'error', message: e.message };
      }
      throw e;
    }
  }

  // ---------- 账户解析 ----------
  private firstAssetAccount(): Account | undefined {
    return this.store.state.accounts.find((a) => ASSET_TYPES.includes(a.type));
  }

  /**
   * 选择资产账户：hint 优先；无 hint 时单账户默认、多账户先追问，
   * 已追问过则按 prefer 取默认（first=首个，richest=余额最高，避免透支）
   */
  private pickAssetAccount(
    hint: string | undefined,
    clarifyUsed: boolean,
    intent: Intent,
    prefer: 'first' | 'richest',
  ): { acc?: Account; result?: EngineResult } {
    if (hint) {
      const m = this.store.resolveAccounts(hint);
      if (m.length === 0) return { result: { status: 'error', message: `没找到账户「${hint}」。${this.accountListHint()}` } };
      return { acc: m[0] };
    }
    const assets = this.store.state.accounts.filter((a) => ASSET_TYPES.includes(a.type));
    if (assets.length === 0) {
      return { result: { status: 'error', message: '没有可用的资产账户（微信/储蓄卡/现金），请先创建' } };
    }
    if (assets.length === 1) return { acc: assets[0] };
    if (!clarifyUsed) {
      this.pending = { kind: 'account', intent, clarifyUsed: false };
      return {
        result: {
          status: 'clarify',
          message: '用哪个账户？',
          clarifyOptions: assets.map((a) => a.name),
        },
      };
    }
    const sorted = prefer === 'richest' ? [...assets].sort((a, b) => b.balance - a.balance) : assets;
    return { acc: sorted[0] };
  }

  /** 按还款目标关键词找负债账户 */
  private findDebtAccount(targetHint?: string): Account | undefined {
    const accounts = this.store.state.accounts;
    const byType = (types: AccountType[]) => accounts.filter((a) => types.includes(a.type));
    if (targetHint) {
      if (/信用卡/.test(targetHint)) {
        const m = this.store.resolveAccounts(targetHint).filter((a) => a.type === 'credit');
        return m[0] ?? byType(['credit'])[0];
      }
      if (/白条|花呗/.test(targetHint)) {
        const m = this.store.resolveAccounts(targetHint).filter((a) => a.type === 'installment');
        return m[0] ?? byType(['installment'])[0];
      }
      if (/房贷|车贷|贷款|借款|欠款/.test(targetHint)) {
        const m = this.store.resolveAccounts(targetHint).filter((a) => a.type === 'loan');
        return m[0] ?? byType(['loan'])[0];
      }
    }
    return byType(['credit', 'installment', 'loan'])[0];
  }

  /** 分期负债账户：hint 命中的信用/分期账户，否则第一个信用账户 */
  private resolveDebtAccountForPlan(hint?: string): Account | undefined {
    if (hint) {
      const m = this.store.resolveAccounts(hint).filter((a) => a.type === 'credit' || a.type === 'installment');
      if (m.length > 0) return m[0];
    }
    return this.store.state.accounts.find((a) => a.type === 'credit' || a.type === 'installment');
  }

  private accountListHint(): string {
    const names = this.store.state.accounts.map((a) => `「${a.name}」`).join('、');
    return names ? `现有账户：${names}` : '还没有任何账户，请先创建';
  }

  // ---------- 日期工具 ----------
  private mkDate(y: number, m: number, day: number): string {
    const lastDay = new Date(y, m, 0).getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
  }

  /** 信用卡取还款日（本月已过则取下月）；其他账户取一个月后 */
  private firstDueDate(account: Account): string {
    const today = formatDate(this.now());
    if (account.meta?.kind === 'credit') {
      const [y, m, d] = today.split('-').map(Number);
      const dueDay = account.meta.dueDay;
      const thisMonth = this.mkDate(y, m, dueDay);
      return dueDay >= d ? thisMonth : addMonthsClamped(thisMonth, 1);
    }
    return addMonthsClamped(today, 1);
  }

  /** 每月 day 号的下一个执行日（今天已过则下月） */
  private nextMonthlyDate(today: string, day: number): string {
    const [y, m, d] = today.split('-').map(Number);
    const thisMonth = this.mkDate(y, m, day);
    return day >= d ? thisMonth : addMonthsClamped(thisMonth, 1);
  }
}
