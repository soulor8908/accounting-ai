/** 金额工具：以"分"为精度做运算，避免浮点误差 */

export function round2(n: number): number {
  // 处理 -1.005 → -101 这类边界：先乘 100 再四舍五入
  const scaled = Math.round((n + Number.EPSILON * Math.sign(n) * 100) * 100);
  return scaled / 100;
}

export function addMoney(a: number, b: number): number {
  return round2(a + b);
}

export function subMoney(a: number, b: number): number {
  return round2(a - b);
}

export function mulMoney(a: number, b: number): number {
  return round2(a * b);
}

/** 格式化为展示字符串：1234.5 → "1,234.50" */
export function formatMoney(n: number): string {
  return round2(n).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
