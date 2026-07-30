import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDailyTrialLimit } from '../../../src/core/ai/trialQuota';
import { getRuntimeConfig, loadRuntimeConfig } from '../../../src/core/config/runtime';

describe('P1-3 部署参数化：运行时配置', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('默认每日试用额度为 30', () => {
    expect(getDailyTrialLimit()).toBe(30);
  });

  it('loadRuntimeConfig 合并 /app.config.json 覆盖默认值', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ defaultModel: 'x-model', dailyTrialLimit: 50 }), { status: 200 })),
    );
    const cfg = await loadRuntimeConfig();
    expect(cfg.dailyTrialLimit).toBe(50);
    expect(getDailyTrialLimit()).toBe(50);
    expect(getRuntimeConfig().defaultModel).toBe('x-model');
  });

  it('app.config.json 缺失时降级为构建期注入值（首次加载隔离）', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const mod = await import('../../../src/core/config/runtime');
    const cfg = await mod.loadRuntimeConfig();
    // 无覆盖：dailyTrialLimit 为 undefined（走默认 30）
    expect(cfg.dailyTrialLimit ?? 30).toBe(30);
  });
});
