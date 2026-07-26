import { beforeEach, describe, expect, it } from 'vitest';
import {
  AMOUNT_PLACEHOLDER,
  fillTemplate,
  findPlaceholderRange,
  hasAmountPlaceholder,
  QuickInputMemoryStorageAdapter,
  QuickInputStore,
} from '../../../src/core/store/quickInput';

describe('QuickInputStore', () => {
  let store: QuickInputStore;
  beforeEach(() => {
    store = new QuickInputStore(new QuickInputMemoryStorageAdapter());
  });

  it('首次启动注入默认 6 项', () => {
    const list = store.list();
    expect(list).toHaveLength(6);
    const templates = list.map((q) => q.template);
    expect(templates).toContain('坐地铁上班7元');
    expect(templates).toContain('坐地铁下班7元');
    expect(templates).toContain(`早餐 ${AMOUNT_PLACEHOLDER} 元`);
    expect(templates).toContain('高铁票39元');
    expect(templates).toContain(`京东买 ${AMOUNT_PLACEHOLDER} 元`);
    expect(templates).toContain(`拼多多买 ${AMOUNT_PLACEHOLDER} 元`);
  });

  it('add 新增快捷输入', () => {
    const item = store.add('打车30');
    expect(item).not.toBeNull();
    expect(item!.template).toBe('打车30');
    expect(store.list()).toHaveLength(7);
  });

  it('add 空内容返回 null', () => {
    expect(store.add('   ')).toBeNull();
    expect(store.add('')).toBeNull();
    expect(store.list()).toHaveLength(6);
  });

  it('add 超过上限 30 条返回 null', () => {
    for (let i = 0; i < 24; i++) {
      store.add(`额外-${i}`);
    }
    expect(store.list()).toHaveLength(30);
    expect(store.add('超限')).toBeNull();
  });

  it('update 修改模板', () => {
    const item = store.add('打车30');
    const updated = store.update(item!.id, '打车40');
    expect(updated?.template).toBe('打车40');
    expect(store.get(item!.id)?.template).toBe('打车40');
  });

  it('update 空内容返回 null', () => {
    const item = store.list()[0];
    expect(store.update(item.id, '   ')).toBeNull();
  });

  it('update 不存在的 id 返回 null', () => {
    expect(store.update('qi-nope', 'x')).toBeNull();
  });

  it('remove 删除', () => {
    const item = store.list()[0];
    const removed = store.remove(item.id);
    expect(removed?.id).toBe(item.id);
    expect(store.list()).toHaveLength(5);
  });

  it('remove 不存在返回 null', () => {
    expect(store.remove('qi-nope')).toBeNull();
  });

  it('resetToDefaults 恢复默认', () => {
    store.add('自定义A');
    store.add('自定义B');
    // 自定义后总数应为 8（默认 6 + 2 个新增）
    expect(store.list()).toHaveLength(8);
    store.resetToDefaults();
    expect(store.list()).toHaveLength(6);
    // 确认是默认值
    const templates = store.list().map((q) => q.template);
    expect(templates).toContain('坐地铁上班7元');
    expect(templates).not.toContain('自定义A');
  });

  it('clearAll 清空', () => {
    store.clearAll();
    expect(store.list()).toHaveLength(0);
  });

  it('持久化 load 后恢复', () => {
    const adapter = new QuickInputMemoryStorageAdapter();
    const s1 = new QuickInputStore(adapter);
    s1.add('持久化的项');
    const s2 = new QuickInputStore(adapter);
    expect(s2.list().some((q) => q.template === '持久化的项')).toBe(true);
  });

  it('load 损坏数据返回 false 且不抛异常', () => {
    const adapter = new QuickInputMemoryStorageAdapter();
    adapter.setItem('accounting-ai:quick-inputs:v1', 'not-json');
    const s = new QuickInputStore(adapter);
    // 损坏时应回退到默认值，不抛异常
    expect(s.list()).toHaveLength(6);
  });
});

describe('占位符工具函数', () => {
  it('hasAmountPlaceholder 识别占位符', () => {
    expect(hasAmountPlaceholder(`早餐 ${AMOUNT_PLACEHOLDER} 元`)).toBe(true);
    expect(hasAmountPlaceholder('坐地铁上班7元')).toBe(false);
  });

  it('fillTemplate 替换占位符', () => {
    expect(fillTemplate(`早餐 ${AMOUNT_PLACEHOLDER} 元`, '15')).toBe('早餐 15 元');
    expect(fillTemplate('坐地铁上班7元', '15')).toBe('坐地铁上班7元');
  });

  it('findPlaceholderRange 返回占位符区间', () => {
    const tpl = `早餐 ${AMOUNT_PLACEHOLDER} 元`;
    const range = findPlaceholderRange(tpl);
    expect(range).not.toBeNull();
    expect(range![0]).toBe(tpl.indexOf(AMOUNT_PLACEHOLDER));
    expect(range![1]).toBe(range![0] + AMOUNT_PLACEHOLDER.length);
  });

  it('findPlaceholderRange 无占位符返回 null', () => {
    expect(findPlaceholderRange('坐地铁上班7元')).toBeNull();
  });
});
