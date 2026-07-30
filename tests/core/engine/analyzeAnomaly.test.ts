import { describe, expect, it } from 'vitest';
import { Engine } from '../../../src/core/engine/engine';
import { MemoryStorage, Store } from '../../../src/core/store/store';
import { parse } from '../../../src/core/parser/parser';

const NOW = new Date(2026, 6, 24); // 2026-07-24，参考月 = 2026-07

function setup() {
  const store = new Store(new MemoryStorage());
  store.addAccount({ name: '微信零钱', type: 'wallet', balance: 100000 });
  // 历史基线（2026-06 及以前）：餐饮约 50/笔
  for (let i = 0; i < 10; i++) {
    store.applyTransaction({
      type: 'expense',
      amount: 50,
      accountId: store.state.accounts[0].id,
      category: '餐饮',
      description: '日常餐饮',
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    });
  }
  // 本月（2026-07）一笔异常聚餐
  store.applyTransaction({
    type: 'expense',
    amount: 1500,
    accountId: store.state.accounts[0].id,
    category: '餐饮',
    description: '聚餐',
    date: '2026-07-10',
  });
  const engine = new Engine(store, () => NOW);
  return { store, engine };
}

describe('parser -> analyze_anomaly', () => {
  it('「有没有异常消费」识别为异常意图', () => {
    expect(parse('有没有异常消费', NOW).kind).toBe('analyze_anomaly');
  });
  it('「哪笔花得离谱」识别为异常意图', () => {
    expect(parse('哪笔花得离谱', NOW).kind).toBe('analyze_anomaly');
  });
  it('「吃午饭25」仍按支出处理（含金额不触发异常）', () => {
    expect(parse('吃午饭25', NOW).kind).toBe('expense');
  });
});

describe('engine -> analyze_anomaly', () => {
  it('本地模式直接返回异常消费报告', () => {
    const { engine } = setup();
    const r = engine.handle('有没有异常消费');
    expect(r.status).toBe('ok');
    expect(r.message).toContain('异常');
    expect(r.message).toContain('餐饮');
  });
});
