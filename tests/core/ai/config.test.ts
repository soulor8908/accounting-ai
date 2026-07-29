import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_PROVIDERS,
  BUILTIN_AI_CONFIG,
  type AIConfig,
  clearAIConfig,
  defaultConfig,
  getEffectiveConfig,
  isUsingBuiltinConfig,
  loadAIConfig,
  saveAIConfig,
} from '../../../src/core/ai/config';

const KEY = 'ai-ledger-ai-config';

describe('AI config', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('loadAIConfig 在未配置时返回 null', () => {
    expect(loadAIConfig()).toBeNull();
  });

  it('saveAIConfig 持久化后可被 loadAIConfig 读回', () => {
    const cfg: AIConfig = {
      providerId: 'deepseek',
      apiKey: 'sk-test-123',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    };
    saveAIConfig(cfg);
    const loaded = loadAIConfig();
    expect(loaded).not.toBeNull();
    expect(loaded!.apiKey).toBe('sk-test-123');
    expect(loaded!.model).toBe('deepseek-v4-flash');
  });

  it('saveAIConfig 默认不走代理：旧配置缺 proxyUrl 时不补全', () => {
    const cfg: AIConfig = {
      providerId: 'custom',
      apiKey: 'sk-x',
      baseUrl: 'https://example.com',
      model: 'm',
      // 故意不传 proxyUrl
    };
    saveAIConfig(cfg);
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    // DeepSeek 原生支持 CORS，默认直连，proxyUrl 不再兜底
    expect(raw.proxyUrl).toBeUndefined();
  });

  it('saveAIConfig 规整 baseUrl 末尾斜杠', () => {
    saveAIConfig({
      providerId: 'custom',
      apiKey: 'k',
      baseUrl: 'https://example.com/',
      model: 'm',
    });
    expect(loadAIConfig()!.baseUrl).toBe('https://example.com');
  });

  it('clearAIConfig 清除存储', () => {
    saveAIConfig({ providerId: 'deepseek', apiKey: 'k', baseUrl: 'b', model: 'm' });
    expect(loadAIConfig()).not.toBeNull();
    clearAIConfig();
    expect(loadAIConfig()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('loadAIConfig 容错损坏 JSON 返回 null', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadAIConfig()).toBeNull();
  });

  it('defaultConfig 返回首个预设，默认直连无 proxyUrl', () => {
    const cfg = defaultConfig();
    expect(cfg.providerId).toBe(AI_PROVIDERS[0].id);
    expect(cfg.apiKey).toBe('');
    expect(cfg.proxyUrl).toBeUndefined();
  });

  it('AI_PROVIDERS 至少包含 deepseek / mimo / custom', () => {
    const ids = AI_PROVIDERS.map((p) => p.id);
    expect(ids).toContain('deepseek');
    expect(ids).toContain('mimo');
    expect(ids).toContain('custom');
  });

  it('loadAIConfig 自动迁移：清除已失效的旧 worker 代理 URL', () => {
    // 模拟旧版本保存的配置：proxyUrl 指向已下线的 worker
    localStorage.setItem(
      KEY,
      JSON.stringify({
        providerId: 'deepseek',
        apiKey: 'sk-test',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        proxyUrl: 'https://ai-proxy.470033918.workers.dev',
      }),
    );
    const cfg = loadAIConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.proxyUrl).toBeUndefined();
    // localStorage 里也应该是被清理后的版本
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(raw.proxyUrl).toBeUndefined();
  });

  it('loadAIConfig 保留用户自定义的有效代理 URL', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        providerId: 'custom',
        apiKey: 'sk-test',
        baseUrl: 'https://example.com',
        model: 'm',
        proxyUrl: 'https://my-own-proxy.example.com',
      }),
    );
    const cfg = loadAIConfig();
    expect(cfg!.proxyUrl).toBe('https://my-own-proxy.example.com');
  });
});

describe('内置试用配置 (BUILTIN_AI_CONFIG)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('BUILTIN_AI_CONFIG 包含 agnes 配置且不含明文 apiKey', () => {
    expect(BUILTIN_AI_CONFIG.providerId).toBe('agnes');
    // P0 安全修复：apiKey 不再硬编码在前端
    expect(BUILTIN_AI_CONFIG.apiKey).toBe('');
    expect(BUILTIN_AI_CONFIG.baseUrl).toBe('https://apihub.agnes-ai.com');
    expect(BUILTIN_AI_CONFIG.model).toBe('agnes-2.0-flash');
  });

  it('AI_PROVIDERS 首个预设为 agnes（默认试用）', () => {
    expect(AI_PROVIDERS[0].id).toBe('agnes');
  });

  it('isUsingBuiltinConfig 在未配置时返回 true', () => {
    expect(isUsingBuiltinConfig()).toBe(true);
  });

  it('isUsingBuiltinConfig 在用户配置了 apiKey 后返回 false', () => {
    saveAIConfig({
      providerId: 'deepseek',
      apiKey: 'sk-user-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    });
    expect(isUsingBuiltinConfig()).toBe(false);
  });

  it('isUsingBuiltinConfig 在 apiKey 为空字符串时返回 true', () => {
    saveAIConfig({
      providerId: 'deepseek',
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    });
    expect(isUsingBuiltinConfig()).toBe(true);
  });
});

describe('getEffectiveConfig', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('未配置时返回内置试用配置（apiKey 为空，走 Worker 代理）', () => {
    const cfg = getEffectiveConfig();
    expect(cfg.providerId).toBe('agnes');
    expect(cfg.apiKey).toBe('');
    expect(cfg.model).toBe('agnes-2.0-flash');
  });

  it('用户配置了 apiKey 后返回用户配置', () => {
    const userCfg: AIConfig = {
      providerId: 'deepseek',
      apiKey: 'sk-user-custom',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
    };
    saveAIConfig(userCfg);

    const cfg = getEffectiveConfig();
    expect(cfg.apiKey).toBe('sk-user-custom');
    expect(cfg.model).toBe('deepseek-v4-pro');
    expect(cfg.providerId).toBe('deepseek');
  });

  it('用户配置了空 apiKey 且无 proxyUrl 时回退到内置试用配置', () => {
    saveAIConfig({
      providerId: 'deepseek',
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    });

    const cfg = getEffectiveConfig();
    expect(cfg.providerId).toBe('agnes');
    expect(cfg.apiKey).toBe('');
  });

  it('用户配置了 proxyUrl 但 apiKey 为空时使用用户配置（自定义代理）', () => {
    saveAIConfig({
      providerId: 'custom',
      apiKey: '',
      baseUrl: 'https://example.com',
      model: 'm',
      proxyUrl: 'https://my-proxy.example.com',
    });

    const cfg = getEffectiveConfig();
    expect(cfg.providerId).toBe('custom');
    expect(cfg.proxyUrl).toBe('https://my-proxy.example.com');
  });

  it('baseUrl 不含 /v1 后缀（client.ts 会拼接 /v1/chat/completions）', () => {
    const cfg = getEffectiveConfig();
    expect(cfg.baseUrl).not.toMatch(/\/v1\/?$/);
  });
});
