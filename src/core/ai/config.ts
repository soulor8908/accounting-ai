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
    return JSON.parse(raw) as AIConfig;
  } catch {
    return null;
  }
}

export function saveAIConfig(config: AIConfig): void {
  // 兜底 proxyUrl：旧版保存的配置可能缺该字段，导致回退到 /ai-proxy 在静态部署上 404
  const normalized: AIConfig = {
    ...config,
    proxyUrl: config.proxyUrl || DEFAULT_PROXY,
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
    proxyUrl: 'https://ai-proxy.470033918.workers.dev',
  };
}

/** 默认 Worker 代理 URL */
export const DEFAULT_PROXY = 'https://ai-proxy.470033918.workers.dev';
