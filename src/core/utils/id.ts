let counter = 0;

/** 测试专用：重置计数器保证可重复 */
export function resetIdCounter(): void {
  counter = 0;
}

/** 生成带前缀的唯一 ID，如 tx_lx3k9_1 */
export function createId(prefix: string): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 7);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}_${counter}`;
}
