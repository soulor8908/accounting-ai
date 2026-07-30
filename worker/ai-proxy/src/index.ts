/**
 * AI 试用代理 Worker
 *
 * 职责：
 * 1. 持有试用 API Key（存为 Worker Secret `AGNES_API_KEY`），前端不再暴露
 * 2. 代理转发请求到上游 OpenAI 兼容 API（支持 SSE 流式）
 * 3. 按 IP 限流（默认内存固定窗口 30 次/分钟；绑定 RATE_LIMIT_KV 后跨 isolate 一致），防止试用额度被刷
 *
 * 限流方案（见 ratelimit.ts）：
 * - 内存 MemoryRateStore：零配置，部署即用。每个 isolate 独立计数，冷启清零，
 *   适合本地开发 / 未绑定 KV 的场景。
 * - KV KVRateStore：跨 isolate 一致计数，写入带 60s TTL 自动过期。
 *   部署时通过 wrangler.toml 的 [[kv_namespaces]] 绑定 `RATE_LIMIT_KV` 即可启用。
 *
 * 部署：
 *   wrangler deploy
 *   echo "$KEY" | wrangler secret put AGNES_API_KEY
 *   # 可选：创建并绑定限流 KV
 *   # wrangler kv namespace create RATE_LIMIT_KV
 *   # 将输出的 id 填入 wrangler.toml 的 binding
 *
 * 前端通过 VITE_TRIAL_PROXY_URL 环境变量指向此 Worker。
 */

/** 允许转发的前缀白名单，防止被当开放代理用 */
const ALLOWED_TARGET_PREFIXES = [
  'https://apihub.agnes-ai.com',
  'https://api.deepseek.com',
  'https://api.mimo.xiaomi.com',
];

import { checkRateLimit, KVRateStore, MemoryRateStore, RATE_LIMIT_PER_MIN, type RateStore } from './ratelimit';

/** 默认内存限流（未绑定 KV 时使用） */
const memoryRateStore = new MemoryRateStore();

interface Env {
  AGNES_API_KEY: string;
  /** 可选：绑定后限流计数跨 isolate 一致 */
  RATE_LIMIT_KV?: KVNamespace;
  /** 可选：每分钟限流上限（覆盖默认 30），部署时通过 wrangler.toml [vars] 配置 */
  RATE_LIMIT_PER_MIN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // 限流阈值：部署环境变量优先，否则用常量默认（P1-3 部署参数化）
    const perMin = Number(env.RATE_LIMIT_PER_MIN) || RATE_LIMIT_PER_MIN;

    // 限流检查（绑定 KV 则走跨 isolate 一致计数，否则内存计数）
    const clientIP = getClientIP(request);
    const store: RateStore = env.RATE_LIMIT_KV ? new KVRateStore(env.RATE_LIMIT_KV) : memoryRateStore;
    const rateResult = await checkRateLimit(store, clientIP, Date.now(), perMin);
    if (rateResult.exceeded) {
      return json(
        { error: { message: `请求过于频繁，每分钟限 ${perMin} 次，请稍后再试` } },
        429,
        { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Limit': String(perMin) },
      );
    }

    const targetUrl = request.headers.get('X-Target-URL');
    if (!targetUrl) {
      return json({ error: { message: 'Missing X-Target-URL header' } }, 400);
    }

    // 安全：只允许白名单内的上游
    if (!ALLOWED_TARGET_PREFIXES.some((p) => targetUrl.startsWith(p))) {
      return json({ error: { message: 'Target URL not allowed' } }, 403);
    }

    // 前端传来的 API Key（用户自定义 key 走代理时用）；为空则用 Worker Secret（试用模式）
    const clientKey = request.headers.get('X-API-Key')?.trim() ?? '';
    const apiKey = clientKey || env.AGNES_API_KEY;
    if (!apiKey) {
      return json({ error: { message: 'Server misconfigured: missing API key. 请运行 wrangler secret put AGNES_API_KEY' } }, 500);
    }

    // 转发请求体，用最终 apiKey 设置 Authorization
    const body = await request.text();
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    // 流式响应直接透传；非流式也透传 body
    const respHeaders = new Headers();
    // 透传 content-type（决定前端走 SSE 解析还是 JSON 降级）
    const ct = upstream.headers.get('content-type');
    if (ct) respHeaders.set('Content-Type', ct);
    // 限流信息回传，方便前端展示
    respHeaders.set('X-RateLimit-Limit', String(perMin));
    respHeaders.set('X-RateLimit-Remaining', String(Math.max(0, perMin - rateResult.count)));
    respHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  },
} satisfies ExportedHandler<Env>;

// ---------- 工具函数 ----------

function handleCORS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Target-URL, X-API-Key',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
  if (extra) Object.assign(headers, extra);
  return new Response(JSON.stringify(data), { status, headers });
}

function getClientIP(request: Request): string {
  // Cloudflare 提供 CF-Connecting-IP（边缘可信）；XFF 仅作兜底
  return request.headers.get('CF-Connecting-IP')
    ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    ?? 'unknown';
}
