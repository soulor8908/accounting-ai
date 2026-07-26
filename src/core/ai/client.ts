/**
 * AI 客户端：OpenAI 兼容 API + Function Calling 循环（SSE 流式输出）
 *
 * 设计要点（卡帕西视角）：
 * - 流式优先：用 ReadableStream + TextDecoder 增量解析 SSE，首字延迟低
 * - 工具调用累积：tool_calls 在流式下分片到达，按 index 聚合 name/arguments
 * - 超时与错误显式化：AbortController 防止 worker 不可达时静默挂起
 * - 状态机收敛：onThinking → onToolExecuting → onToolResult → onMessageStart → onMessageChunk → onMessageEnd
 */
import type { AIConfig } from './config';
import { AI_TOOLS, executeTool, type ToolCall, type ToolResult } from './tools';
import { store } from '../../ui/appState';
import { formatMoney } from '../engine/engine';
import type { Account } from '../types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

const MAX_TOOL_ROUNDS = 6;
/** 单次请求超时（ms）：worker 不可达或模型卡顿时强制中断 */
const REQUEST_TIMEOUT_MS = 60_000;

/** 构建系统提示词 */
function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  const accounts = store.state.accounts.length > 0
    ? store.state.accounts.map((a: Account) => `  - ${a.name}（${a.type}）余额 ¥${formatMoney(a.balance)}`).join('\n')
    : '  （暂无账户）';
  const totalAssets = formatMoney(store.getTotalAssets());
  const totalLiabilities = formatMoney(store.getTotalLiabilities());

  return `你是一个智能记账助手。用户可以通过自然语言让你帮他记账、查询、编辑和删除数据。

当前日期：${today}
总资产：¥${totalAssets}
总负债：¥${totalLiabilities}

账户列表：
${accounts}

你可以调用工具来完成用户的请求。如果用户的话不够明确，可以先用 list_transactions 或 query_balance 查看当前数据后再操作。
重要：执行 delete_transaction 删除流水时，必须先用 descriptionKeyword 或 id 查清楚，删除前在回复中向用户确认。
回复请简洁，用中文。金额用 ¥ 符号。`;
}

export interface AIStreamCallback {
  onThinking?: () => void;
  /** 推理模型（如 deepseek-v4-flash）的思考过程增量；可选展示给用户 */
  onReasoning?: (delta: string, full: string) => void;
  onToolExecuting?: (name: string) => void;
  onToolResult?: (result: ToolResult) => void;
  /** 最终文本开始输出（替换 thinking/tool 气泡，建立新 AI 气泡） */
  onMessageStart?: () => void;
  /** 流式增量：delta 是本次片段，full 是累计文本 */
  onMessageChunk?: (delta: string, full: string) => void;
  /** 最终文本输出结束 */
  onMessageEnd?: () => void;
  onError?: (error: string) => void;
}

interface StreamResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  /** 流式过程中是否已经触发 onMessageStart/Chunk/End（避免上层重复交付） */
  delivered: boolean;
}

/** 发送消息给 AI，自动处理 function calling 循环（流式） */
export async function chatWithAI(
  userMessage: string,
  history: ChatMessage[],
  config: AIConfig,
  callbacks: AIStreamCallback = {},
): Promise<void> {
  try {
    callbacks.onThinking?.();

    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...history,
      { role: 'user', content: userMessage },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await callAIStream(config, messages, callbacks);

      // 有工具调用：执行后继续下一轮（流式过程中如有 commentary 已交付，不重复）
      if (result.toolCalls.length > 0) {
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: result.content || '',
          tool_calls: result.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments || '{}' },
          })),
        };
        messages.push(assistantMsg);

        for (const tc of result.toolCalls) {
          callbacks.onToolExecuting?.(tc.name);
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.arguments || '{}');
          } catch {
            parsedArgs = {};
          }
          const call: ToolCall = { name: tc.name, arguments: parsedArgs };
          const toolResult = executeTool(call);
          callbacks.onToolResult?.(toolResult);
          messages.push({
            role: 'tool',
            content: toolResult.result,
            tool_call_id: tc.id,
          });
        }
        callbacks.onThinking?.();
        continue;
      }

      // 无工具调用：最终回复。若流式已交付则不再重复，否则补交付（JSON 降级或空流）
      if (!result.delivered) {
        const text = result.content || '（AI 未返回内容）';
        callbacks.onMessageStart?.();
        callbacks.onMessageChunk?.(text, text);
        callbacks.onMessageEnd?.();
      }
      return;
    }

    callbacks.onError?.('工具调用轮次超限，请简化请求');
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    callbacks.onError?.(msg);
  }
}

/** 构造请求参数：直连或代理。DeepSeek 原生支持 CORS，默认直连即可 */
function buildFetchParams(config: AIConfig, body: unknown, signal: AbortSignal): { url: string; init: RequestInit } {
  const targetUrl = `${config.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const proxyUrl = config.proxyUrl?.trim();
  const bodyStr = JSON.stringify(body);

  if (proxyUrl) {
    // 走 Worker 代理：自定义 header 转发目标 URL 与 API Key
    return {
      url: proxyUrl,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Target-URL': targetUrl,
          'X-API-Key': config.apiKey,
        },
        body: bodyStr,
        signal,
      },
    };
  }
  // 直连：标准 OpenAI 兼容请求头
  return {
    url: targetUrl,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: bodyStr,
      signal,
    },
  };
}

/** 调用 AI API（直连或通过 Worker 代理），流式解析 SSE */
async function callAIStream(
  config: AIConfig,
  messages: ChatMessage[],
  callbacks: AIStreamCallback,
): Promise<StreamResult> {
  const body = {
    model: config.model,
    messages,
    tools: AI_TOOLS,
    temperature: 0.7,
    stream: true,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let resp: Response;
  try {
    const { url, init } = buildFetchParams(config, body, controller.signal);
    resp = await fetch(url, init);
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`请求超时（${REQUEST_TIMEOUT_MS / 1000}s），请检查网络或代理`);
    }
    throw new Error(`网络请求失败：${e instanceof Error ? e.message : '未知'}`);
  }
  clearTimeout(timeout);

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    let errMsg = `API 请求失败 (HTTP ${resp.status})`;
    try {
      const errJson = JSON.parse(errText);
      errMsg = errJson.error?.message || errJson.message || errMsg;
      // 结构化错误也带上状态码，方便排查
      if (!errMsg.includes(String(resp.status))) errMsg = `${errMsg} (HTTP ${resp.status})`;
    } catch {
      if (errText) errMsg = `${errText.slice(0, 200)} (HTTP ${resp.status})`;
    }
    throw new Error(errMsg);
  }

  // 代理可能不支持流式（content-type 非 event-stream 或 body 为空），降级为 JSON 一次性解析
  const contentType = resp.headers.get('content-type') || '';
  const isEventStream = contentType.includes('event-stream');
  if (!resp.body || !isEventStream) {
    const data = await resp.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('AI 返回数据格式异常');
    const content: string = msg.content ?? '';
    // 推理模型：reasoning_content 单独走 onReasoning（一次性交付）
    const reasoning: string | undefined = msg.reasoning_content;
    if (reasoning) callbacks.onReasoning?.(reasoning, reasoning);
    const toolCalls: StreamResult['toolCalls'] = (msg.tool_calls ?? []).map(
      (tc: { id: string; function: { name: string; arguments: string } }) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments ?? '{}',
      }),
    );
    // JSON 降级路径未触发流式回调，delivered=false 让上层补交付
    return { content, toolCalls, delivered: false };
  }

  return parseSSEStream(resp.body, callbacks);
}

/** 解析 SSE 流：data: {...}\n\n，以 [DONE] 结束。支持推理模型的 reasoning_content 字段 */
async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  callbacks: AIStreamCallback,
): Promise<StreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let contentBuf = '';
  let reasoningBuf = '';
  let messageStarted = false;
  const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

  const flushToolCall = (idx: number, entry: { id: string; name: string; arguments: string }) => {
    if (!toolCallMap.has(idx)) toolCallMap.set(idx, { id: '', name: '', arguments: '' });
    const existing = toolCallMap.get(idx)!;
    if (entry.id) existing.id = entry.id;
    if (entry.name) existing.name += entry.name;
    if (entry.arguments) existing.arguments += entry.arguments;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let json: { choices?: Array<{ delta?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }> };
      try {
        json = JSON.parse(data);
      } catch {
        continue; // 忽略半包
      }
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;

      // 推理模型：思考过程增量（不进入主气泡）
      if (delta.reasoning_content) {
        reasoningBuf += delta.reasoning_content;
        callbacks.onReasoning?.(delta.reasoning_content, reasoningBuf);
      }
      if (delta.content) {
        if (!messageStarted) {
          messageStarted = true;
          callbacks.onMessageStart?.();
        }
        contentBuf += delta.content;
        callbacks.onMessageChunk?.(delta.content, contentBuf);
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          flushToolCall(idx, {
            id: tc.id ?? '',
            name: tc.function?.name ?? '',
            arguments: tc.function?.arguments ?? '',
          });
        }
      }
    }
  }

  if (messageStarted) callbacks.onMessageEnd?.();

  const toolCalls = [...toolCallMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v)
    .filter((v) => v.name);

  // messageStarted=true 表示流式过程中已经触发 onMessageStart/Chunk/End，
  // 上层（chatWithAI）不应再补交付，避免重复输出
  return { content: contentBuf, toolCalls, delivered: messageStarted };
}

/** 测试 AI 配置是否可用（轻量请求，非流式） */
export async function testAIConfig(
  config: AIConfig,
): Promise<{ ok: boolean; message: string }> {
  if (!config.apiKey.trim()) {
    return { ok: false, message: '请先填写 API Key' };
  }
  if (!config.model.trim()) {
    return { ok: false, message: '请先填写模型名称' };
  }

  const body = {
    model: config.model,
    messages: [{ role: 'user', content: '回复两个字：成功' }],
    stream: false,
    // 推理模型（如 deepseek-v4-flash）会先输出 reasoning_content 占用 token，
    // max_tokens 太小会导致正式 content 被截断，测试误判为失败
    max_tokens: 512,
    temperature: 0,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const { url, init } = buildFetchParams(config, body, controller.signal);
    const resp = await fetch(url, init);

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      let msg = `HTTP ${resp.status}`;
      try {
        const j = JSON.parse(txt);
        msg = j.error?.message || j.message || msg;
      } catch {
        if (txt) msg = txt.slice(0, 200);
      }
      return { ok: false, message: msg };
    }

    const data = await resp.json();
    const msgObj = data.choices?.[0]?.message;
    const content: string | undefined = msgObj?.content;
    const reasoning: string | undefined = msgObj?.reasoning_content;
    const finishReason: string | undefined = data.choices?.[0]?.finish_reason;
    if (!content) {
      // 推理模型可能因 length 截断
      if (finishReason === 'length' && reasoning) {
        return { ok: false, message: `推理 token 不足，请增大 max_tokens（当前已思考 ${reasoning.length} 字）` };
      }
      return { ok: false, message: 'AI 返回 content 为空，请检查模型名称或 Base URL' };
    }
    return { ok: true, message: `连接成功，模型回复：${content.slice(0, 60)}` };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, message: '请求超时（30s），请检查网络或代理地址' };
    }
    const msg = e instanceof Error ? e.message : '未知错误';
    return { ok: false, message: `网络请求失败：${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}
