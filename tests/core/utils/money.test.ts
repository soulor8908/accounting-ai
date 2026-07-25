import { describe, expect, it } from 'vitest';
import { addMoney, round2, subMoney } from '../../../src/core/utils/money';
import { createId, resetIdCounter } from '../../../src/core/utils/id';

describe('round2', () => {
  it('四舍五入到分', () => {
    expect(round2(35.555)).toBe(35.56);
    expect(round2(35.554)).toBe(35.55);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('处理负数', () => {
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(-35.554)).toBe(-35.55);
  });

  it('整数原样返回', () => {
    expect(round2(3000)).toBe(3000);
  });
});

describe('addMoney / subMoney', () => {
  it('加法避免浮点误差', () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(addMoney(833.25, 833.25)).toBe(1666.5);
  });

  it('减法避免浮点误差', () => {
    expect(subMoney(100, 35.5)).toBe(64.5);
    expect(subMoney(0.3, 0.1)).toBe(0.2);
  });
});

describe('createId', () => {
  it('生成带前缀的唯一 ID', () => {
    resetIdCounter();
    const a = createId('tx');
    const b = createId('tx');
    expect(a).toMatch(/^tx_/);
    expect(b).toMatch(/^tx_/);
    expect(a).not.toBe(b);
  });
});
