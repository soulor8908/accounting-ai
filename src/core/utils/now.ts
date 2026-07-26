/**
 * 单调递增时间戳工具
 *
 * 设计动机（卡帕西视角）：
 * `new Date().toISOString()` 在同一毫秒内多次调用会返回相同值，导致
 * createdAt/updatedAt 无法区分先后顺序。在记忆更新、会话排序等场景下，
 * 这会造成"刚更新但 updatedAt 看起来没变"的错误信号。
 *
 * 方案：进程级维护一个 lastMs，若新值不大于旧值则递增 1ms，
 * 保证同一进程内时间戳严格单调递增。开销极低（一次比较 + 赋值）。
 */

let lastMs = 0;

/** 重置单调时钟（测试专用） */
export function resetMonotonicClock(): void {
  lastMs = 0;
}

/** 单调递增的毫秒时间戳 */
export function monotonicNowMs(): number {
  const t = Date.now();
  if (t <= lastMs) {
    lastMs += 1;
    return lastMs;
  }
  lastMs = t;
  return t;
}

/** 单调递增的 ISO 时间字符串 */
export function monotonicNowIso(): string {
  return new Date(monotonicNowMs()).toISOString();
}
