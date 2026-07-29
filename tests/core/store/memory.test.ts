import { beforeEach, describe, expect, it } from 'vitest';
import { isSimilar, MemoryStore, MemoryStorageAdapter } from '../../../src/core/store/memory';

describe('isSimilar', () => {
  it('包含关系视为相似', () => {
    expect(isSimilar('偏好用微信支付', '微信支付')).toBe(true);
    expect(isSimilar('微信支付', '偏好用微信支付')).toBe(true);
  });

  it('归一化标点空白后比较', () => {
    expect(isSimilar('偏好，用微信支付。', '偏好用微信支付')).toBe(true);
  });

  it('不相似返回 false', () => {
    expect(isSimilar('午饭25', '工资5000')).toBe(false);
  });

  it('空串返回 false', () => {
    expect(isSimilar('', 'x')).toBe(false);
    expect(isSimilar('x', '')).toBe(false);
  });
});

describe('MemoryStore', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore(new MemoryStorageAdapter());
  });

  it('add 默认 manual + fact', () => {
    const m = store.add({ content: '某事实' });
    expect(m.source).toBe('manual');
    expect(m.category).toBe('fact');
    expect(store.list()).toHaveLength(1);
  });

  it('list 按 updatedAt 倒序', () => {
    const a = store.add({ content: 'A' });
    // 确保 b 的 updatedAt 比 a 晚
    const b = store.add({ content: 'B' });
    store.update(a.id, { content: 'A2' });
    const order = store.list().map((m) => m.id);
    // a 被 update 过，应在最前
    expect(order[0]).toBe(a.id);
    expect(order[1]).toBe(b.id);
  });

  it('listByCategory 筛选', () => {
    store.add({ content: 'a', category: 'habit' });
    store.add({ content: 'b', category: 'preference' });
    store.add({ content: 'c', category: 'habit' });
    expect(store.listByCategory('habit')).toHaveLength(2);
    expect(store.listByCategory('preference')).toHaveLength(1);
  });

  it('hasSimilar 用于去重', () => {
    store.add({ content: '偏好用微信支付' });
    expect(store.hasSimilar('偏好用微信支付')).toBe(true);
    expect(store.hasSimilar('偏好用支付宝支付')).toBe(false);
  });

  it('update 修改内容与类型', () => {
    const m = store.add({ content: '原内容', category: 'fact' });
    const updated = store.update(m.id, { content: '新内容', category: 'habit' });
    expect(updated?.content).toBe('新内容');
    expect(updated?.category).toBe('habit');
    expect(updated?.updatedAt).not.toBe(m.createdAt);
  });

  it('update 不存在返回 null', () => {
    expect(store.update('nope', { content: 'x' })).toBeNull();
  });

  it('remove 删除', () => {
    const m = store.add({ content: 'x' });
    const removed = store.remove(m.id);
    expect(removed?.id).toBe(m.id);
    expect(store.list()).toHaveLength(0);
  });

  it('remove 不存在返回 null', () => {
    expect(store.remove('nope')).toBeNull();
  });

  it('auto 记忆超限 FIFO 淘汰', () => {
    // 添加 35 条 auto 记忆
    for (let i = 0; i < 35; i++) {
      store.add({ content: `auto-${i}`, source: 'auto' });
    }
    const all = store.list();
    // 上限 30
    expect(all).toHaveLength(30);
    // 最早的 auto-0..auto-4 应被淘汰
    expect(all.some((m) => m.content === 'auto-0')).toBe(false);
    expect(all.some((m) => m.content === 'auto-4')).toBe(false);
    // auto-5 起保留
    expect(all.some((m) => m.content === 'auto-5')).toBe(true);
    expect(all.some((m) => m.content === 'auto-34')).toBe(true);
  });

  it('manual 记忆不受 auto 上限影响', () => {
    for (let i = 0; i < 35; i++) {
      store.add({ content: `manual-${i}`, source: 'manual' });
    }
    expect(store.list()).toHaveLength(35);
  });

  it('持久化 load 后恢复', () => {
    const adapter = new MemoryStorageAdapter();
    const s1 = new MemoryStore(adapter);
    s1.add({ content: '持久化的记忆' });
    const s2 = new MemoryStore(adapter);
    expect(s2.list().some((m) => m.content === '持久化的记忆')).toBe(true);
  });

  it('clearAll 清空', () => {
    store.add({ content: 'a' });
    store.add({ content: 'b' });
    store.clearAll();
    expect(store.list()).toHaveLength(0);
  });

  it('load 损坏数据返回 false', () => {
    const adapter = new MemoryStorageAdapter();
    adapter.setItem('accounting-ai:memories:v1', 'not-json');
    const s = new MemoryStore(adapter);
    expect(s.list()).toHaveLength(0);
  });
});
