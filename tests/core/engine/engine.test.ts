import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../../src/core/engine/engine';
import { MemoryStorage, Store } from '../../../src/core/store/store';

const NOW = new Date(2026, 6, 24, 15, 30);

function setup(multiAsset = false) {
  const store = new Store(new MemoryStorage());
  const wechat = store.addAccount({ name: '微信零钱', type: 'wallet', balance: 1000 });
  const cc = store.addAccount({
    name: '招行信用卡', type: 'credit', balance: 0,
    meta: { kind: 'credit', limit: 30000, billDay: 5, dueDay: 23 },
  });
  let cmb: ReturnType<Store['addAccount']> | undefined;
  if (multiAsset) {
    cmb = store.addAccount({ name: '招行储蓄卡', type: 'debit', balance: 20000 });
  }
  const engine = new Engine(store, () => NOW);
  return { store, engine, wechat, cc, cmb };
}

describe('基础记账', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('中午吃了碗面25 → 记账成功，余额975', () => {
    const r = ctx.engine.handle('中午吃了碗面25');
    expect(r.status).toBe('ok');
    expect(r.message).toContain('25');
    expect(ctx.store.getAccount(ctx.wechat.id)!.balance).toBe(975);
    expect(ctx.store.state.transactions[0].category).toBe('餐饮');
  });

  it('3k工资到账 → 收入默认进微信', () => {
    const r = ctx.engine.handle('3k工资到账');
    expect(r.status).toBe('ok');
    expect(ctx.store.getAccount(ctx.wechat.id)!.balance).toBe(4000);
    expect(ctx.store.state.transactions[0].type).toBe('income');
  });

  it('无账户 → 引导创建', () => {
    const store = new Store(new MemoryStorage());
    const engine = new Engine(store, () => NOW);
    const r = engine.handle('吃饭25');
    expect(r.status).toBe('error');
    expect(r.message).toContain('账户');
  });

  it('多个资产账户 + 无账户提示 → 追问选择', () => {
    const { engine } = setup(true);
    const r = engine.handle('打车30');
    expect(r.status).toBe('clarify');
    expect(r.clarifyOptions?.length).toBeGreaterThanOrEqual(2);
    // 回答选择
    const r2 = engine.handle('招行储蓄卡');
    expect(r2.status).toBe('ok');
  });

  it('指定账户：用招行卡打车30', () => {
    const { engine, store, cmb } = setup(true);
    const r = engine.handle('用招行储蓄卡打车30');
    expect(r.status).toBe('ok');
    expect(store.getAccount(cmb!.id)!.balance).toBe(19970);
  });
});

describe('模糊金额', () => {
  it('花了三百多 → 请求确认精确金额；回复数字后入账', () => {
    const { engine, store, wechat } = setup();
    const r = engine.handle('昨晚请同事吃饭花了三百多');
    expect(r.status).toBe('confirm');
    expect(r.message).toContain('300');
    const r2 = engine.handle('350');
    expect(r2.status).toBe('ok');
    expect(store.getAccount(wechat.id)!.balance).toBe(650);
    expect(store.state.transactions[0].date).toBe('2026-07-23');
  });

  it('回复"对" → 按估算值入账', () => {
    const { engine, store, wechat } = setup();
    engine.handle('昨晚请同事吃饭花了三百多');
    const r2 = engine.handle('对');
    expect(r2.status).toBe('ok');
    expect(store.getAccount(wechat.id)!.balance).toBe(700);
    expect(store.state.transactions[0].estimated).toBe(true);
  });
});

describe('大额与透支确认', () => {
  it('60000 → 大额确认；确认后入账', () => {
    const { engine, store } = setup(true);
    const r = engine.handle('用招行储蓄卡买了块表60000');
    expect(r.status).toBe('confirm');
    expect(r.message).toContain('大额');
    const r2 = engine.confirmPending();
    expect(r2.status).toBe('ok');
    expect(store.getAccount(store.state.accounts.find((a) => a.name === '招行储蓄卡')!.id)!.balance).toBe(-40000);
  });

  it('取消确认 → 不入账', () => {
    const { engine, store } = setup(true);
    engine.handle('用招行储蓄卡买了块表60000');
    const r = engine.cancelPending();
    expect(r.status).toBe('error');
    expect(store.state.transactions).toHaveLength(0);
  });

  it('透支 → 确认后可记', () => {
    const { engine, store, wechat } = setup();
    const r = engine.handle('买衣服2000');
    expect(r.status).toBe('confirm');
    const r2 = engine.confirmPending();
    expect(r2.status).toBe('ok');
    expect(store.getAccount(wechat.id)!.balance).toBe(-1000);
  });
});

describe('转账', () => {
  it('从招行卡转了两千五到微信', () => {
    const { engine, store } = setup(true);
    const r = engine.handle('从招行储蓄卡转了两千五到微信');
    expect(r.status).toBe('ok');
    const cmb = store.state.accounts.find((a) => a.name === '招行储蓄卡')!;
    const wechat = store.state.accounts.find((a) => a.name === '微信零钱')!;
    expect(cmb.balance).toBe(17500);
    expect(wechat.balance).toBe(3500);
  });

  it('目标账户缺失/未知 → 改为澄清并列出可选账户 (P1-4)', () => {
    const { engine } = setup(true);
    const r = engine.handle('从招行储蓄卡转了500到不存在账户');
    // P1-4 歧义消解：未解析到目标账户时不再直接报错，而是澄清让用户从现有账户中选择
    expect(r.status).toBe('clarify');
    expect(r.message).toContain('账户');
    expect(r.clarifyOptions?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('还款', () => {
  it('还了信用卡一部分 → 追问金额', () => {
    const { engine } = setup(true);
    const r = engine.handle('还了信用卡一部分');
    expect(r.status).toBe('clarify');
    expect(r.message).toContain('多少');
    const r2 = engine.handle('2000');
    expect(r2.status).toBe('ok');
  });

  it('还了信用卡2000 → 追问用哪个账户还（多资产）', () => {
    const { engine, store } = setup(true);
    const r = engine.handle('还了信用卡2000');
    expect(r.status).toBe('clarify');
    const r2 = engine.handle('招行储蓄卡');
    expect(r2.status).toBe('ok');
    const cc = store.state.accounts.find((a) => a.name === '招行信用卡')!;
    expect(cc.balance).toBe(-2000);
  });
});

describe('分期', () => {
  it('买了部手机8000，招行信用卡分12期 → 计划+首笔负债', () => {
    const { engine, store } = setup(true);
    const r = engine.handle('买了部手机8000，招行信用卡分12期');
    expect(r.status).toBe('ok');
    expect(store.state.installmentPlans).toHaveLength(1);
    const plan = store.state.installmentPlans[0];
    expect(plan.term).toBe(12);
    expect(plan.monthlyPayment).toBeCloseTo(666.67, 2);
    const cc = store.state.accounts.find((a) => a.name === '招行信用卡')!;
    expect(cc.balance).toBe(8000);
    expect(plan.nextDueDate).toBe('2026-08-23'); // 信用卡还款日23号
  });

  it('撤销分期消费 → 计划一并移除', () => {
    const { engine, store } = setup(true);
    engine.handle('买了部手机8000，招行信用卡分12期');
    const r = engine.handle('撤销上一笔');
    expect(r.status).toBe('ok');
    expect(store.state.installmentPlans).toHaveLength(0);
    const cc = store.state.accounts.find((a) => a.name === '招行信用卡')!;
    expect(cc.balance).toBe(0);
  });
});

describe('周期记账', () => {
  it('每月10号还房贷5000 → 创建规则', () => {
    const { engine, store } = setup(true);
    const r = engine.handle('每月10号用招行储蓄卡还房贷5000');
    expect(r.status).toBe('ok');
    expect(store.state.recurringRules).toHaveLength(1);
    expect(store.state.recurringRules[0].dayOfMonth).toBe(10);
  });
});

describe('查询', () => {
  it('查余额：微信还有多少', () => {
    const { engine } = setup(true);
    const r = engine.handle('微信还有多少余额');
    expect(r.status).toBe('ok');
    expect(r.message).toContain('1,000');
  });

  it('月度汇总：这个月花了多少', () => {
    const { engine } = setup(true);
    engine.handle('用招行储蓄卡打车30');
    const r = engine.handle('这个月花了多少');
    expect(r.status).toBe('ok');
    expect(r.message).toContain('30');
  });
});

describe('撤销与帮助', () => {
  it('撤销上一笔', () => {
    const { engine, store, wechat } = setup();
    engine.handle('吃面25');
    const r = engine.handle('撤销上一笔');
    expect(r.status).toBe('ok');
    expect(store.getAccount(wechat.id)!.balance).toBe(1000);
  });

  it('无流水时撤销 → 提示', () => {
    const { engine } = setup();
    const r = engine.handle('撤销上一笔');
    expect(r.status).toBe('error');
  });

  it('无法识别 → 帮助提示', () => {
    const { engine } = setup();
    const r = engine.handle('你好呀');
    expect(r.status).toBe('error');
    expect(r.message).toContain('记账');
  });
});

describe('重复记账检测', () => {
  it('相同金额+账户+日期 → 警告提示', () => {
    const { engine } = setup();
    engine.handle('吃面25');
    const r = engine.handle('吃面25');
    expect(r.status).toBe('ok');
    expect(r.message).toContain('重复');
  });
});
