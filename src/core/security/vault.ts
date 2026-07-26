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
 *
 * 工作流：
 *   setup(pwd, q, a)         → 生成 masterKey + state 用 masterKey 加密 + 3 路包装；返回 recovery
 *   unlock(pwd)              → pwd 解 masterKey → masterKey 解 state
 *   resetByAnswer(a, newPwd) → a 解 masterKey → masterKey 解 state；用 newPwd 重新包装 masterKeyByPwd
 *   resetByRecovery(r, newPwd) → 同上，但用 recovery 解；使用后该副本失效
 *   changePwd(old, new)      → old 解 masterKey；用 new 重新包装 masterKeyByPwd
 *   persist(stateJson)       → 用 masterKey 重新加密 state
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

export async function setupVault(input: SetupInput, currentStateJson: string): Promise<SetupResult> {
  if (isVaultEnabled()) return { ok: false, error: '已经启用过加密了' };
  if (!input.password || input.password.length < 6) return { ok: false, error: '密码至少 6 位' };
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

  const meta: VaultMeta = {
    encryptedState,
    wrappedMasterKeyByPwd,
    wrappedMasterKeyByAnswer,
    wrappedMasterKeyByRecovery,
    securityQuestion: input.securityQuestion.trim(),
    securityAnswerHash,
    recoveryCodeHash,
    createdAt: new Date().toISOString(),
  };

  internal.storage.setItem(VAULT_KEY, JSON.stringify(meta));
  internal.meta = meta;
  internal.masterKeyB64 = masterKeyB64;
  internal.plainStateJson = currentStateJson;
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
  if (!newPassword || newPassword.length < 6) return { ok: false, error: '新密码至少 6 位' };

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
  if (!newPassword || newPassword.length < 6) return { ok: false, error: '新密码至少 6 位' };

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
  if (!newPassword || newPassword.length < 6) return { ok: false, error: '新密码至少 6 位' };
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

export function lock(): void {
  internal.masterKeyB64 = null;
  internal.plainStateJson = null;
}

export async function disableVault(password: string): Promise<{ ok: boolean; error?: string; stateJson?: string }> {
  const meta = loadVaultMeta();
  if (!meta) return { ok: false, error: '尚未启用加密' };
  try {
    const masterKeyB64 = await decryptString(meta.wrappedMasterKeyByPwd, password);
    const plain = await decryptString(meta.encryptedState, masterKeyB64);
    internal.storage.setItem(STATE_KEY, plain);
    internal.storage.removeItem(VAULT_KEY);
    internal.meta = null;
    internal.masterKeyB64 = null;
    internal.plainStateJson = plain;
    return { ok: true, stateJson: plain };
  } catch {
    return { ok: false, error: '密码错误' };
  }
}

export function getSecurityQuestion(): string | null {
  return loadVaultMeta()?.securityQuestion ?? null;
}
