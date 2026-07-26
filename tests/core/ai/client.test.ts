import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatWithAI, testAIConfig, type AIStreamCallback } from '../../../src/core/ai/client';
import type { AIConfig } from '../../../src/core/ai/config';
import { store } from '../../../src/ui/appState';

const CONFIG: AIConfig = {
  providerId: 'deepseek',
  apiKey: 'sk-test',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  proxyUrl: 'https://proxy.example.com',
};

/** 构造 SSE 流响应：把若干 data 行用 \n\n 分隔 */
function sseResponse(lines: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = lines.map((l) => `data: ${l}\n\n`).join('') + 'data: [DONE]\n\n';
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** 构造非流式 JSON 响应（代理降级路径） */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeCallbacks(): AIStreamCallback & { calls: string[]; chunks: string[]; errors: string[] } {
  const calls: string[] = [];
  const chunks: string[] = [];
  const errors: string[] = [];
  return {
    calls,
    chunks,
    errors,
    onThinking: () => calls.push('thinking'),
    onToolExecuting: (n) => calls.push(`tool:${n}`),
    onToolResult: (r) => calls.push(`result:${r.success ? 'ok' : 'fail'}`),
    onMessageStart: () => calls.push('start'),
    onMessageChunk: (_d, full) => chunks.push(full),
    onMessageEnd: () => calls.push('end'),
    onError: (e) => errors.push(e),
  };
}

describe('chatWithAI - 流式纯文本回复', () => {
  beforeEach(() => {
    store.clearAll();
    store.addAccount({ name: '微信零钱', type: 'wallet', balance: 1000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('收到多个 content chunk 时按序追加并最终结束', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: '你好' } }] }),
        JSON.stringify({ choices: [{ delta: { content: '，记账' } }] }),
        JSON.stringify({ choices: [{ delta: { content: '完成' } }] }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const cb = makeCallbacks();
    await chatWithAI('记一笔', [], CONFIG, cb);

    expect(cb.chunks).toEqual(['你好', '你好，记账', '你好，记账完成']);
    expect(cb.calls).toContain('thinking');
    expect(cb.calls).toContain('start');
    expect(cb.calls).toContain('end');
    expect(cb.errors).toHaveLength(0);
    // 请求体应 stream: true
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    // 目标 URL 应拼装 /v1/chat/completions
    expect(fetchMock.mock.calls[0][1].headers['X-Target-URL']).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('空内容时返回占位文本', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([JSON.stringify({ choices: [{ delta: {} }] })])));
    const cb = makeCallbacks();
    await chatWithAI('hi', [], CONFIG, cb);
    expect(cb.chunks).toEqual(['（AI 未返回内容）']);
  });
});

describe('chatWithAI - 工具调用循环', () => {
  beforeEach(() => {
    store.clearAll();
    store.addAccount({ name: '微信零钱', type: 'wallet', balance: 1000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('第一轮返回工具调用 → 执行 → 第二轮返回文本', async () => {
    const fetchMock = vi.fn();
    // 第一次：返回 add_transaction 工具调用（分片）
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'add_', arguments: '' } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'transaction', arguments: '{"type":"ex' } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'pense","amount":25,"description":"午饭"}' } }] } }] }),
      ]),
    );
    // 第二次：返回最终文本
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: '已记' } }] }),
        JSON.stringify({ choices: [{ delta: { content: '支出 ¥25' } }] }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const cb = makeCallbacks();
    await chatWithAI('午饭25', [], CONFIG, cb);

    // 工具执行后账本变化
    expect(store.state.transactions).toHaveLength(1);
    expect(store.state.transactions[0].amount).toBe(25);
    // 回调顺序
    expect(cb.calls).toContain('thinking');
    expect(cb.calls).toContain('tool:add_transaction');
    expect(cb.calls.some((c) => c.startsWith('result:'))).toBe(true);
    expect(cb.chunks).toEqual(['已记', '已记支出 ¥25']);
    // 两次请求
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 第二次请求体应包含 tool 消息
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const roles = secondBody.messages.map((m: { role: string }) => m.role);
    expect(roles).toContain('tool');
  });
});

describe('chatWithAI - 错误处理', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('HTTP 错误时 onError 携带状态信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'Invalid API key' } }, 401)),
    );
    const cb = makeCallbacks();
    await chatWithAI('hi', [], CONFIG, cb);
    expect(cb.errors).toHaveLength(1);
    expect(cb.errors[0]).toContain('Invalid API key');
  });

  it('HTTP 错误且 body 非结构化时回退状态码', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })),
    );
    const cb = makeCallbacks();
    await chatWithAI('hi', [], CONFIG, cb);
    expect(cb.errors[0]).toContain('502');
  });

  it('网络异常时 onError 携带网络错误信息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    const cb = makeCallbacks();
    await chatWithAI('hi', [], CONFIG, cb);
    expect(cb.errors[0]).toContain('网络请求失败');
  });

  it('工具调用超限时 onError 提示简化请求', async () => {
    // 每次都返回工具调用，触发 6 轮上限
    // 注意：必须用 mockImplementation，每次返回新的 Response（ReadableStream 读一次即锁定）
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          sseResponse([
            JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'list_accounts', arguments: '{}' } }] } }] }),
          ]),
        ),
      ),
    );
    const cb = makeCallbacks();
    await chatWithAI('hi', [], CONFIG, cb);
    expect(cb.errors).toHaveLength(1);
    expect(cb.errors[0]).toContain('工具调用轮次超限');
  });
});

describe('chatWithAI - 降级路径（resp.body 为空）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('代理不支持流式时降级 JSON 解析', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: '降级回复' } }] }),
      ),
    );
    const cb = makeCallbacks();
    await chatWithAI('hi', [], CONFIG, cb);
    expect(cb.chunks).toEqual(['降级回复']);
    expect(cb.calls).toContain('end');
  });
});

describe('chatWithAI - proxyUrl 兜底', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('config 无 proxyUrl 时使用 DEFAULT_PROXY', async () => {
    const { DEFAULT_PROXY } = await import('../../../src/core/ai/config');
    const cfg: AIConfig = { ...CONFIG, proxyUrl: undefined };
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })]),
    );
    vi.stubGlobal('fetch', fetchMock);
    await chatWithAI('hi', [], cfg, makeCallbacks());
    expect(fetchMock.mock.calls[0][0]).toBe(DEFAULT_PROXY);
  });
});

describe('testAIConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('缺少 API Key 时直接返回失败', async () => {
    const r = await testAIConfig({ ...CONFIG, apiKey: '' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('API Key');
  });

  it('缺少 model 时返回失败', async () => {
    const r = await testAIConfig({ ...CONFIG, model: '' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('模型');
  });

  it('成功响应返回 ok=true 与内容', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: '成功' } }] })),
    );
    const r = await testAIConfig(CONFIG);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('成功');
  });

  it('HTTP 错误返回 ok=false 与错误信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'Unauthorized' } }, 401)),
    );
    const r = await testAIConfig(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Unauthorized');
  });

  it('空内容返回 ok=false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: '' } }] })),
    );
    const r = await testAIConfig(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('返回为空');
  });

  it('网络异常返回 ok=false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    const r = await testAIConfig(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('网络请求失败');
  });

  it('非流式请求 body stream:false + max_tokens 限制', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    await testAIConfig(CONFIG);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(16);
  });
});
