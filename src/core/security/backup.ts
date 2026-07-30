/**
 * 全量加密备份：将账本 state + 聊天 + 记忆 + AI 配置打包，
 * 用用户口令（PBKDF2 600k + AES-GCM-256，复用 crypto.ts）加密成一个可移植文件。
 *
 * 设计要点（卡帕西视角）：
 * - 复用 crypto.ts 的 encryptString / decryptString，不重复造轮子
 * - 备份文件自包含、可跨设备恢复（只需口令，无需原保险库）
 * - 还原失败（口令错 / 文件损坏 / 形状非法）安全返回 false，绝不污染现有数据
 *
 * 解决路线图 P0-1：纯 localStorage 一清缓存即丢数据，提供可下载的加密备份出口。
 */
import { decryptString, encryptString, type EncryptedBlob } from './crypto';
import { loadAIConfig, saveAIConfig, type AIConfig } from '../ai/config';
import { chatStore, memoryStore, store } from '../../ui/appState';

const FORMAT = 'accounting-ai-backup';
const VERSION = 1;

interface BackupEnvelope {
  format: typeof FORMAT;
  v: number;
  blob: EncryptedBlob;
}

interface BackupBundle {
  appState: string;
  chats: string;
  memories: string;
  aiConfig: AIConfig | null;
}

/** 创建加密备份，返回可下载的 JSON 字符串 */
export async function createBackup(passphrase: string): Promise<string> {
  const bundle: BackupBundle = {
    appState: store.serialize(),
    chats: chatStore.serialize(),
    memories: memoryStore.serialize(),
    aiConfig: loadAIConfig(),
  };
  const blob = await encryptString(JSON.stringify(bundle), passphrase);
  const envelope: BackupEnvelope = { format: FORMAT, v: VERSION, blob };
  return JSON.stringify(envelope);
}

/** 还原加密备份；口令错误或文件损坏返回 false（不修改现有数据）。成功返回 true */
export async function restoreBackup(json: string, passphrase: string): Promise<boolean> {
  let envelope: BackupEnvelope;
  try {
    envelope = JSON.parse(json) as BackupEnvelope;
  } catch {
    return false;
  }
  if (envelope?.format !== FORMAT || !envelope.blob) return false;

  let plaintext: string;
  try {
    plaintext = await decryptString(envelope.blob, passphrase);
  } catch {
    return false;
  }

  let bundle: BackupBundle;
  try {
    bundle = JSON.parse(plaintext) as BackupBundle;
  } catch {
    return false;
  }
  if (typeof bundle.appState !== 'string') return false;

  // 账本 state 形状校验（loadFromJson 内部用 isValidStateShape 校验），
  // 形状非法安全返回 false，避免坏数据覆盖现有账本
  const okLoad = store.loadFromJson(bundle.appState);
  if (!okLoad) return false;
  store.save();
  if (typeof bundle.chats === 'string') {
    chatStore.loadFromJson(bundle.chats);
    chatStore.save();
  }
  if (typeof bundle.memories === 'string') {
    memoryStore.loadFromJson(bundle.memories);
    memoryStore.save();
  }
  if (bundle.aiConfig && typeof bundle.aiConfig === 'object') {
    try {
      await saveAIConfig(bundle.aiConfig);
    } catch {
      // AI 配置还原失败不影响账本/聊天/记忆
    }
  }
  return true;
}
