/**
 * AI 客户端：OpenAI 兼容 API + Function Calling 循环
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
回复请简洁，用中文。金额用 ¥ 符号。`;
}

export interface AIStreamCallback {
  onThinking?: () => void;
  onToolExecuting?: (name: string) => void;
  onToolResult?: (result: ToolResult) => void;
  onMessage?: (text: string) => void;
  onError?: (error: string) => void;
}

/** 发送消息给 AI，自动处理 function calling 循环 */
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
      const response = await callAI(config, messages);
      if (!response.ok) {
        const errText = await response.text();
        let errMsg = `API 请求失败 (${response.status})`;
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error?.message || errJson.message || errMsg;
        } catch {
          if (errText) errMsg = errText.slice(0, 200);
        }
        callbacks.onError?.(errMsg);
        return;
      }

      const data = await response.json();
      const assistantMsg = data.choices?.[0]?.message;
      if (!assistantMsg) {
        callbacks.onError?.('AI 返回数据格式异常');
        return;
      }

      messages.push(assistantMsg);

      // 如果没有工具调用，返回最终文本
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        if (assistantMsg.content) {
          callbacks.onMessage?.(assistantMsg.content);
        } else {
          callbacks.onMessage?.('（AI 未返回内容）');
        }
        return;
      }

      // 执行所有工具调用
      for (const tc of assistantMsg.tool_calls) {
        const toolName = tc.function.name;
        callbacks.onToolExecuting?.(toolName);

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          parsedArgs = {};
        }

        const call: ToolCall = { name: toolName, arguments: parsedArgs };
        const result = executeTool(call);
        callbacks.onToolResult?.(result);

        messages.push({
          role: 'tool',
          content: result.result,
          tool_call_id: tc.id,
        });
      }
      // 继续下一轮，让 AI 处理工具结果
      callbacks.onThinking?.();
    }

    callbacks.onError?.('工具调用轮次超限，请简化请求');
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    callbacks.onError?.(msg);
  }
}

/** 调用 AI API（通过 Worker 代理或直连） */
async function callAI(config: AIConfig, messages: ChatMessage[]): Promise<Response> {
  const body = {
    model: config.model,
    messages,
    tools: AI_TOOLS,
    temperature: 0.7,
    stream: false,
  };

  // 通过 Worker 代理（解决 CORS）
  const proxyUrl = config.proxyUrl || '/ai-proxy';
  const targetUrl = `${config.baseUrl}/v1/chat/completions`;

  const resp = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Target-URL': targetUrl,
      'X-API-Key': config.apiKey,
    },
    body: JSON.stringify(body),
  });

  return resp;
}
