/**
 * AI Provider 配置：支持 DeepSeek、MiMo 及自定义 OpenAI 兼容 API
 */

export interface AIProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
}

export const AI_PROVIDERS: AIProviderPreset[] = [
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

export interface AIConfig {
  providerId: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 可选：通过 Worker 代理解决 CORS（默认走直连） */
  proxyUrl?: string;
}

const STORAGE_KEY = 'ai-ledger-ai-config';

export function loadAIConfig(): AIConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as AIConfig;
    // 迁移：旧版本会把 proxyUrl 强制设为已失效的 worker URL，
    // 这里检测到就清掉，让新版默认直连 DeepSeek（原生支持 CORS）
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

/** 已知失效的代理 URL：旧版默认 worker 已下线 */
function isKnownDeadProxy(url: string): boolean {
  return url.includes('ai-proxy.470033918.workers.dev');
}

export function saveAIConfig(config: AIConfig): void {
  // DeepSeek 原生支持 CORS，默认直连即可；仅当用户显式配置 proxyUrl 时才走代理
  const normalized: AIConfig = {
    ...config,
    proxyUrl: config.proxyUrl?.trim() || undefined,
    baseUrl: config.baseUrl.replace(/\/$/, ''),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function clearAIConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function defaultConfig(): AIConfig {
  const preset = AI_PROVIDERS[0];
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
