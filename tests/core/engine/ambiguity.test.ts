import { describe, expect, it } from 'vitest';
import { Store } from '../../../src/core/store/store';
import { Engine } from '../../../src/core/engine/engine';

function freshEngine() {
  const store = new Store();
  const engine = new Engine(store);
  // 资产账户
  store.addAccount({ name: '微信零钱', type: 'wallet', balance: 5000 });
  // 两个信用卡：制造「还款目标二义」
  store.addAccount({ name: '招行信用卡', type: 'credit', balance: -2000 });
  store.addAccount({ name: '工行信用卡', type: 'credit', balance: -1500 });
  return { store, engine };
}

describe('P1-4 歧义消解', () => {
  it('还500（无目标）→ 追问还款目标，二选一', () => {
    const { engine } = freshEngine();
    const r = engine.handle('还500');
    expect(r.status).toBe('clarify');
    expect(r.clarifyOptions).toEqual(expect.arrayContaining(['招行信用卡', '工行信用卡']));
  });

  it('选招行信用卡后完成还款', () => {
    const { engine } = freshEngine();
    engine.handle('还500');
    const r = engine.handle('招行信用卡');
    expect(r.status).toBe('ok');
    expect(r.message).toContain('招行信用卡');
  });

  it('还了信用卡500（多张同类卡）→ 仍追问', () => {
    const { engine } = freshEngine();
    const r = engine.handle('还了信用卡500');
    expect(r.status).toBe('clarify');
    expect(r.message).toContain('还到哪个账户');
  });

  it('转500（无目标）→ 追问转账目标', () => {
    const { engine } = freshEngine();
    const r = engine.handle('转500');
    expect(r.status).toBe('clarify');
    expect(r.message).toContain('转到哪个账户');
    expect((r.clarifyOptions?.length ?? 0)).toBeGreaterThan(0);
  });

  it('选择目标后完成转账', () => {
    const { engine } = freshEngine();
    engine.handle('转500');
    const r = engine.handle('招行信用卡');
    expect(r.status).toBe('ok');
    expect(r.message).toContain('转出');
  });

  it('从微信零钱转500到招行信用卡（目标明确）→ 直接成功', () => {
    const { engine } = freshEngine();
    const r = engine.handle('从微信零钱转500到招行信用卡');
    expect(r.status).toBe('ok');
    expect(r.message).toContain('招行信用卡');
  });

  it('取消二义追问 → 未入账', () => {
    const { engine } = freshEngine();
    engine.handle('还500');
    const r = engine.handle('取消');
    expect(r.status).toBe('error');
    // 没有任何交易入账
    expect(engine['store'].state.transactions.length).toBe(0);
  });
});
