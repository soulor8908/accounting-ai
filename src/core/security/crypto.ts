/**
 * Web Crypto 加密工具
 * - PBKDF2 派生密钥（600000 轮 SHA-256，对齐 OWASP 2023 推荐）
 * - AES-GCM 256 对称加解密
 * - 安全问题答案独立哈希存储（用于重置密码）
 *
 * 设计说明：
 *   纯前端记账应用无法真正发短信/邮件验证码。
 *   此处用「安全问题 + 恢复码」替代手机号/邮箱重置流程：
 *   - 安全问题答案与密码一样经过 PBKDF2 派生，能解开主密钥包装
 *   - 恢复码作为应急后门（一次性使用，使用后失效）
 *
 * 迭代轮次升级说明：
 *   旧版本为 80_000，新版本对齐 OWASP 600_000。
 *   EncryptedBlob.iterations 字段会保留旧值，decryptString 据此恢复；
 *   新写入的 blob 一律使用 600_000，老数据在下次 changePwd / setupVault 时自然升级。
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_LEN = 16; // bytes
const IV_LEN = 12; // AES-GCM 推荐 96-bit IV
const KEY_LEN = 32; // 256-bit

export interface EncryptedBlob {
  /** base64 编码的密文 + GCM tag */
  ciphertext: string;
  /** base64 编码的初始化向量 */
  iv: string;
  /** base64 编码的 PBKDF2 salt */
  salt: string;
  /** PBKDF2 轮次，便于未来升级 */
  iterations: number;
  /** 加密算法标识 */
  alg: 'AES-GCM-256';
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function randomBytes(len: number): Uint8Array {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}

/** 用密码派生 AES-GCM CryptoKey */
async function deriveKey(password: string, salt: Uint8Array, iterations: number = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: KEY_LEN * 8 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 加密任意字符串 */
export async function encryptString(plaintext: string, password: string): Promise<EncryptedBlob> {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(plaintext) as BufferSource);
  return {
    ciphertext: bufToB64(ct),
    iv: bufToB64(iv),
    salt: bufToB64(salt),
    iterations: PBKDF2_ITERATIONS,
    alg: 'AES-GCM-256',
  };
}

/** 解密；密码错误会抛错 */
export async function decryptString(blob: EncryptedBlob, password: string): Promise<string> {
  const salt = b64ToBuf(blob.salt);
  const iv = b64ToBuf(blob.iv);
  const ct = b64ToBuf(blob.ciphertext);
  const key = await deriveKey(password, salt, blob.iterations || PBKDF2_ITERATIONS);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
    return dec.decode(pt);
  } catch {
    throw new Error('密码错误或数据已损坏');
  }
}

/** 简单 SHA-256 hex 哈希（用于恢复码指纹、安全问题答案指纹） */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/** 生成 12 位恢复码（大写字母+数字，去除易混字符） */
export function generateRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  // 分组显示 XXXX-XXXX-XXXX
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

/**
 * 校验密码强度：≥8 位，含字母+数字
 * - 8 位长度对齐 NIST SP 800-63B 最低建议（结合 PBKDF2 600k 轮可抵御离线爆破）
 * - 字母+数字组合防止纯数字/纯字母弱口令
 * - 不强制大小写混合，避免用户体验恶化（攻击面靠 PBKDF2 轮次兜底）
 */
export function isStrongPassword(pwd: string): boolean {
  if (pwd.length < 8) return false;
  const hasLetter = /[a-zA-Z]/.test(pwd);
  const hasDigit = /\d/.test(pwd);
  return hasLetter && hasDigit;
}
