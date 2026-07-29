import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type SetupAuxData,
  _resetForTesting,
  changePassword,
  clearAIConfigFromVault,
  disableVault,
  getCachedAIConfigJson,
  getCachedChatJson,
  getCachedMemoryJson,
  getPlainStateJson,
  getSecurityQuestion,
  hydrateAIConfigJson,
  hydrateChatJson,
  hydrateMemoryJson,
  isUnlocked,
  isVaultEnabled,
  lock,
  persistAIConfigJson,
  persistChatJson,
  persistEncryptedState,
  persistMemoryJson,
  resetPasswordByRecoveryCode,
  resetPasswordBySecurityAnswer,
  setupVault,
  unlockWithPassword,
} from '../../../src/core/security/vault';

const PWD = 'Test1234';
const QUESTION = '你的小学叫什么名字？';
const ANSWER = '阳光小学';
const STATE_JSON = JSON.stringify({
  accounts: [{ id: 'a1', name: '微信零钱', type: 'wallet', balance: 1000 }],
  transactions: [],
});

const AUX: SetupAuxData = {
  aiConfigJson: JSON.stringify({ providerId: 'deepseek', apiKey: 'sk-secret', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' }),
  chatJson: JSON.stringify([{ id: 's1', title: '聊天1', messages: [] }]),
  memoryJson: JSON.stringify([{ id: 'm1', content: '喜欢吃面', category: 'habit' }]),
};

function reset() {
  localStorage.clear();
  _resetForTesting();
}

describe('vault - setupVault', () => {
  beforeEach(reset);
  afterEach(reset);

  it('成功创建加密保险库，返回恢复码', async () => {
    const result = await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
    );
    expect(result.ok).toBe(true);
    expect(result.recoveryCode).toBeTruthy();
    expect(result.recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('创建后 vault 已启用且已解锁', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    expect(isVaultEnabled()).toBe(true);
    expect(isUnlocked()).toBe(true);
  });

  it('创建后 state 可从内存读取', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    expect(getPlainStateJson()).toBe(STATE_JSON);
  });

  it('创建后明文 state 从 localStorage 移除', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    expect(localStorage.getItem('accounting-ai:state:v1')).toBeNull();
  });

  it('密码不足 8 位时拒绝创建', async () => {
    const result = await setupVault(
      { password: 'short', securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('8 位');
  });

  it('安全问题答案太短时拒绝创建', async () => {
    const result = await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: 'a' },
      STATE_JSON,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('太短');
  });

  it('重复创建返回错误', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    const result = await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('已经启用');
  });

  it('带辅助数据创建：AI 配置/聊天/记忆被加密', async () => {
    const result = await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
      AUX,
    );
    expect(result.ok).toBe(true);
    // 辅助数据在内存缓存中可读
    expect(getCachedAIConfigJson()).toBe(AUX.aiConfigJson);
    expect(getCachedChatJson()).toBe(AUX.chatJson);
    expect(getCachedMemoryJson()).toBe(AUX.memoryJson);
    // vault 原始 JSON 不含明文辅助数据
    const raw = localStorage.getItem('accounting-ai:vault:v1')!;
    expect(raw).not.toContain('sk-secret');
    expect(raw).not.toContain('喜欢吃面');
  });
});

describe('vault - unlockWithPassword', () => {
  beforeEach(reset);
  afterEach(reset);

  it('正确密码解锁成功', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    lock();
    expect(isUnlocked()).toBe(false);

    const result = await unlockWithPassword(PWD);
    expect(result.ok).toBe(true);
    expect(result.stateJson).toBe(STATE_JSON);
    expect(isUnlocked()).toBe(true);
  });

  it('错误密码解锁失败', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    lock();

    const result = await unlockWithPassword('WrongPass1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('密码错误');
    expect(isUnlocked()).toBe(false);
  });

  it('未启用 vault 时解锁失败', async () => {
    const result = await unlockWithPassword(PWD);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('尚未启用');
  });

  it('解锁后辅助数据可 hydrate', async () => {
    await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
      AUX,
    );
    lock();

    await unlockWithPassword(PWD);
    // hydrate 后辅助数据可读
    expect(await hydrateAIConfigJson()).toBe(AUX.aiConfigJson);
    expect(await hydrateChatJson()).toBe(AUX.chatJson);
    expect(await hydrateMemoryJson()).toBe(AUX.memoryJson);
  });
});

describe('vault - lock / isUnlocked', () => {
  beforeEach(reset);
  afterEach(reset);

  it('lock 后清空所有内存明文', async () => {
    await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
      AUX,
    );
    expect(isUnlocked()).toBe(true);

    lock();
    expect(isUnlocked()).toBe(false);
    expect(getPlainStateJson()).toBeNull();
    expect(getCachedAIConfigJson()).toBeNull();
    expect(getCachedChatJson()).toBeNull();
    expect(getCachedMemoryJson()).toBeNull();
  });

  it('lock 后 vault 仍启用，可重新解锁', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    lock();
    expect(isVaultEnabled()).toBe(true);

    const result = await unlockWithPassword(PWD);
    expect(result.ok).toBe(true);
  });
});

describe('vault - persistEncryptedState', () => {
  beforeEach(reset);
  afterEach(reset);

  it('解锁后可持久化新 state', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    const newState = JSON.stringify({ accounts: [], transactions: [] });
    await persistEncryptedState(newState);
    expect(getPlainStateJson()).toBe(newState);
  });

  it('未解锁时持久化抛错', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    lock();
    await expect(persistEncryptedState('{}')).rejects.toThrow('not unlocked');
  });

  it('持久化后重新解锁能读到新 state', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    const newState = JSON.stringify({ version: 2, accounts: [{ id: 'x', name: 'New', type: 'cash', balance: 0 }] });
    await persistEncryptedState(newState);
    lock();

    const result = await unlockWithPassword(PWD);
    expect(result.stateJson).toBe(newState);
  });
});

describe('vault - 辅助数据加密（AI 配置/聊天/记忆）', () => {
  beforeEach(reset);
  afterEach(reset);

  it('persistAIConfigJson 加密后内存缓存可读', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    const json = '{"apiKey":"sk-new"}';
    await persistAIConfigJson(json);
    expect(getCachedAIConfigJson()).toBe(json);
  });

  it('persistChatJson / persistMemoryJson 同理', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    await persistChatJson('[{"id":"c1"}]');
    await persistMemoryJson('[{"id":"m1"}]');
    expect(getCachedChatJson()).toBe('[{"id":"c1"}]');
    expect(getCachedMemoryJson()).toBe('[{"id":"m1"}]');
  });

  it('锁后缓存清空，解锁后 hydrate 恢复', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    await persistAIConfigJson('{"key":"val"}');
    lock();

    await unlockWithPassword(PWD);
    // 缓存已清空，需要 hydrate
    expect(getCachedAIConfigJson()).toBeNull();
    const hydrated = await hydrateAIConfigJson();
    expect(hydrated).toBe('{"key":"val"}');
    // hydrate 后缓存填充
    expect(getCachedAIConfigJson()).toBe('{"key":"val"}');
  });

  it('clearAIConfigFromVault 清除辅助数据', async () => {
    await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
      { aiConfigJson: '{"old":"config"}' },
    );
    await clearAIConfigFromVault();
    expect(getCachedAIConfigJson()).toBeNull();
    // 锁后重新解锁，hydrate 返回 null
    lock();
    await unlockWithPassword(PWD);
    expect(await hydrateAIConfigJson()).toBeNull();
  });

  it('辅助数据密文不含明文 apiKey', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    await persistAIConfigJson('{"apiKey":"sk-leak-test-12345"}');
    const raw = localStorage.getItem('accounting-ai:vault:v1')!;
    expect(raw).not.toContain('sk-leak-test-12345');
  });
});

describe('vault - resetPasswordBySecurityAnswer', () => {
  beforeEach(reset);
  afterEach(reset);

  it('正确答案 + 新密码 → 重置成功', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    lock();

    const result = await resetPasswordBySecurityAnswer(ANSWER, 'NewPass123');
    expect(result.ok).toBe(true);
    expect(isUnlocked()).toBe(true);

    // 新密码可解锁
    lock();
    const unlockResult = await unlockWithPassword('NewPass123');
    expect(unlockResult.ok).toBe(true);
  });

  it('错误答案 → 重置失败', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    lock();

    const result = await resetPasswordBySecurityAnswer('错误答案', 'NewPass123');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('不正确');
  });

  it('重置后旧密码无法解锁', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    await resetPasswordBySecurityAnswer(ANSWER, 'NewPass123');
    lock();

    const result = await unlockWithPassword(PWD);
    expect(result.ok).toBe(false);
  });

  it('重置后 state 数据不丢失', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    lock();
    await resetPasswordBySecurityAnswer(ANSWER, 'NewPass123');
    expect(getPlainStateJson()).toBe(STATE_JSON);
  });

  it('getSecurityQuestion 返回安全问题', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    expect(getSecurityQuestion()).toBe(QUESTION);
  });
});

describe('vault - resetPasswordByRecoveryCode', () => {
  beforeEach(reset);
  afterEach(reset);

  it('正确恢复码 + 新密码 → 重置成功', async () => {
    const setup = await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
    );
    const recoveryCode = setup.recoveryCode!;
    lock();

    const result = await resetPasswordByRecoveryCode(recoveryCode, 'NewPass123');
    expect(result.ok).toBe(true);

    // 新密码可解锁
    lock();
    expect((await unlockWithPassword('NewPass123')).ok).toBe(true);
  });

  it('恢复码使用后失效（一次性）', async () => {
    const setup = await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
    );
    const recoveryCode = setup.recoveryCode!;
    lock();

    await resetPasswordByRecoveryCode(recoveryCode, 'NewPass123');
    lock();

    // 再次使用恢复码应失败
    const result = await resetPasswordByRecoveryCode(recoveryCode, 'AnotherPass123');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('已失效');
  });

  it('错误恢复码 → 重置失败', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    lock();

    const result = await resetPasswordByRecoveryCode('XXXX-XXXX-XXXX', 'NewPass123');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('不正确');
  });

  it('恢复码大小写不敏感', async () => {
    const setup = await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
    );
    const recoveryCode = setup.recoveryCode!;
    lock();

    // 转小写后仍可用（内部会 toUpperCase）
    const result = await resetPasswordByRecoveryCode(recoveryCode.toLowerCase(), 'NewPass123');
    expect(result.ok).toBe(true);
  });
});

describe('vault - changePassword', () => {
  beforeEach(reset);
  afterEach(reset);

  it('正确旧密码 → 修改成功', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    const result = await changePassword(PWD, 'BrandNew123');
    expect(result.ok).toBe(true);

    lock();
    expect((await unlockWithPassword('BrandNew123')).ok).toBe(true);
    expect((await unlockWithPassword(PWD)).ok).toBe(false);
  });

  it('错误旧密码 → 修改失败', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    const result = await changePassword('WrongOld1', 'BrandNew123');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('原密码错误');
  });

  it('修改密码后 state 数据不丢失', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    await changePassword(PWD, 'BrandNew123');
    expect(getPlainStateJson()).toBe(STATE_JSON);
  });

  it('修改密码后辅助数据仍可 hydrate', async () => {
    await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
      AUX,
    );
    await changePassword(PWD, 'BrandNew123');
    lock();
    await unlockWithPassword('BrandNew123');
    expect(await hydrateAIConfigJson()).toBe(AUX.aiConfigJson);
    expect(await hydrateChatJson()).toBe(AUX.chatJson);
    expect(await hydrateMemoryJson()).toBe(AUX.memoryJson);
  });
});

describe('vault - disableVault', () => {
  beforeEach(reset);
  afterEach(reset);

  it('正确密码 → 关闭加密，返回明文数据', async () => {
    await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
      AUX,
    );
    const result = await disableVault(PWD);
    expect(result.ok).toBe(true);
    expect(result.stateJson).toBe(STATE_JSON);
    expect(result.aiConfigJson).toBe(AUX.aiConfigJson);
    expect(result.chatJson).toBe(AUX.chatJson);
    expect(result.memoryJson).toBe(AUX.memoryJson);
  });

  it('关闭后 vault 不再启用', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    await disableVault(PWD);
    expect(isVaultEnabled()).toBe(false);
  });

  it('关闭后 state 写回 localStorage', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    await disableVault(PWD);
    expect(localStorage.getItem('accounting-ai:state:v1')).toBe(STATE_JSON);
  });

  it('错误密码 → 关闭失败', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    const result = await disableVault('WrongPass1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('密码错误');
    expect(isVaultEnabled()).toBe(true);
  });
});

describe('vault - 加密迁移场景', () => {
  beforeEach(reset);
  afterEach(reset);

  it('模拟 localStorage 明文 → vault 加密迁移', async () => {
    // 1. 用户在 localStorage 有明文数据
    localStorage.setItem('accounting-ai:state:v1', STATE_JSON);
    localStorage.setItem('ai-ledger-ai-config', AUX.aiConfigJson!);

    // 2. 启用 vault，迁移所有数据
    const result = await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
      AUX,
    );
    expect(result.ok).toBe(true);

    // 3. 明文 state 从 localStorage 移除
    expect(localStorage.getItem('accounting-ai:state:v1')).toBeNull();

    // 4. 锁定后重新解锁，数据完整
    lock();
    await unlockWithPassword(PWD);
    expect(getPlainStateJson()).toBe(STATE_JSON);
    expect(await hydrateAIConfigJson()).toBe(AUX.aiConfigJson);
  });

  it('迁移后 vault 中不含任何明文敏感数据', async () => {
    await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
      AUX,
    );
    const raw = localStorage.getItem('accounting-ai:vault:v1')!;
    const parsed = JSON.parse(raw);

    // 密码不应明文出现
    expect(raw).not.toContain(PWD);
    expect(raw).not.toContain(ANSWER);

    // API Key 不应明文出现
    expect(raw).not.toContain('sk-secret');

    // state 数据不应明文出现
    expect(raw).not.toContain('微信零钱');

    // 各字段都是加密 blob 结构
    expect(parsed.encryptedState.alg).toBe('AES-GCM-256');
    expect(parsed.wrappedMasterKeyByPwd.alg).toBe('AES-GCM-256');
    expect(parsed.encryptedAIConfig.alg).toBe('AES-GCM-256');
  });

  it('disableVault 后可重新 setupVault（关闭→重启循环）', async () => {
    await setupVault({ password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER }, STATE_JSON);
    const disableResult = await disableVault(PWD);
    expect(disableResult.ok).toBe(true);

    // 重新创建
    const result = await setupVault(
      { password: 'NewPass1234', securityQuestion: '新问题？', securityAnswer: '新答案' },
      disableResult.stateJson!,
    );
    expect(result.ok).toBe(true);
    expect(isVaultEnabled()).toBe(true);

    // 新密码可解锁
    lock();
    expect((await unlockWithPassword('NewPass1234')).ok).toBe(true);
  });

  it('辅助数据为空时 setup 仍成功', async () => {
    const result = await setupVault(
      { password: PWD, securityQuestion: QUESTION, securityAnswer: ANSWER },
      STATE_JSON,
      // 不传 aux
    );
    expect(result.ok).toBe(true);
    expect(getCachedAIConfigJson()).toBeNull();
    expect(getCachedChatJson()).toBeNull();
    expect(getCachedMemoryJson()).toBeNull();
  });
});
