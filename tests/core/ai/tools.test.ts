import { beforeEach, describe, expect, it } from 'vitest';
import { executeTool, AI_TOOLS } from '../../../src/core/ai/tools';
import { store } from '../../../src/ui/appState';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function seed() {
  store.clearAll();
  store.addAccount({ name: '微信零钱', type: 'wallet', balance: 1000 });
  store.addAccount({ name: '招行信用卡', type: 'credit', balance: 0, meta: { kind: 'credit', limit: 30000, billDay: 5, dueDay: 23 } });
}

describe('AI tools 定义', () => {
  it('包含 8 个工具', () => {
    const names = AI_TOOLS.map((t) => t.function.name);
    expect(names).toEqual([
      'add_transaction',
      'list_transactions',
      'delete_transaction',
      'update_transaction',
      'query_balance',
      'query_summary',
      'add_account',
      'list_accounts',
    ]);
  });

  it('delete_transaction 工具定义包含 confirm 参数', () => {
    const del = AI_TOOLS.find((t) => t.function.name === 'delete_transaction')!;
    expect(del.function.parameters.properties).toHaveProperty('confirm');
  });
});

describe('executeTool - add_transaction', () => {
  beforeEach(seed);

  it('正常记账：成功扣减余额', () => {
    const r = executeTool({
      name: 'add_transaction',
      arguments: { type: 'expense', amount: 25, description: '午饭' },
    });
    expect(r.success).toBe(true);
    expect(r.result).toContain('已记支出');
    expect(r.result).toContain('¥25');
    expect(store.state.transactions).toHaveLength(1);
    expect(store.state.accounts[0].balance).toBe(975);
  });

  it('无账户时返回失败', () => {
    store.clearAll();
    const r = executeTool({
      name: 'add_transaction',
      arguments: { type: 'expense', amount: 10, description: 'x' },
    });
    expect(r.success).toBe(false);
    expect(r.result).toContain('账户');
  });

  it('指定不存在的账户名失败', () => {
    const r = executeTool({
      name: 'add_transaction',
      arguments: { type: 'expense', amount: 10, description: 'x', accountName: '不存在的账户' },
    });
    expect(r.success).toBe(false);
    expect(r.result).toContain('没找到账户');
  });

  it('收入记账增加余额', () => {
    const r = executeTool({
      name: 'add_transaction',
      arguments: { type: 'income', amount: 5000, description: '工资' },
    });
    expect(r.success).toBe(true);
    expect(store.state.accounts[0].balance).toBe(6000);
  });
});

describe('executeTool - list_transactions', () => {
  beforeEach(seed);

  it('列出流水', () => {
    executeTool({ name: 'add_transaction', arguments: { type: 'expense', amount: 25, description: '午饭' } });
    executeTool({ name: 'add_transaction', arguments: { type: 'income', amount: 5000, description: '工资' } });
    const r = executeTool({ name: 'list_transactions', arguments: {} });
    expect(r.success).toBe(true);
    expect(r.result).toContain('找到 2 笔');
    expect(r.result).toContain('午饭');
    expect(r.result).toContain('工资');
  });

  it('按类型筛选', () => {
    executeTool({ name: 'add_transaction', arguments: { type: 'expense', amount: 25, description: '午饭' } });
    executeTool({ name: 'add_transaction', arguments: { type: 'income', amount: 5000, description: '工资' } });
    const r = executeTool({ name: 'list_transactions', arguments: { type: 'income' } });
    expect(r.success).toBe(true);
    expect(r.result).toContain('找到 1 笔');
    expect(r.result).not.toContain('午饭');
  });

  it('空结果', () => {
    const r = executeTool({ name: 'list_transactions', arguments: {} });
    expect(r.success).toBe(true);
    expect(r.result).toContain('没有找到');
  });
});

describe('executeTool - delete_transaction（二次确认）', () => {
  beforeEach(seed);

  it('未传 confirm 时仅返回预览，不执行删除', () => {
    executeTool({ name: 'add_transaction', arguments: { type: 'expense', amount: 25, description: '午饭' } });
    const txId = store.state.transactions[0].id;
    const r = executeTool({ name: 'delete_transaction', arguments: { id: txId } });
    expect(r.success).toBe(true);
    expect(r.result).toContain('即将删除');
    expect(r.result).toContain('confirm=true');
    // 关键：未真删
    expect(store.state.transactions).toHaveLength(1);
  });

  it('confirm=true 执行删除', () => {
    executeTool({ name: 'add_transaction', arguments: { type: 'expense', amount: 25, description: '午饭' } });
    const txId = store.state.transactions[0].id;
    const r = executeTool({ name: 'delete_transaction', arguments: { id: txId, confirm: true } });
    expect(r.success).toBe(true);
    expect(r.result).toContain('已删除');
    expect(store.state.transactions).toHaveLength(0);
  });

  it('按关键词模糊匹配删除', () => {
    executeTool({ name: 'add_transaction', arguments: { type: 'expense', amount: 25, description: '午饭' } });
    const r = executeTool({ name: 'delete_transaction', arguments: { descriptionKeyword: '午', confirm: true } });
    expect(r.success).toBe(true);
    expect(r.result).toContain('已删除');
    expect(store.state.transactions).toHaveLength(0);
  });

  it('多个匹配时拒绝并返回预览列表', () => {
    executeTool({ name: 'add_transaction', arguments: { type: 'expense', amount: 25, description: '午饭' } });
    executeTool({ name: 'add_transaction', arguments: { type: 'expense', amount: 30, description: '午饭面条' } });
    const r = executeTool({ name: 'delete_transaction', arguments: { descriptionKeyword: '午', confirm: true } });
    expect(r.success).toBe(false);
    expect(r.result).toContain('2 笔');
  });

  it('未提供 id 与关键词时报错', () => {
    const r = executeTool({ name: 'delete_transaction', arguments: {} });
    expect(r.success).toBe(false);
  });

  it('id 不存在时报错', () => {
    const r = executeTool({ name: 'delete_transaction', arguments: { id: 'tx-nope', confirm: true } });
    expect(r.success).toBe(false);
  });
});

describe('executeTool - update_transaction', () => {
  beforeEach(seed);

  it('按关键词更新金额', () => {
    executeTool({ name: 'add_transaction', arguments: { type: 'expense', amount: 25, description: '午饭' } });
    const r = executeTool({
      name: 'update_transaction',
      arguments: { descriptionKeyword: '午', newAmount: 30 },
    });
    expect(r.success).toBe(true);
    expect(r.result).toContain('¥30');
    expect(store.state.transactions[0].amount).toBe(30);
  });
});

describe('executeTool - query_balance', () => {
  beforeEach(seed);

  it('查询全部账户返回总资产与净资产', () => {
    const r = executeTool({ name: 'query_balance', arguments: {} });
    expect(r.success).toBe(true);
    expect(r.result).toContain('总资产');
    expect(r.result).toContain('净资产');
  });

  it('按名称查询单账户', () => {
    const r = executeTool({ name: 'query_balance', arguments: { accountName: '微信' } });
    expect(r.success).toBe(true);
    expect(r.result).toContain('微信零钱');
    // formatMoney 会输出千分位 + 两位小数：1000 → 1,000.00
    expect(r.result).toContain('¥1,000.00');
  });

  it('未匹配账户名失败', () => {
    const r = executeTool({ name: 'query_balance', arguments: { accountName: '不存在' } });
    expect(r.success).toBe(false);
  });
});

describe('executeTool - query_summary', () => {
  beforeEach(seed);

  it('月度统计包含收支结余', () => {
    executeTool({ name: 'add_transaction', arguments: { type: 'expense', amount: 100, description: 'x' } });
    executeTool({ name: 'add_transaction', arguments: { type: 'income', amount: 5000, description: '工资' } });
    const r = executeTool({ name: 'query_summary', arguments: {} });
    expect(r.success).toBe(true);
    expect(r.result).toContain('支出');
    expect(r.result).toContain('收入');
    expect(r.result).toContain('结余');
  });

  it('today 范围', () => {
    executeTool({ name: 'add_transaction', arguments: { type: 'expense', amount: 100, description: 'x' } });
    const r = executeTool({ name: 'query_summary', arguments: { scope: 'today' } });
    expect(r.success).toBe(true);
    expect(r.result).toContain(todayStr());
  });
});

describe('executeTool - add_account / list_accounts', () => {
  beforeEach(seed);

  it('add_account 新增账户', () => {
    const r = executeTool({ name: 'add_account', arguments: { name: '支付宝', type: 'alipay', balance: 200 } });
    expect(r.success).toBe(true);
    expect(store.state.accounts.some((a) => a.name === '支付宝')).toBe(true);
  });

  it('list_accounts 列出全部', () => {
    const r = executeTool({ name: 'list_accounts', arguments: {} });
    expect(r.success).toBe(true);
    expect(r.result).toContain('微信零钱');
    expect(r.result).toContain('招行信用卡');
  });

  it('list_accounts 空账户场景', () => {
    store.clearAll();
    const r = executeTool({ name: 'list_accounts', arguments: {} });
    expect(r.success).toBe(true);
    expect(r.result).toContain('还没有任何账户');
  });
});

describe('executeTool - 未知工具', () => {
  it('返回失败', () => {
    const r = executeTool({ name: 'no_such_tool', arguments: {} });
    expect(r.success).toBe(false);
    expect(r.result).toContain('未知工具');
  });
});
