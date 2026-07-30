import { describe, expect, it } from 'vitest';
import { Engine } from '../../../src/core/engine/engine';
import { MemoryStorage, Store } from '../../../src/core/store/store';
import { parse } from '../../../src/core/parser/parser';

const NOW = new Date(2026, 5, 15); // 2026-06-15

function setup() {
  const store = new Store(new MemoryStorage());
  store.addAccount({ name: '微信零钱', type: 'wallet', balance: 5000 });
  // 上月（2026-05）与本月（2026-06）各记几笔，制造环比
  store.applyTransaction({ type: 'expense', amount: 600, accountId: store.state.accounts[0].id, category: '餐饮', description: '上月餐饮', date: '2026-05-04' });
  store.applyTransaction({ type: 'expense', amount: 900, accountId: store.state.accounts[0].id, category: '餐饮', description: '本月餐饮', date: '2026-06-10' });
  store.applyTransaction({ type: 'income', amount: 5000, accountId: store.state.accounts[0].id, category: '工资', description: '本月工资', date: '2026-06-15' });
  const engine = new Engine(store, () => NOW);
  return { store, engine };
}

describe('parser -> analyze_trend', () => {
  it('「这个月比上个月怎么样」识别为趋势意图', () => {
    expect(parse('这个月比上个月怎么样', NOW).kind).toBe('analyze_trend');
  });
  it('「分析一下消费趋势」识别为趋势意图', () => {
    expect(parse('分析一下我的消费趋势', NOW).kind).toBe('analyze_trend');
  });
  it('「本月环比」识别为趋势意图', () => {
    expect(parse('看看本月环比', NOW).kind).toBe('analyze_trend');
  });
  it('「这个月花了多少」仍走查询汇总，不被趋势拦截', () => {
    expect(parse('这个月花了多少', NOW).kind).toBe('query_summary');
  });
  it('「吃午饭25」仍按支出处理（含金额不触发趋势）', () => {
    expect(parse('吃午饭25', NOW).kind).toBe('expense');
  });
});

describe('engine -> analyze_trend', () => {
  it('本地模式直接返回趋势报告', () => {
    const { engine } = setup();
    const r = engine.handle('分析一下这个月的消费趋势');
    expect(r.status).toBe('ok');
    expect(r.message).toContain('【消费趋势 2026年6月】');
    expect(r.message).toContain('餐饮');
    expect(r.message).toContain('环比');
  });
});
