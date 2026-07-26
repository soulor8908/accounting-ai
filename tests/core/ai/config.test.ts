import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_PROVIDERS,
  type AIConfig,
  clearAIConfig,
  defaultConfig,
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

  it('saveAIConfig 兜底 proxyUrl：旧配置缺该字段时补全为 DEFAULT_PROXY', async () => {
    const { DEFAULT_PROXY } = await import('../../../src/core/ai/config');
    const cfg: AIConfig = {
      providerId: 'custom',
      apiKey: 'sk-x',
      baseUrl: 'https://example.com',
      model: 'm',
      // 故意不传 proxyUrl
    };
    saveAIConfig(cfg);
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(raw.proxyUrl).toBe(DEFAULT_PROXY);
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

  it('defaultConfig 返回首个预设且带 proxyUrl', async () => {
    const { DEFAULT_PROXY } = await import('../../../src/core/ai/config');
    const cfg = defaultConfig();
    expect(cfg.providerId).toBe(AI_PROVIDERS[0].id);
    expect(cfg.apiKey).toBe('');
    expect(cfg.proxyUrl).toBe(DEFAULT_PROXY);
  });

  it('AI_PROVIDERS 至少包含 deepseek / mimo / custom', () => {
    const ids = AI_PROVIDERS.map((p) => p.id);
    expect(ids).toContain('deepseek');
    expect(ids).toContain('mimo');
    expect(ids).toContain('custom');
  });
});
