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

  it('perMin 参数可覆盖默认上限（P1-3 部署参数化）', async () => {
    const store = new MemoryRateStore();
    const now = 2_000_000;
    const res1 = await checkRateLimit(store, '5.5.5.5', now, 2);
    const res2 = await checkRateLimit(store, '5.5.5.5', now, 2);
    expect(res2.count).toBe(2);
    const res3 = await checkRateLimit(store, '5.5.5.5', now, 2);
    expect(res3.exceeded).toBe(true);
    expect(res3.count).toBe(2);
    expect(res1.exceeded).toBe(false);
  });
});
