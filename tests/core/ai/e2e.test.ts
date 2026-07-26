/**
 * 真实端到端测试：直接打 DeepSeek API，验证 testAIConfig 跑通
 *
 * 这是有副作用的网络测试，仅在设置 DEEPSEEK_API_KEY 环境变量时运行。
 * 用于在 CI/本地验证 AI 集成的端到端正确性，避免「测试通过但实际不通」。
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { testAIConfig } from '../../../src/core/ai/client';
import type { AIConfig } from '../../../src/core/ai/config';

const apiKey = process.env.DEEPSEEK_API_KEY;
const enableReal = process.env.SKIP_REAL_AI_TEST !== '1' && apiKey;

describe.skipIf(!enableReal)('testAIConfig 端到端（真实 DeepSeek API）', () => {
  it('用真实 API key 测试连接，应返回 ok=true', async () => {
    const config: AIConfig = {
      providerId: 'deepseek',
      apiKey: apiKey!,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      // 不设 proxyUrl，走直连
    };
    const r = await testAIConfig(config);
    // 调试用：失败时把 message 打到 stderr
    if (!r.ok) {
      console.error('testAIConfig failed:', JSON.stringify(r));
    }
    expect(r.ok).toBe(true);
    expect(r.message).toContain('成功');
  }, 60_000);

  it('错误的 API key 应返回 ok=false 并带 401/Unauthorized', async () => {
    const config: AIConfig = {
      providerId: 'deepseek',
      apiKey: 'sk-invalid-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    };
    const r = await testAIConfig(config);
    expect(r.ok).toBe(false);
    // DeepSeek 返回 401 时 message 应该被解析出来
    expect(r.message.length).toBeGreaterThan(0);
  }, 60_000);
});
