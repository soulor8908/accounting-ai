/**
 * AI Provider 配置：支持 DeepSeek、MiMo 及自定义 OpenAI 兼容 API
 *
 * 安全设计（P0 修复）：
 * - 试用 Key 不再硬编码在前端，改为通过 Cloudflare Worker 代理 + 限流。
 *   Worker 持有 Key（Secret），前端只持有 Worker URL（构建时注入 VITE_TRIAL_PROXY_URL）。
 * - 启用 vault 后，含 apiKey 的配置 JSON 由 vault 用 masterKey 加密落盘，
 *   不再以明文存于 localStorage；解锁后通过 hydrateAIConfigJson 填充内存缓存。
 * - 未启用 vault 时仍走 localStorage（兼容旧版），但在 SettingsView 显式提示风险。
 * - 浏览器直连第三方 API 时 Authorization 头会从浏览器发出，
 *   主要防御靠 _headers 中的严格 CSP 缩小 XSS 攻击面。
 */

import {
  clearAIConfigFromVault,
  getCachedAIConfigJson,
  hydrateAIConfigJson,
  isUnlocked,
  isVaultEnabled,
  persistAIConfigJson,
} from '../security/vault';
import { getRuntimeConfig } from '../config/runtime';

export interface AIProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
}

export const AI_PROVIDERS: AIProviderPreset[] = [
  {
    id: 'agnes',
    label: 'Agnes (内置试用)',
    baseUrl: 'https://apihub.agnes-ai.com',
    defaultModel: 'agnes-2.0-flash',
    models: ['agnes-2.0-flash', 'agnes-2.0-pro'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'mimo',
    label: 'MiMo (小米)',
    baseUrl: 'https://api.mimo.xiaomi.com/v1',
    defaultModel: 'mimo-7b-rl',
    models: ['mimo-7b-rl', 'mimo-7b-base'],
  },
  {
    id: 'custom',
    label: '自定义',
    baseUrl: '',
    defaultModel: '',
    models: [],
  },
];

/**
 * 内置试用 AI 配置：未绑定自定义 key 时默认使用。
 *
 * 安全说明（P0 修复）：
 * - API Key 不再硬编码在前端，而是存于 Cloudflare Worker Secret。
 * - 前端通过 proxyUrl 指向 Worker（构建时注入 VITE_TRIAL_PROXY_URL，或部署期 /app.config.json 覆盖）。
 * - Worker 负责：注入 Key、按 IP 限流、转发到上游 API。
 * - 若 Worker URL 未配置，试用不可用，用户需自行绑定 Key。
 *
 * 切换默认模型/代理：改 VITE_DEFAULT_MODEL / VITE_TRIAL_PROXY_URL，或部署期 /app.config.json，
 * 无需重新构建。
 */
export function getBuiltinConfig(): AIConfig {
  const rt = getRuntimeConfig();
  return {
    providerId: 'agnes',
    apiKey: '',
    baseUrl: 'https://apihub.agnes-ai.com',
    model: rt.defaultModel || 'agnes-2.0-flash',
    proxyUrl: rt.trialProxyUrl || undefined,
  };
}

/**
 * 获取生效的 AI 配置：
 * - 优先用户自定义配置（有 apiKey 或有 proxyUrl）
 * - 否则回退内置试用配置（通过 Worker 代理，无需用户 key）
 */
export function getEffectiveConfig(): AIConfig {
  const user = loadAIConfig();
  if (user && (user.apiKey.trim() || user.proxyUrl)) return user;
  return getBuiltinConfig();
}

/** 判断当前是否使用内置试用配置（非用户自定义） */
export function isUsingBuiltinConfig(): boolean {
  const user = loadAIConfig();
  return !user || (!user.apiKey.trim() && !user.proxyUrl);
}

/** 试用代理是否可用（Worker URL 已配置） */
export function isTrialAvailable(): boolean {
  return !!getRuntimeConfig().trialProxyUrl;
}

export interface AIConfig {
  providerId: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 可选：通过 Worker 代理解决 CORS（默认走直连） */
  proxyUrl?: string;
}

/** localStorage key（仅未启用 vault 时使用） */
export const STORAGE_KEY = 'ai-ledger-ai-config';

/** 已知失效的代理 URL：旧版默认 worker 已下线 */
function isKnownDeadProxy(url: string): boolean {
  return url.includes('ai-proxy.470033918.workers.dev');
}

/** 规整配置：去 baseUrl 末尾斜杠、清空白代理 URL */
function normalize(config: AIConfig): AIConfig {
  return {
    ...config,
    proxyUrl: config.proxyUrl?.trim() || undefined,
    baseUrl: config.baseUrl.replace(/\/$/, ''),
  };
}

/** 从缓存或 vault 读取已解密的 AIConfig 对象；失败返回 null */
function parseCachedJson(json: string | null): AIConfig | null {
  if (!json) return null;
  try {
    const cfg = JSON.parse(json) as AIConfig;
    if (!cfg || typeof cfg !== 'object') return null;
    return cfg;
  } catch {
    return null;
  }
}

/**
 * 读取 AI 配置：
 * - vault 已启用：仅返回内存缓存（解锁后由 hydrateAIConfigJson 填充）；锁定时返回 null
 * - vault 未启用：从 localStorage 读取（兼容旧版明文）
 *
 * 保持同步签名：缓存未就绪时返回 null，调用方应等待 unlock 完成后再读取。
 */
export function loadAIConfig(): AIConfig | null {
  if (isVaultEnabled()) {
    const cached = getCachedAIConfigJson();
    const cfg = parseCachedJson(cached);
    if (cfg && cfg.proxyUrl && isKnownDeadProxy(cfg.proxyUrl)) {
      // 已知死代理：内存里清掉，但不在此处异步写回（避免同步副作用）
      return { ...cfg, proxyUrl: undefined };
    }
    return cfg;
  }
  // legacy localStorage 路径
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as AIConfig;
    if (cfg.proxyUrl && isKnownDeadProxy(cfg.proxyUrl)) {
      cfg.proxyUrl = undefined;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      } catch {
        // 忽略写入失败
      }
    }
    return cfg;
  } catch {
    return null;
  }
}

/**
 * 保存 AI 配置：
 * - vault 已启用且解锁：用 masterKey 加密后写入 vault，并清除可能的旧版明文 localStorage
 * - vault 已启用但未解锁：抛错（调用方应避免在锁定态保存）
 * - vault 未启用：写入 localStorage（明文，旧版行为）
 */
export async function saveAIConfig(config: AIConfig): Promise<void> {
  const normalized = normalize(config);
  if (isVaultEnabled()) {
    if (!isUnlocked()) {
      throw new Error('保险库已锁定，请先解锁后再保存 AI 配置');
    }
    await persistAIConfigJson(JSON.stringify(normalized));
    // 迁移：清除可能的旧版明文 localStorage 配置
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

/** 解锁后由 LockView 调用：从 vault 解密并填充内存缓存 */
export async function hydrateAIConfig(): Promise<AIConfig | null> {
  if (!isVaultEnabled() || !isUnlocked()) return null;
  const json = await hydrateAIConfigJson();
  return parseCachedJson(json);
}

/** 清除 AI 配置：vault 与 localStorage 都清 */
export async function clearAIConfig(): Promise<void> {
  if (isVaultEnabled() && isUnlocked()) {
    await clearAIConfigFromVault();
  }
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function defaultConfig(): AIConfig {
  // 默认推荐 DeepSeek：国内访问稳定、CORS 友好、性价比高
  const preset = AI_PROVIDERS.find((p) => p.id === 'deepseek') ?? AI_PROVIDERS[0];
  return {
    providerId: preset.id,
    apiKey: '',
    baseUrl: preset.baseUrl,
    model: preset.defaultModel,
    // 不设 proxyUrl，默认直连 DeepSeek 官方 API（支持 CORS）
  };
}

/** 默认 Worker 代理 URL（已废弃，保留兼容旧配置） */
export const DEFAULT_PROXY = '';
