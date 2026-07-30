import { describe, it, expect } from 'vitest';
import { MemoryRateStore, checkRateLimit, RATE_LIMIT_PER_MIN, WINDOW_MS } from '../../worker/ai-proxy/src/ratelimit';

describe('限流 checkRateLimit（P0-3）', () => {
  it('窗口内累计并在达到上限时拦截', async () => {
    const store = new MemoryRateStore();
    const now = 1_000_000;
    let res = await checkRateLimit(store, '1.2.3.4', now);
    expect(res.exceeded).toBe(false);
    expect(res.count).toBe(1);
    for (let i = 2; i <= RATE_LIMIT_PER_MIN; i++) {
      res = await checkRateLimit(store, '1.2.3.4', now);
      expect(res.exceeded).toBe(false);
      expect(res.count).toBe(i);
    }
    res = await checkRateLimit(store, '1.2.3.4', now);
    expect(res.exceeded).toBe(true);
    expect(res.count).toBe(RATE_LIMIT_PER_MIN);
  });

  it('窗口过期后自动重置', async () => {
    const store = new MemoryRateStore();
    await checkRateLimit(store, '9.9.9.9', 1000);
    const after = await checkRateLimit(store, '9.9.9.9', 1000 + WINDOW_MS + 1);
    expect(after.exceeded).toBe(false);
    expect(after.count).toBe(1);
  });

  it('不同 IP 互不干扰', async () => {
    const store = new MemoryRateStore();
    await checkRateLimit(store, 'a', 1000);
    await checkRateLimit(store, 'a', 1000);
    const b = await checkRateLimit(store, 'b', 1000);
    expect(b.count).toBe(1);
  });
});
