import { beforeEach, describe, expect, it } from 'vitest';
import { executeTool, AI_TOOLS } from '../../../src/core/ai/tools';
import { memoryStore, store } from '../../../src/ui/appState';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function seed() {
  store.clearAll();
  memoryStore.clearAll();
  store.addAccount({ name: '微信零钱', type: 'wallet', balance: 1000 });
  store.addAccount({ name: '招行信用卡', type: 'credit', balance: 0, meta: { kind: 'credit', limit: 30000, billDay: 5, dueDay: 23 } });
}

describe('AI tools 定义', () => {
  it('包含 12 个工具', () => {
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
      'list_memories',
      'add_memory',
      'update_memory',
      'delete_memory',
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

describe('executeTool - 记忆工具', () => {
  beforeEach(seed);

  it('add_memory 添加并去重', () => {
    const r = executeTool({ name: 'add_memory', arguments: { content: '偏好用微信支付', category: 'preference' } });
    expect(r.success).toBe(true);
    expect(r.result).toContain('已记住');
    expect(memoryStore.list()).toHaveLength(1);
    // 重复添加相似内容不会新增
    const r2 = executeTool({ name: 'add_memory', arguments: { content: '偏好用微信支付' } });
    expect(r2.success).toBe(true);
    expect(r2.result).toContain('已存在相似');
    expect(memoryStore.list()).toHaveLength(1);
  });

  it('add_memory 空内容失败', () => {
    const r = executeTool({ name: 'add_memory', arguments: { content: '   ' } });
    expect(r.success).toBe(false);
  });

  it('list_memories 列出全部', () => {
    executeTool({ name: 'add_memory', arguments: { content: '习惯午餐时间记账', category: 'habit' } });
    executeTool({ name: 'add_memory', arguments: { content: '使用招行信用卡', category: 'preference' } });
    const r = executeTool({ name: 'list_memories', arguments: {} });
    expect(r.success).toBe(true);
    expect(r.result).toContain('共 2 条');
    expect(r.result).toContain('习惯午餐时间记账');
    expect(r.result).toContain('使用招行信用卡');
  });

  it('list_memories 按类型筛选', () => {
    executeTool({ name: 'add_memory', arguments: { content: '习惯午餐时间记账', category: 'habit' } });
    executeTool({ name: 'add_memory', arguments: { content: '使用招行信用卡', category: 'preference' } });
    const r = executeTool({ name: 'list_memories', arguments: { category: 'preference' } });
    expect(r.success).toBe(true);
    expect(r.result).toContain('使用招行信用卡');
    expect(r.result).not.toContain('习惯午餐时间记账');
  });

  it('list_memories 空记忆', () => {
    const r = executeTool({ name: 'list_memories', arguments: {} });
    expect(r.success).toBe(true);
    expect(r.result).toContain('暂无');
  });

  it('update_memory 按关键词更新', () => {
    executeTool({ name: 'add_memory', arguments: { content: '偏好用微信支付' } });
    const r = executeTool({
      name: 'update_memory',
      arguments: { keyword: '微信', newContent: '偏好用支付宝支付' },
    });
    expect(r.success).toBe(true);
    expect(r.result).toContain('偏好用支付宝支付');
    expect(memoryStore.list()[0].content).toBe('偏好用支付宝支付');
  });

  it('update_memory 多个匹配拒绝', () => {
    executeTool({ name: 'add_memory', arguments: { content: '微信支付偏好' } });
    executeTool({ name: 'add_memory', arguments: { content: '微信余额查询' } });
    const r = executeTool({ name: 'update_memory', arguments: { keyword: '微信', newContent: 'x' } });
    expect(r.success).toBe(false);
    expect(r.result).toContain('2 条');
  });

  it('delete_memory 二次确认流程', () => {
    executeTool({ name: 'add_memory', arguments: { content: '偏好用微信支付' } });
    const memId = memoryStore.list()[0].id;
    // 未确认：仅预览
    const preview = executeTool({ name: 'delete_memory', arguments: { id: memId } });
    expect(preview.success).toBe(true);
    expect(preview.result).toContain('即将删除');
    expect(memoryStore.list()).toHaveLength(1);
    // 确认：执行删除
    const confirmed = executeTool({ name: 'delete_memory', arguments: { id: memId, confirm: true } });
    expect(confirmed.success).toBe(true);
    expect(confirmed.result).toContain('已删除');
    expect(memoryStore.list()).toHaveLength(0);
  });

  it('delete_memory 按关键词删除', () => {
    executeTool({ name: 'add_memory', arguments: { content: '偏好用微信支付' } });
    const r = executeTool({ name: 'delete_memory', arguments: { keyword: '微信', confirm: true } });
    expect(r.success).toBe(true);
    expect(memoryStore.list()).toHaveLength(0);
  });
});
