import { beforeEach, describe, expect, it } from 'vitest';
import { Store, ValidationError, MemoryStorage, isValidStateShape } from '../../../src/core/store/store';
import type { Account } from '../../../src/core/types';

const TODAY = '2026-07-24';

function makeStore(): Store {
  return new Store(new MemoryStorage());
}

function seedAccounts(store: Store): Record<string, Account> {
  const wechat = store.addAccount({ name: '微信零钱', type: 'wallet', balance: 1000 });
  const cmb = store.addAccount({ name: '招行储蓄卡', type: 'debit', balance: 20000 });
  const cc = store.addAccount({
    name: '招行信用卡',
    type: 'credit',
    balance: 0,
    meta: { kind: 'credit', limit: 30000, billDay: 5, dueDay: 23 },
  });
  return { wechat, cmb, cc };
}

describe('账户管理', () => {
  let store: Store;
  beforeEach(() => { store = makeStore(); });

  it('添加账户并持久化余额', () => {
    const a = store.addAccount({ name: '现金', type: 'cash', balance: 500 });
    expect(a.id).toBeTruthy();
    expect(store.getAccount(a.id)?.balance).toBe(500);
  });

  it('重名账户报错', () => {
    store.addAccount({ name: '现金', type: 'cash', balance: 0 });
    expect(() => store.addAccount({ name: '现金', type: 'cash', balance: 0 })).toThrow(ValidationError);
  });

  it('模糊匹配账户：招行卡 → 招行储蓄卡', () => {
    seedAccounts(store);
    const matches = store.resolveAccounts('招行卡');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].name).toContain('招行');
  });

  it('模糊匹配账户：微信 → 微信零钱', () => {
    seedAccounts(store);
    expect(store.resolveAccounts('微信')[0].name).toBe('微信零钱');
  });

  it('有流水的账户不可删除', () => {
    const { wechat } = seedAccounts(store);
    store.applyTransaction({ type: 'expense', amount: 10, accountId: wechat.id, date: TODAY });
    expect(() => store.removeAccount(wechat.id)).toThrow(ValidationError);
  });

  it('注销账户：余额归零、archived 标记、历史流水保留', () => {
    const wallet = store.addAccount({ name: '微信零钱', type: 'wallet', balance: 1000 });
    store.applyTransaction({ type: 'expense', amount: 100, accountId: wallet.id, date: TODAY });
    expect(store.getAccount(wallet.id)!.balance).toBe(900);
    store.archiveAccount(wallet.id);
    const acc = store.getAccount(wallet.id)!;
    expect(acc.archived).toBe(true);
    expect(acc.balance).toBe(0);
    // 历史流水保留
    expect(store.state.transactions).toHaveLength(1);
  });

  it('注销后账户不再计入总资产/总负债', () => {
    store.addAccount({ name: '微信零钱', type: 'wallet', balance: 1000 });
    store.addAccount({
      name: '信用卡', type: 'credit', balance: 500,
      meta: { kind: 'credit', limit: 10000, billDay: 1, dueDay: 20 },
    });
    expect(store.getTotalAssets()).toBe(1000);
    expect(store.getTotalLiabilities()).toBe(500);
    store.archiveAccount(store.state.accounts[0].id);
    store.archiveAccount(store.state.accounts[1].id);
    expect(store.getTotalAssets()).toBe(0);
    expect(store.getTotalLiabilities()).toBe(0);
  });

  it('注销后贷款账户不再产生待还提醒', () => {
    store.addAccount({ name: '微信零钱', type: 'wallet', balance: 100000 });
    store.addAccount({
      name: '房贷', type: 'loan', balance: 500000,
      meta: { kind: 'loan', principal: 500000, annualRate: 0.049, termMonths: 360, startDate: '2024-01-01', repaymentMethod: 'equal_interest', monthlyPayment: 2653, autoDeduct: false, paidMonths: 0, dueDay: 20, nextDueDate: '2024-02-01' },
    });
    expect(store.getDueItems('2024-02', '2024-02-01').some((i) => i.kind === 'loan')).toBe(true);
    store.archiveAccount(store.state.accounts[1].id);
    expect(store.getDueItems('2024-02', '2024-02-01').some((i) => i.kind === 'loan')).toBe(false);
  });

  it('注销不存在的账户报错', () => {
    expect(() => store.archiveAccount('not-exist')).toThrow(ValidationError);
  });
});

describe('支出/收入', () => {
  let store: Store;
  let acc: Record<string, Account>;
  beforeEach(() => {
    store = makeStore();
    acc = seedAccounts(store);
  });

  it('微信支出25 → 余额975', () => {
    const { tx } = store.applyTransaction({ type: 'expense', amount: 25, accountId: acc.wechat.id, date: TODAY });
    expect(store.getAccount(acc.wechat.id)!.balance).toBe(975);
    expect(tx.type).toBe('expense');
  });

  it('余额不足 → 阻塞错误 overdraft，确认后可透支', () => {
    try {
      store.applyTransaction({ type: 'expense', amount: 2000, accountId: acc.wechat.id, date: TODAY });
      expect.unreachable('应抛出 ValidationError');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).issues[0].code).toBe('overdraft');
    }
    store.applyTransaction({ type: 'expense', amount: 2000, accountId: acc.wechat.id, date: TODAY }, { confirm: true });
    expect(store.getAccount(acc.wechat.id)!.balance).toBe(-1000);
  });

  it('信用卡消费 → 已用额度增加', () => {
    store.applyTransaction({ type: 'expense', amount: 500, accountId: acc.cc.id, date: TODAY });
    expect(store.getAccount(acc.cc.id)!.balance).toBe(500);
  });

  it('信用卡超额 → 阻塞错误 limit_exceeded', () => {
    expect(() =>
      store.applyTransaction({ type: 'expense', amount: 31000, accountId: acc.cc.id, date: TODAY }),
    ).toThrowError(ValidationError);
  });

  it('大额交易 ≥50000 → 阻塞错误 large_amount', () => {
    try {
      store.applyTransaction({ type: 'expense', amount: 60000, accountId: acc.cmb.id, date: TODAY });
      expect.unreachable();
    } catch (e) {
      expect((e as ValidationError).issues[0].code).toBe('large_amount');
    }
  });

  it('收入 → 余额增加', () => {
    store.applyTransaction({ type: 'income', amount: 3000, accountId: acc.cmb.id, date: TODAY });
    expect(store.getAccount(acc.cmb.id)!.balance).toBe(23000);
  });

  it('账户不存在 → 报错', () => {
    expect(() =>
      store.applyTransaction({ type: 'expense', amount: 1, accountId: 'ghost', date: TODAY }),
    ).toThrow(ValidationError);
  });

  it('金额非法 → 报错', () => {
    expect(() =>
      store.applyTransaction({ type: 'expense', amount: 0, accountId: acc.wechat.id, date: TODAY }),
    ).toThrow(ValidationError);
    expect(() =>
      store.applyTransaction({ type: 'expense', amount: -5, accountId: acc.wechat.id, date: TODAY }),
    ).toThrow(ValidationError);
  });

  it('疑似重复交易 → 非阻塞警告', () => {
    store.applyTransaction({ type: 'expense', amount: 25, accountId: acc.wechat.id, date: TODAY, description: '吃面' });
    const r = store.applyTransaction({ type: 'expense', amount: 25, accountId: acc.wechat.id, date: TODAY, description: '吃面' });
    expect(r.warnings.some((w) => w.includes('重复'))).toBe(true);
  });
});

describe('转账', () => {
  it('招行转微信2500 → 双边余额正确', () => {
    const store = makeStore();
    const acc = seedAccounts(store);
    store.applyTransaction({
      type: 'transfer', amount: 2500, accountId: acc.cmb.id, relatedAccountId: acc.wechat.id, date: TODAY,
    });
    expect(store.getAccount(acc.cmb.id)!.balance).toBe(17500);
    expect(store.getAccount(acc.wechat.id)!.balance).toBe(3500);
  });

  it('转账目标缺失 → 报错', () => {
    const store = makeStore();
    const acc = seedAccounts(store);
    expect(() =>
      store.applyTransaction({ type: 'transfer', amount: 100, accountId: acc.cmb.id, date: TODAY }),
    ).toThrow(ValidationError);
  });
});

describe('还款', () => {
  it('还信用卡2000：储蓄卡-2000，信用卡已用-2000', () => {
    const store = makeStore();
    const acc = seedAccounts(store);
    store.applyTransaction({ type: 'expense', amount: 5000, accountId: acc.cc.id, date: TODAY });
    store.applyTransaction({
      type: 'repayment', amount: 2000, accountId: acc.cmb.id, relatedAccountId: acc.cc.id, date: TODAY,
    });
    expect(store.getAccount(acc.cmb.id)!.balance).toBe(18000);
    expect(store.getAccount(acc.cc.id)!.balance).toBe(3000);
  });

  it('还贷款：利息拆分、剩余本金减少、已还月数+1、下期+1月', () => {
    const store = makeStore();
    const { cmb } = seedAccounts(store);
    const loan = store.addAccount({
      name: '房贷', type: 'loan', balance: 120000,
      meta: {
        kind: 'loan', principal: 120000, annualRate: 0.06, termMonths: 12,
        startDate: '2026-06-15', repaymentMethod: 'equal_interest',
        monthlyPayment: 10327.93, autoDeduct: false, paidMonths: 0, dueDay: 15, nextDueDate: '2026-07-15',
      },
    });
    store.applyTransaction({
      type: 'repayment', amount: 10327.93, accountId: cmb.id, relatedAccountId: loan.id, date: TODAY,
    });
    const after = store.getAccount(loan.id)!;
    // 利息 = 120000 * 0.5% = 600，本金 = 9727.93
    expect(after.balance).toBeCloseTo(110272.07, 2);
    const meta = after.meta as Extract<Account['meta'], { kind: 'loan' }>;
    expect(meta?.kind).toBe('loan');
    if (meta?.kind === 'loan') {
      expect(meta.paidMonths).toBe(1);
      expect(meta.nextDueDate).toBe('2026-08-15');
    }
    expect(cmbBalance(store, cmb.id)).toBeCloseTo(20000 - 10327.93, 2);
  });
});

function cmbBalance(store: Store, id: string): number {
  return store.getAccount(id)!.balance;
}

describe('退款', () => {
  it('退款 → 余额增加，类型为 refund', () => {
    const store = makeStore();
    const { wechat } = seedAccounts(store);
    store.applyTransaction({ type: 'expense', amount: 100, accountId: wechat.id, date: TODAY });
    const { tx } = store.applyTransaction({ type: 'refund', amount: 100, accountId: wechat.id, date: TODAY });
    expect(tx.type).toBe('refund');
    expect(store.getAccount(wechat.id)!.balance).toBe(1000);
  });
});

describe('撤销', () => {
  it('撤销支出 → 余额回滚', () => {
    const store = makeStore();
    const { wechat } = seedAccounts(store);
    store.applyTransaction({ type: 'expense', amount: 25, accountId: wechat.id, date: TODAY });
    const undone = store.undoLast();
    expect(undone).not.toBeNull();
    expect(store.getAccount(wechat.id)!.balance).toBe(1000);
    expect(store.state.transactions).toHaveLength(0);
  });

  it('撤销转账 → 双边回滚', () => {
    const store = makeStore();
    const acc = seedAccounts(store);
    store.applyTransaction({
      type: 'transfer', amount: 2500, accountId: acc.cmb.id, relatedAccountId: acc.wechat.id, date: TODAY,
    });
    store.undoLast();
    expect(store.getAccount(acc.cmb.id)!.balance).toBe(20000);
    expect(store.getAccount(acc.wechat.id)!.balance).toBe(1000);
  });

  it('撤销还贷 → 贷款元数据回滚', () => {
    const store = makeStore();
    const { cmb } = seedAccounts(store);
    const loan = store.addAccount({
      name: '房贷', type: 'loan', balance: 120000,
      meta: {
        kind: 'loan', principal: 120000, annualRate: 0.06, termMonths: 12,
        startDate: '2026-06-15', repaymentMethod: 'equal_interest',
        monthlyPayment: 10327.93, autoDeduct: false, paidMonths: 0, dueDay: 15, nextDueDate: '2026-07-15',
      },
    });
    store.applyTransaction({
      type: 'repayment', amount: 10327.93, accountId: cmb.id, relatedAccountId: loan.id, date: TODAY,
    });
    store.undoLast();
    const after = store.getAccount(loan.id)!;
    expect(after.balance).toBe(120000);
    const meta = after.meta as Extract<Account['meta'], { kind: 'loan' }>;
    if (meta?.kind === 'loan') {
      expect(meta.paidMonths).toBe(0);
      expect(meta.nextDueDate).toBe('2026-07-15');
    }
    expect(store.getAccount(cmb.id)!.balance).toBe(20000);
  });

  it('无可撤销 → 返回 null', () => {
    const store = makeStore();
    expect(store.undoLast()).toBeNull();
  });
});

describe('分期计划', () => {
  it('信用卡分期消费 → 已用额度增加 + 计划创建；还一期 → 期数+1', () => {
    const store = makeStore();
    const acc = seedAccounts(store);
    const { tx } = store.applyTransaction({ type: 'expense', amount: 9999, accountId: acc.cc.id, date: TODAY });
    const plan = store.createInstallmentPlan({
      name: 'iPhone 分期', type: 'credit_card', totalAmount: 9999, fee: 0, term: 12,
      accountId: acc.cc.id, firstDueDate: '2026-08-23', parentTxId: tx.id, autoDeduct: false,
    });
    expect(store.getAccount(acc.cc.id)!.balance).toBe(9999);
    expect(store.state.installmentPlans).toHaveLength(1);

    store.payInstallment(plan.id, acc.cmb.id, TODAY);
    const after = store.getPlan(plan.id)!;
    expect(after.paidTerms).toBe(1);
    expect(after.nextDueDate).toBe('2026-09-23');
    // 还款流水：招行储蓄卡扣款 833.25，信用卡已用减少
    expect(store.getAccount(acc.cmb.id)!.balance).toBeCloseTo(20000 - 833.25, 2);
    expect(store.getAccount(acc.cc.id)!.balance).toBeCloseTo(9999 - 833.25, 2);
  });

  it('撤销还分期 → 计划期数回滚', () => {
    const store = makeStore();
    const acc = seedAccounts(store);
    const plan = store.createInstallmentPlan({
      name: 'x', type: 'credit_card', totalAmount: 3000, fee: 0, term: 3,
      accountId: acc.cc.id, firstDueDate: '2026-08-23', autoDeduct: false,
    });
    store.payInstallment(plan.id, acc.cmb.id, TODAY);
    store.undoLast();
    expect(store.getPlan(plan.id)!.paidTerms).toBe(0);
    expect(store.getAccount(acc.cmb.id)!.balance).toBe(20000);
  });
});

describe('持久化', () => {
  it('保存后可完整恢复（含撤销栈）', () => {
    const storage = new MemoryStorage();
    const s1 = new Store(storage);
    const { wechat } = seedAccounts(s1);
    s1.applyTransaction({ type: 'expense', amount: 25, accountId: wechat.id, date: TODAY });

    const s2 = new Store(storage);
    expect(s2.load()).toBe(true);
    expect(s2.getAccount(wechat.id)!.balance).toBe(975);
    expect(s2.state.transactions).toHaveLength(1);
    // 撤销栈也恢复
    s2.undoLast();
    expect(s2.getAccount(wechat.id)!.balance).toBe(1000);
  });

  it('空存储 load → false', () => {
    const s = new Store(new MemoryStorage());
    expect(s.load()).toBe(false);
  });
});

describe('查询统计', () => {
  it('月度汇总：收入/支出/笔数', () => {
    const store = makeStore();
    const acc = seedAccounts(store);
    store.applyTransaction({ type: 'expense', amount: 25, accountId: acc.wechat.id, date: '2026-07-01' });
    store.applyTransaction({ type: 'expense', amount: 75, accountId: acc.wechat.id, date: '2026-07-24' });
    store.applyTransaction({ type: 'income', amount: 3000, accountId: acc.cmb.id, date: '2026-07-15' });
    store.applyTransaction({ type: 'expense', amount: 800, accountId: acc.wechat.id, date: '2026-06-30' });
    const s = store.getMonthlySummary('2026-07');
    expect(s.income).toBe(3000);
    expect(s.expense).toBe(100);
    expect(s.count).toBe(3);
  });

  it('分类统计：按类别聚合支出', () => {
    const store = makeStore();
    const acc = seedAccounts(store);
    store.applyTransaction({ type: 'expense', amount: 25, accountId: acc.wechat.id, date: '2026-07-01', category: '餐饮' });
    store.applyTransaction({ type: 'expense', amount: 75, accountId: acc.wechat.id, date: '2026-07-02', category: '餐饮' });
    store.applyTransaction({ type: 'expense', amount: 50, accountId: acc.wechat.id, date: '2026-07-03', category: '交通' });
    const stats = store.getCategoryStats('2026-07');
    expect(stats.find((s) => s.category === '餐饮')?.amount).toBe(100);
    expect(stats.find((s) => s.category === '交通')?.amount).toBe(50);
  });

  it('总资产/总负债', () => {
    const store = makeStore();
    const acc = seedAccounts(store);
    store.applyTransaction({ type: 'expense', amount: 5000, accountId: acc.cc.id, date: TODAY });
    expect(store.getTotalAssets()).toBe(21000);
    expect(store.getTotalLiabilities()).toBe(5000);
  });
});

describe('待还提醒', () => {
  it('信用卡还款日 + 贷款月供 + 分期 聚合', () => {
    const store = makeStore();
    const acc = seedAccounts(store);
    store.applyTransaction({ type: 'expense', amount: 2000, accountId: acc.cc.id, date: TODAY });
    store.addAccount({
      name: '房贷', type: 'loan', balance: 120000,
      meta: {
        kind: 'loan', principal: 120000, annualRate: 0.06, termMonths: 12,
        startDate: '2026-06-15', repaymentMethod: 'equal_interest',
        monthlyPayment: 10327.93, autoDeduct: false, paidMonths: 0, dueDay: 15, nextDueDate: '2026-07-15',
      },
    });
    store.createInstallmentPlan({
      name: '手机分期', type: 'credit_card', totalAmount: 3000, fee: 0, term: 3,
      accountId: acc.cc.id, firstDueDate: '2026-07-23', autoDeduct: false,
    });
    const items = store.getDueItems('2026-07', TODAY);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain('credit_due');
    expect(kinds).toContain('loan');
    expect(kinds).toContain('installment');
    const loanItem = items.find((i) => i.kind === 'loan')!;
    expect(loanItem.overdue).toBe(true); // 7-15 < 7-24 且未还
    expect(loanItem.amount).toBe(10327.93);
  });
});

describe('周期性记账', () => {
  it('每月10号规则 → 补生成缺失月份', () => {
    const store = makeStore();
    const acc = seedAccounts(store);
    store.addRecurringRule({
      name: '房租', type: 'expense', amount: 3000, accountId: acc.cmb.id,
      category: '住房', description: '每月房租', dayOfMonth: 10, startDate: '2026-05-10', active: true,
    });
    const generated = store.generateDueRecurring(TODAY);
    expect(generated).toHaveLength(3); // 5/10, 6/10, 7/10
    expect(store.getAccount(acc.cmb.id)!.balance).toBe(20000 - 9000);
    const rule = store.state.recurringRules[0];
    expect(rule.lastGenerated).toBe('2026-07-10');
  });

  it('再次执行不重复生成', () => {
    const store = makeStore();
    const acc = seedAccounts(store);
    store.addRecurringRule({
      name: '房租', type: 'expense', amount: 3000, accountId: acc.cmb.id,
      category: '住房', description: '每月房租', dayOfMonth: 10, startDate: '2026-07-10', active: true,
    });
    store.generateDueRecurring(TODAY);
    const again = store.generateDueRecurring(TODAY);
    expect(again).toHaveLength(0);
  });
});

describe('数据形状校验', () => {
  it('损坏的持久化数据 → load 拒绝', () => {
    const storage = new MemoryStorage();
    storage.setItem('accounting-ai:state:v1', JSON.stringify({ state: { schemaVersion: 1, accounts: 'oops' } }));
    const store = new Store(storage);
    expect(store.load()).toBe(false);
    expect(store.state.accounts).toHaveLength(0);
  });

  it('isValidStateShape 边界', () => {
    expect(isValidStateShape(null)).toBe(false);
    expect(isValidStateShape({})).toBe(false);
    expect(isValidStateShape({ schemaVersion: 999, accounts: [], transactions: [], installmentPlans: [], recurringRules: [] })).toBe(false);
    expect(isValidStateShape({ schemaVersion: 1, accounts: [], transactions: [], installmentPlans: [], recurringRules: [] })).toBe(true);
  });
});

describe('编辑流水 updateTransaction', () => {
  let store: Store;
  let acc: Record<string, Account>;
  beforeEach(() => {
    store = makeStore();
    acc = seedAccounts(store);
  });

  it('修改支付账户：旧账户回滚、新账户扣减', () => {
    const { wechat, cmb } = acc;
    const { tx } = store.applyTransaction({ type: 'expense', amount: 100, accountId: wechat.id, date: TODAY, description: '午餐' });
    expect(wechat.balance).toBe(900);
    store.updateTransaction(tx.id, { accountId: cmb.id });
    expect(store.state.transactions[0].accountId).toBe(cmb.id);
    expect(wechat.balance).toBe(1000);
    expect(cmb.balance).toBe(19900);
  });

  it('修改金额：按差额调整账户余额', () => {
    const { wechat } = acc;
    const { tx } = store.applyTransaction({ type: 'expense', amount: 100, accountId: wechat.id, date: TODAY });
    store.updateTransaction(tx.id, { amount: 30 });
    expect(wechat.balance).toBe(970);
    expect(store.state.transactions[0].amount).toBe(30);
  });

  it('同时改金额与账户：先回滚旧值再应用新值', () => {
    const { wechat, cmb } = acc;
    const { tx } = store.applyTransaction({ type: 'expense', amount: 100, accountId: wechat.id, date: TODAY });
    store.updateTransaction(tx.id, { accountId: cmb.id, amount: 250 });
    expect(wechat.balance).toBe(1000);
    expect(cmb.balance).toBe(19750);
    expect(store.state.transactions[0].amount).toBe(250);
  });

  it('转账：同时修改转出与转入账户，两端余额正确迁移', () => {
    const { wechat, cmb, cc } = acc;
    const { tx } = store.applyTransaction({ type: 'transfer', amount: 200, accountId: wechat.id, relatedAccountId: cmb.id, date: TODAY });
    expect(wechat.balance).toBe(800);
    expect(cmb.balance).toBe(20200);
    store.updateTransaction(tx.id, { accountId: cmb.id, relatedAccountId: cc.id });
    // wechat 回滚 +200 → 1000；cmb 回滚 -200 再扣 200 → 19800；cc +200 → 200
    expect(wechat.balance).toBe(1000);
    expect(cmb.balance).toBe(19800);
    expect(cc.balance).toBe(200);
  });

  it('转账清空目标账户报错', () => {
    const { wechat, cmb } = acc;
    const { tx } = store.applyTransaction({ type: 'transfer', amount: 200, accountId: wechat.id, relatedAccountId: cmb.id, date: TODAY });
    expect(() => store.updateTransaction(tx.id, { relatedAccountId: '' })).toThrow(ValidationError);
  });

  it('账户不存在时报错', () => {
    const { wechat } = acc;
    const { tx } = store.applyTransaction({ type: 'expense', amount: 100, accountId: wechat.id, date: TODAY });
    expect(() => store.updateTransaction(tx.id, { accountId: 'not-exist' })).toThrow(ValidationError);
  });

  it('调账不自动调整账户余额', () => {
    const { wechat, cmb } = acc;
    const { tx } = store.applyTransaction({ type: 'adjustment', amount: 50, accountId: wechat.id, date: TODAY });
    const before = wechat.balance;
    store.updateTransaction(tx.id, { accountId: cmb.id });
    expect(wechat.balance).toBe(before);
    expect(cmb.balance).toBe(20000);
  });
});
