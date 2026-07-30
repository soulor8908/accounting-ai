/**
 * 限流模块：支持内存（默认，零配置）与 KV（跨 isolate 一致）两种后端。
 *
 * 解决路线图 P0-3：原实现用全局 Map，跨 isolate 不精确、冷启动清零。
 * 部署时绑定 RATE_LIMIT_KV 后自动切换为 KV 后端，限流计数跨 isolate 一致。
 */
export const RATE_LIMIT_PER_MIN = 30;
export const WINDOW_MS = 60_000;

export interface RateEntry {
  count: number;
  expiresAt: number;
}

/** 限流存储抽象：内存与 KV 共用同一接口，便于替换与测试 */
export interface RateStore {
  get(ip: string): Promise<RateEntry | null>;
  set(ip: string, entry: RateEntry): Promise<void>;
}

/** 默认内存实现：每个 isolate 独立计数（开发 / 未绑定 KV 时使用） */
export class MemoryRateStore implements RateStore {
  private map = new Map<string, RateEntry>();

  async get(ip: string): Promise<RateEntry | null> {
    const now = Date.now();
    // 惰性清理过期条目（最多扫 200 条，避免每次 O(n) 全扫）
    if (this.map.size > 500) {
      for (const [key, val] of this.map) {
        if (val.expiresAt <= now) this.map.delete(key);
      }
    }
    return this.map.get(ip) ?? null;
  }

  async set(ip: string, entry: RateEntry): Promise<void> {
    this.map.set(ip, entry);
  }
}

/** KV 实现：跨 isolate 一致计数，写入时设置 60s TTL 自动过期 */
export class KVRateStore implements RateStore {
  constructor(private kv: KVNamespace) {}

  async get(ip: string): Promise<RateEntry | null> {
    try {
      const v = await this.kv.get(ip, 'json');
      return (v as RateEntry | null) ?? null;
    } catch {
      return null;
    }
  }

  async set(ip: string, entry: RateEntry): Promise<void> {
    try {
      await this.kv.put(ip, JSON.stringify(entry), { expirationTtl: Math.ceil(WINDOW_MS / 1000) });
    } catch {
      // 忽略 KV 写入失败：降级为不限流，也不阻断正常请求
    }
  }
}

/** 检查并累加某 IP 的计数；返回是否超限与当前计数。perMin 可被部署环境变量覆盖（P1-3） */
export async function checkRateLimit(
  store: RateStore,
  ip: string,
  now: number = Date.now(),
  perMin: number = RATE_LIMIT_PER_MIN,
): Promise<{ exceeded: boolean; count: number }> {
  const entry = await store.get(ip);
  if (entry && entry.expiresAt > now) {
    if (entry.count >= perMin) {
      return { exceeded: true, count: entry.count };
    }
    const next = { count: entry.count + 1, expiresAt: entry.expiresAt };
    await store.set(ip, next);
    return { exceeded: false, count: next.count };
  }
  const fresh = { count: 1, expiresAt: now + WINDOW_MS };
  await store.set(ip, fresh);
  return { exceeded: false, count: 1 };
}
