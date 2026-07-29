/**
 * AI 试用代理 Worker
 *
 * 职责：
 * 1. 持有试用 API Key（存为 Worker Secret `AGNES_API_KEY`），前端不再暴露
 * 2. 代理转发请求到上游 OpenAI 兼容 API（支持 SSE 流式）
 * 3. 按 IP 限流（KV 固定窗口：30 次/分钟），防止试用额度被刷
 *
 * 部署：
 *   wrangler deploy
 *   wrangler secret put AGNES_API_KEY   # 输入上游 API Key
 *
 * 前端通过 VITE_TRIAL_PROXY_URL 环境变量指向此 Worker。
 */

/** 限流：每 IP 每分钟最大请求数 */
const RATE_LIMIT_PER_MIN = 30;
/** KV TTL（秒）：略大于窗口，确保旧桶过期后被回收 */
const RATE_TTL_SEC = 120;

/** 允许转发的前缀白名单，防止被当开放代理用 */
const ALLOWED_TARGET_PREFIXES = [
  'https://apihub.agnes-ai.com',
  'https://api.deepseek.com',
  'https://api.mimo.xiaomi.com',
];

interface Env {
  AGNES_API_KEY: string;
  RATE_LIMITS: KVNamespace;
}

/** Cloudflare Workers 提供的 Headers 类型在运行时是全局可用的 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // 限流检查
    const clientIP = getClientIP(request);
    const rateResult = await checkRateLimit(env, clientIP);
    if (rateResult.exceeded) {
      return json(
        { error: { message: `请求过于频繁，每分钟限 ${RATE_LIMIT_PER_MIN} 次，请稍后再试` } },
        429,
        { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Limit': String(RATE_LIMIT_PER_MIN) },
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
      return json({ error: { message: 'Server misconfigured: missing API key' } }, 500);
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
    respHeaders.set('X-RateLimit-Limit', String(RATE_LIMIT_PER_MIN));
    respHeaders.set('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_PER_MIN - rateResult.count)));
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
  // Cloudflare 提供 CF-Connecting-IP
  return request.headers.get('CF-Connecting-IP')
    ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    ?? 'unknown';
}

/**
 * KV 固定窗口限流
 * - key: `rl:{ip}:{yyyymmddHHMM}`
 * - value: 累计请求数
 * - TTL: 120s，确保旧桶过期后被自动回收
 *
 * 注意：KV 是最终一致的，极端情况下可能略超限，但足以防止试用额度被批量刷。
 */
async function checkRateLimit(env: Env, ip: string): Promise<{ exceeded: boolean; count: number }> {
  if (!env.RATE_LIMITS) {
    // KV 未绑定时不限流（开发环境）
    return { exceeded: false, count: 0 };
  }
  const now = new Date();
  const bucket =
    `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(now.getUTCDate()).padStart(2, '0')}` +
    `${String(now.getUTCHours()).padStart(2, '0')}` +
    `${String(now.getUTCMinutes()).padStart(2, '0')}`;
  const key = `rl:${ip}:${bucket}`;

  const raw = await env.RATE_LIMITS.get(key);
  const count = raw ? parseInt(raw, 10) : 0;

  if (count >= RATE_LIMIT_PER_MIN) {
    return { exceeded: true, count };
  }

  const next = count + 1;
  await env.RATE_LIMITS.put(key, String(next), { expirationTtl: RATE_TTL_SEC });
  return { exceeded: false, count: next };
}
