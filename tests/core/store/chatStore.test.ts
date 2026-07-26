import { beforeEach, describe, expect, it } from 'vitest';
import { ChatMemoryStorageAdapter, ChatStore } from '../../../src/core/store/chatStore';

describe('ChatStore', () => {
  let store: ChatStore;
  beforeEach(() => {
    store = new ChatStore(new ChatMemoryStorageAdapter());
  });

  it('create 创建会话并设为 active', () => {
    const s = store.create();
    expect(s.id).toBeTruthy();
    expect(s.title).toBe('新对话');
    expect(store.getActive()?.id).toBe(s.id);
    expect(store.list()).toHaveLength(1);
  });

  it('getActive 无 active 时返回第一个', () => {
    const s = store.create();
    store.setActive('nonexistent');
    // activeId 仍指向不存在的，但 getActive 回退到第一个
    expect(store.getActive()?.id).toBe(s.id);
  });

  it('setActive 切换', () => {
    const a = store.create();
    const b = store.create();
    store.setActive(a.id);
    expect(store.getActive()?.id).toBe(a.id);
    store.setActive(b.id);
    expect(store.getActive()?.id).toBe(b.id);
  });

  it('list 按 updatedAt 倒序', () => {
    const a = store.create();
    const b = store.create();
    b.title = 'B';
    store.appendMessage(a.id, { role: 'user', text: 'hi' });
    const order = store.list();
    // a 刚被 append，updatedAt 最晚，应在前
    expect(order[0].id).toBe(a.id);
    expect(order[1].id).toBe(b.id);
  });

  it('appendMessage 首条用户消息自动作为标题', () => {
    const s = store.create();
    store.appendMessage(s.id, { role: 'user', text: '今天午饭花了30块' });
    const updated = store.get(s.id)!;
    expect(updated.title).toBe('今天午饭花了30块');
  });

  it('appendMessage 长标题截断', () => {
    const s = store.create();
    const long = '这是一段非常非常非常非常非常非常非常非常非常非常长的消息'.repeat(2);
    store.appendMessage(s.id, { role: 'user', text: long });
    const title = store.get(s.id)!.title;
    expect(title.length).toBeLessThanOrEqual(21); // 20 + 省略号
    expect(title.endsWith('…')).toBe(true);
  });

  it('setMessages 替换全部消息', () => {
    const s = store.create();
    store.appendMessage(s.id, { role: 'user', text: 'old' });
    store.setMessages(s.id, [
      { role: 'user', text: 'new1' },
      { role: 'ai', text: 'new2' },
    ]);
    expect(store.get(s.id)!.messages).toHaveLength(2);
    expect(store.get(s.id)!.messages[0].text).toBe('new1');
  });

  it('setMessages 自动从首条用户消息生成标题', () => {
    const s = store.create();
    store.setMessages(s.id, [
      { role: 'ai', text: '你好' },
      { role: 'user', text: '帮我记账' },
    ]);
    expect(store.get(s.id)!.title).toBe('帮我记账');
  });

  it('removeMessage 删除单条', () => {
    const s = store.create();
    const r1 = store.appendMessage(s.id, { role: 'user', text: 'a' });
    store.appendMessage(s.id, { role: 'ai', text: 'b' });
    const removed = store.removeMessage(s.id, r1!.id);
    expect(removed?.text).toBe('a');
    expect(store.get(s.id)!.messages).toHaveLength(1);
  });

  it('clearMessages 清空消息保留会话', () => {
    const s = store.create();
    store.appendMessage(s.id, { role: 'user', text: 'a' });
    store.clearMessages(s.id);
    expect(store.get(s.id)!.messages).toHaveLength(0);
    expect(store.list()).toHaveLength(1);
  });

  it('remove 删除整个会话', () => {
    const a = store.create();
    const b = store.create();
    store.setActive(a.id);
    store.remove(a.id);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].id).toBe(b.id);
    // active 被删后回退到剩余第一个
    expect(store.getActive()?.id).toBe(b.id);
  });

  it('rename 重命名', () => {
    const s = store.create();
    store.rename(s.id, '新名字');
    expect(store.get(s.id)!.title).toBe('新名字');
  });

  it('会话总数超限 FIFO 淘汰（保留 active）', () => {
    for (let i = 0; i < 55; i++) {
      store.create(`chat-${i}`);
    }
    expect(store.list().length).toBeLessThanOrEqual(50);
  });

  it('持久化 load 后恢复 sessions 与 activeId', () => {
    const adapter = new ChatMemoryStorageAdapter();
    const s1 = new ChatStore(adapter);
    const s = s1.create();
    s1.appendMessage(s.id, { role: 'user', text: '持久化测试' });
    const s2 = new ChatStore(adapter);
    expect(s2.list().some((x) => x.id === s.id)).toBe(true);
    expect(s2.get(s.id)!.messages[0].text).toBe('持久化测试');
  });

  it('load 损坏数据返回 false 且不抛异常', () => {
    const adapter = new ChatMemoryStorageAdapter();
    adapter.setItem('accounting-ai:chats:v1', 'not-json');
    const s = new ChatStore(adapter);
    expect(s.list()).toHaveLength(0);
  });

  it('clearAll 清空', () => {
    store.create();
    store.create();
    store.clearAll();
    expect(store.list()).toHaveLength(0);
    expect(store.getActive()).toBeUndefined();
  });
});
