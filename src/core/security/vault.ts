/**
 * Vault：本地加密保险库（单主密钥 + 多路包装版）
 *
 * 数据结构：
 *   - masterKey (32 bytes, 随机生成, 永不明文落盘)
 *   - state 用 masterKey 加密 → encryptedState
 *   - masterKey 用 password 包装 → wrappedMasterKeyByPwd
 *   - masterKey 用 answer 包装 → wrappedMasterKeyByAnswer
 *   - masterKey 用 recovery 包装 → wrappedMasterKeyByRecovery
 *   - answer/recovery 只存哈希（校验用）
 *   - 辅助加密数据（AI 配置 / 聊天 / 记忆）用 masterKey 加密，与 state 同生命周期
 *
 * 工作流：
 *   setup(pwd, q, a, opts)   → 生成 masterKey + state/辅助数据用 masterKey 加密 + 3 路包装；返回 recovery
 *   unlock(pwd)              → pwd 解 masterKey → masterKey 解 state；辅助数据按需 hydrate
 *   resetByAnswer(a, newPwd) → a 解 masterKey → masterKey 解 state；用 newPwd 重新包装 masterKeyByPwd
 *   resetByRecovery(r, newPwd) → 同上，但用 recovery 解；使用后该副本失效
 *   changePwd(old, new)      → old 解 masterKey；用 new 重新包装 masterKeyByPwd
 *   persist(stateJson)       → 用 masterKey 重新加密 state
 *   persistAIConfig(cfg)     → 用 masterKey 加密 AI 配置 JSON
 *   hydrateAIConfig()        → 用 masterKey 解密 AI 配置，填充内存缓存
 *   persistChat/Memory       → 同上模式，加密聊天/记忆数据
 */

import type { StorageAdapter } from '../store/store';
import { decryptString, encryptString, generateRecoveryCode, sha256Hex } from './crypto';

const VAULT_KEY = 'accounting-ai:vault:v1';
const STATE_KEY = 'accounting-ai:state:v1';

type EncryptedBlob = { ciphertext: string; iv: string; salt: string; iterations: number; alg: 'AES-GCM-256' };

export interface VaultMeta {
  /** 用 masterKey 加密的 state（base64 密文） */
  encryptedState: EncryptedBlob;
  /** 用 password 包装的 masterKey */
  wrappedMasterKeyByPwd: EncryptedBlob;
  /** 用 answer 包装的 masterKey */
  wrappedMasterKeyByAnswer: EncryptedBlob;
  /** 用 recovery 包装的 masterKey（用过后置 null） */
  wrappedMasterKeyByRecovery: EncryptedBlob | null;
  securityQuestion: string;
  securityAnswerHash: string;
  recoveryCodeHash: string | null;
  createdAt: string;
  /** 用 masterKey 加密的 AI 配置 JSON（含 apiKey），启用 vault 后由 config.ts 路由写入 */
  encryptedAIConfig?: EncryptedBlob | null;
  /** 用 masterKey 加密的聊天历史 JSON */
  encryptedChatData?: EncryptedBlob | null;
  /** 用 masterKey 加密的 AI 记忆 JSON */
  encryptedMemoryData?: EncryptedBlob | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface VaultInternal {
  storage: StorageLike;
  meta: VaultMeta | null;
  /** 内存中的明文 masterKey（base64），仅 unlock 后存在 */
  masterKeyB64: string | null;
  plainStateJson: string | null;
  /** 内存中解密后的 AI 配置 JSON（解锁后由 hydrateAIConfig 填充） */
  plainAIConfigJson: string | null;
  /** 内存中解密后的聊天数据 JSON（解锁后由 hydrateChatData 填充） */
  plainChatJson: string | null;
  /** 内存中解密后的记忆数据 JSON（解锁后由 hydrateMemoryData 填充） */
  plainMemoryJson: string | null;
}

function createMemoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

const internal: VaultInternal = {
  storage: typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : createMemoryStorage(),
  meta: null,
  masterKeyB64: null,
  plainStateJson: null,
  plainAIConfigJson: null,
  plainChatJson: null,
  plainMemoryJson: null,
};

export function setVaultStorageAdapter(adapter: StorageAdapter): void {
  internal.storage = adapter as unknown as StorageLike;
}

export function isVaultEnabled(): boolean {
  return internal.storage.getItem(VAULT_KEY) !== null;
}

export function loadVaultMeta(): VaultMeta | null {
  if (internal.meta) return internal.meta;
  const raw = internal.storage.getItem(VAULT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VaultMeta;
    if (!parsed.encryptedState || !parsed.wrappedMasterKeyByPwd) return null;
    internal.meta = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function getPlainStateJson(): string | null {
  return internal.plainStateJson;
}

export function isUnlocked(): boolean {
  return internal.plainStateJson !== null && internal.masterKeyB64 !== null;
}

export interface SetupInput {
  password: string;
  securityQuestion: string;
  securityAnswer: string;
}

/** 启用加密时一并迁移到 vault 的辅助明文数据（用 masterKey 加密） */
export interface SetupAuxData {
  /** AI 配置 JSON（含 apiKey），来自 localStorage 旧版明文 */
  aiConfigJson?: string;
  /** 聊天历史 JSON */
  chatJson?: string;
  /** AI 记忆 JSON */
  memoryJson?: string;
}

export interface SetupResult {
  ok: boolean;
  recoveryCode?: string;
  error?: string;
}

function b64FromArray(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function genMasterKeyB64(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return b64FromArray(arr);
}

export async function setupVault(
  input: SetupInput,
  currentStateJson: string,
  aux?: SetupAuxData,
): Promise<SetupResult> {
  if (isVaultEnabled()) return { ok: false, error: '已经启用过加密了' };
  if (!input.password || input.password.length < 8) return { ok: false, error: '密码至少 8 位，需含字母和数字' };
  if (!input.securityQuestion.trim()) return { ok: false, error: '请设置安全问题' };
  if (!input.securityAnswer.trim() || input.securityAnswer.length < 2) {
    return { ok: false, error: '安全问题答案太短' };
  }

  const answer = input.securityAnswer.trim();
  const masterKeyB64 = genMasterKeyB64();

  const encryptedState = await encryptString(currentStateJson, masterKeyB64);
  const wrappedMasterKeyByPwd = await encryptString(masterKeyB64, input.password);
  const wrappedMasterKeyByAnswer = await encryptString(masterKeyB64, answer);

  const recoveryCode = generateRecoveryCode();
  const wrappedMasterKeyByRecovery = await encryptString(masterKeyB64, recoveryCode);

  const securityAnswerHash = await sha256Hex(answer);
  const recoveryCodeHash = await sha256Hex(recoveryCode);

  // 辅助数据用 masterKey 加密，原子写入 vault，避免明文残留
  const encryptedAIConfig = aux?.aiConfigJson ? await encryptString(aux.aiConfigJson, masterKeyB64) : null;
  const encryptedChatData = aux?.chatJson ? await encryptString(aux.chatJson, masterKeyB64) : null;
  const encryptedMemoryData = aux?.memoryJson ? await encryptString(aux.memoryJson, masterKeyB64) : null;

  const meta: VaultMeta = {
    encryptedState,
    wrappedMasterKeyByPwd,
    wrappedMasterKeyByAnswer,
    wrappedMasterKeyByRecovery,
    securityQuestion: input.securityQuestion.trim(),
    securityAnswerHash,
    recoveryCodeHash,
    createdAt: new Date().toISOString(),
    encryptedAIConfig,
    encryptedChatData,
    encryptedMemoryData,
  };

  internal.storage.setItem(VAULT_KEY, JSON.stringify(meta));
  internal.meta = meta;
  internal.masterKeyB64 = masterKeyB64;
  internal.plainStateJson = currentStateJson;
  // 缓存辅助明文，省去首次 hydrate
  internal.plainAIConfigJson = aux?.aiConfigJson ?? null;
  internal.plainChatJson = aux?.chatJson ?? null;
  internal.plainMemoryJson = aux?.memoryJson ?? null;
  internal.storage.removeItem(STATE_KEY);
  return { ok: true, recoveryCode };
}

export async function unlockWithPassword(password: string): Promise<{ ok: boolean; error?: string; stateJson?: string }> {
  const meta = loadVaultMeta();
  if (!meta) return { ok: false, error: '尚未启用加密' };
  try {
    const masterKeyB64 = await decryptString(meta.wrappedMasterKeyByPwd, password);
    const plain = await decryptString(meta.encryptedState, masterKeyB64);
    internal.masterKeyB64 = masterKeyB64;
    internal.plainStateJson = plain;
    return { ok: true, stateJson: plain };
  } catch {
    return { ok: false, error: '密码错误' };
  }
}

export async function resetPasswordBySecurityAnswer(
  answer: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const meta = loadVaultMeta();
  if (!meta) return { ok: false, error: '尚未启用加密' };
  if (!newPassword || newPassword.length < 8) return { ok: false, error: '新密码至少 8 位，需含字母和数字' };

  const answerHash = await sha256Hex(answer.trim());
  if (answerHash !== meta.securityAnswerHash) return { ok: false, error: '安全问题答案不正确' };

  try {
    const masterKeyB64 = await decryptString(meta.wrappedMasterKeyByAnswer, answer.trim());
    meta.wrappedMasterKeyByPwd = await encryptString(masterKeyB64, newPassword);
    internal.storage.setItem(VAULT_KEY, JSON.stringify(meta));
    internal.meta = meta;
    internal.masterKeyB64 = masterKeyB64;
    // 立即解密 state 加载到内存
    internal.plainStateJson = await decryptString(meta.encryptedState, masterKeyB64);
    return { ok: true };
  } catch {
    return { ok: false, error: '重置失败' };
  }
}

export async function resetPasswordByRecoveryCode(
  code: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const meta = loadVaultMeta();
  if (!meta) return { ok: false, error: '尚未启用加密' };
  if (!meta.wrappedMasterKeyByRecovery || !meta.recoveryCodeHash) {
    return { ok: false, error: '恢复码已失效，请用安全问题重置' };
  }
  if (!newPassword || newPassword.length < 8) return { ok: false, error: '新密码至少 8 位，需含字母和数字' };

  const normalized = code.trim().toUpperCase();
  const codeHash = await sha256Hex(normalized);
  if (codeHash !== meta.recoveryCodeHash) return { ok: false, error: '恢复码不正确' };

  try {
    const masterKeyB64 = await decryptString(meta.wrappedMasterKeyByRecovery, normalized);
    meta.wrappedMasterKeyByPwd = await encryptString(masterKeyB64, newPassword);
    // 恢复码使用后失效
    meta.wrappedMasterKeyByRecovery = null;
    meta.recoveryCodeHash = null;
    internal.storage.setItem(VAULT_KEY, JSON.stringify(meta));
    internal.meta = meta;
    internal.masterKeyB64 = masterKeyB64;
    internal.plainStateJson = await decryptString(meta.encryptedState, masterKeyB64);
    return { ok: true };
  } catch {
    return { ok: false, error: '重置失败' };
  }
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const meta = loadVaultMeta();
  if (!meta) return { ok: false, error: '尚未启用加密' };
  if (!newPassword || newPassword.length < 8) return { ok: false, error: '新密码至少 8 位，需含字母和数字' };
  try {
    const masterKeyB64 = await decryptString(meta.wrappedMasterKeyByPwd, oldPassword);
    meta.wrappedMasterKeyByPwd = await encryptString(masterKeyB64, newPassword);
    internal.storage.setItem(VAULT_KEY, JSON.stringify(meta));
    internal.meta = meta;
    internal.masterKeyB64 = masterKeyB64;
    return { ok: true };
  } catch {
    return { ok: false, error: '原密码错误' };
  }
}

export async function persistEncryptedState(stateJson: string): Promise<void> {
  const meta = loadVaultMeta();
  if (!meta) throw new Error('vault not enabled');
  if (!internal.masterKeyB64) throw new Error('vault not unlocked');
  meta.encryptedState = await encryptString(stateJson, internal.masterKeyB64);
  internal.storage.setItem(VAULT_KEY, JSON.stringify(meta));
  internal.meta = meta;
  internal.plainStateJson = stateJson;
}

// ---------- 辅助数据加密（AI 配置 / 聊天 / 记忆） ----------
// 设计：所有辅助数据都用 masterKey 加密，与 state 同生命周期。
// 解锁后由调用方按需 hydrate 到内存缓存；锁定时缓存一并清空，杜绝明文残留。

async function persistAuxField(
  field: 'encryptedAIConfig' | 'encryptedChatData' | 'encryptedMemoryData',
  json: string,
  cacheSlot: 'plainAIConfigJson' | 'plainChatJson' | 'plainMemoryJson',
): Promise<void> {
  const meta = loadVaultMeta();
  if (!meta) throw new Error('vault not enabled');
  if (!internal.masterKeyB64) throw new Error('vault not unlocked');
  meta[field] = await encryptString(json, internal.masterKeyB64);
  internal.storage.setItem(VAULT_KEY, JSON.stringify(meta));
  internal.meta = meta;
  internal[cacheSlot] = json;
}

async function hydrateAuxField(
  field: 'encryptedAIConfig' | 'encryptedChatData' | 'encryptedMemoryData',
  cacheSlot: 'plainAIConfigJson' | 'plainChatJson' | 'plainMemoryJson',
): Promise<string | null> {
  if (internal[cacheSlot] !== null) return internal[cacheSlot];
  const meta = loadVaultMeta();
  if (!meta || !meta[field] || !internal.masterKeyB64) return null;
  try {
    const plain = await decryptString(meta[field], internal.masterKeyB64);
    internal[cacheSlot] = plain;
    return plain;
  } catch {
    return null;
  }
}

async function clearAuxField(
  field: 'encryptedAIConfig' | 'encryptedChatData' | 'encryptedMemoryData',
  cacheSlot: 'plainAIConfigJson' | 'plainChatJson' | 'plainMemoryJson',
): Promise<void> {
  const meta = loadVaultMeta();
  if (meta) {
    meta[field] = null;
    if (internal.masterKeyB64) {
      internal.storage.setItem(VAULT_KEY, JSON.stringify(meta));
      internal.meta = meta;
    }
  }
  internal[cacheSlot] = null;
}

// ---- AI 配置 ----
export function getCachedAIConfigJson(): string | null {
  return internal.plainAIConfigJson;
}
export async function persistAIConfigJson(json: string): Promise<void> {
  await persistAuxField('encryptedAIConfig', json, 'plainAIConfigJson');
}
export async function hydrateAIConfigJson(): Promise<string | null> {
  return hydrateAuxField('encryptedAIConfig', 'plainAIConfigJson');
}
export async function clearAIConfigFromVault(): Promise<void> {
  await clearAuxField('encryptedAIConfig', 'plainAIConfigJson');
}

// ---- 聊天历史 ----
export function getCachedChatJson(): string | null {
  return internal.plainChatJson;
}
export async function persistChatJson(json: string): Promise<void> {
  await persistAuxField('encryptedChatData', json, 'plainChatJson');
}
export async function hydrateChatJson(): Promise<string | null> {
  return hydrateAuxField('encryptedChatData', 'plainChatJson');
}

// ---- AI 记忆 ----
export function getCachedMemoryJson(): string | null {
  return internal.plainMemoryJson;
}
export async function persistMemoryJson(json: string): Promise<void> {
  await persistAuxField('encryptedMemoryData', json, 'plainMemoryJson');
}
export async function hydrateMemoryJson(): Promise<string | null> {
  return hydrateAuxField('encryptedMemoryData', 'plainMemoryJson');
}

export function lock(): void {
  internal.masterKeyB64 = null;
  internal.plainStateJson = null;
  // 锁定时清空所有辅助明文缓存，防止离开解锁态后内存里仍残留敏感数据
  internal.plainAIConfigJson = null;
  internal.plainChatJson = null;
  internal.plainMemoryJson = null;
}

/** 关闭加密：返回所有解密后的明文 JSON，由调用方写回 localStorage */
export interface DisableVaultResult {
  ok: boolean;
  error?: string;
  stateJson?: string;
  /** 解密后的 AI 配置 JSON（若 vault 中存有） */
  aiConfigJson?: string | null;
  /** 解密后的聊天历史 JSON（若 vault 中存有） */
  chatJson?: string | null;
  /** 解密后的 AI 记忆 JSON（若 vault 中存有） */
  memoryJson?: string | null;
}

export async function disableVault(password: string): Promise<DisableVaultResult> {
  const meta = loadVaultMeta();
  if (!meta) return { ok: false, error: '尚未启用加密' };
  try {
    const masterKeyB64 = await decryptString(meta.wrappedMasterKeyByPwd, password);
    const plain = await decryptString(meta.encryptedState, masterKeyB64);
    // 解密辅助数据（若有），交给调用方写回 localStorage
    let aiConfigJson: string | null = null;
    let chatJson: string | null = null;
    let memoryJson: string | null = null;
    if (meta.encryptedAIConfig) {
      try { aiConfigJson = await decryptString(meta.encryptedAIConfig, masterKeyB64); } catch { /* 损坏则丢弃 */ }
    }
    if (meta.encryptedChatData) {
      try { chatJson = await decryptString(meta.encryptedChatData, masterKeyB64); } catch { /* 损坏则丢弃 */ }
    }
    if (meta.encryptedMemoryData) {
      try { memoryJson = await decryptString(meta.encryptedMemoryData, masterKeyB64); } catch { /* 损坏则丢弃 */ }
    }
    internal.storage.setItem(STATE_KEY, plain);
    internal.storage.removeItem(VAULT_KEY);
    internal.meta = null;
    internal.masterKeyB64 = null;
    internal.plainStateJson = plain;
    internal.plainAIConfigJson = null;
    internal.plainChatJson = null;
    internal.plainMemoryJson = null;
    return { ok: true, stateJson: plain, aiConfigJson, chatJson, memoryJson };
  } catch {
    return { ok: false, error: '密码错误' };
  }
}

export function getSecurityQuestion(): string | null {
  return loadVaultMeta()?.securityQuestion ?? null;
}

/** @internal 测试专用：重置 vault 内部单例状态 */
export function _resetForTesting(): void {
  internal.meta = null;
  internal.masterKeyB64 = null;
  internal.plainStateJson = null;
  internal.plainAIConfigJson = null;
  internal.plainChatJson = null;
  internal.plainMemoryJson = null;
}
