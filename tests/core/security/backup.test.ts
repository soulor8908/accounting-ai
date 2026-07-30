import { describe, it, expect, beforeEach } from 'vitest';
import { store, chatStore, memoryStore } from '../../../src/ui/appState';
import { createBackup, restoreBackup } from '../../../src/core/security/backup';

beforeEach(() => {
  store.clearAll();
  memoryStore.clearAll();
  chatStore.clearAll();
});

describe('加密备份（P0-1）', () => {
  it('用口令打包全量数据并跨设备还原', async () => {
    store.addAccount({ name: '微信零钱', type: 'wallet', balance: 100 });
    store.addAccount({ name: '支付宝', type: 'alipay', balance: 50 });
    memoryStore.add({ content: '偏好用微信零钱支付', category: 'preference', source: 'manual' });
    chatStore.create('测试会话');

    const backup = await createBackup('P@ssw0rd1');

    // 还原前清空
    store.clearAll();
    memoryStore.clearAll();
    chatStore.clearAll();
    expect(store.state.accounts.length).toBe(0);

    const ok = await restoreBackup(backup, 'P@ssw0rd1');
    expect(ok).toBe(true);
    expect(store.state.accounts.length).toBe(2);
    expect(new Set(store.state.accounts.map((a) => a.name))).toEqual(new Set(['支付宝', '微信零钱']));
    expect(memoryStore.list().length).toBe(1);
  });

  it('口令错误时不还原、且不污染现有数据', async () => {
    store.addAccount({ name: '储蓄卡', type: 'debit', balance: 999 });
    const backup = await createBackup('correct-pw');

    const ok = await restoreBackup(backup, 'wrong-pw');
    expect(ok).toBe(false);
    // 原数据完好
    expect(store.state.accounts.length).toBe(1);
    expect(store.state.accounts[0].name).toBe('储蓄卡');
  });

  it('损坏文件安全返回 false', async () => {
    expect(await restoreBackup('not-json', 'any')).toBe(false);
    expect(await restoreBackup(JSON.stringify({ foo: 1 }), 'any')).toBe(false);
  });
});
