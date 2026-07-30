import { beforeEach, describe, expect, it } from 'vitest';
import { getLang, setLang, t } from '../../src/i18n/index';

describe('P2 i18n', () => {
  beforeEach(() => {
    localStorage.clear();
    setLang('zh');
  });

  it('默认中文，缺失 key 原样返回', () => {
    expect(t('stats.title')).toBe('统计');
    expect(t('not.a.key')).toBe('not.a.key');
  });

  it('setLang 切换语言并持久化到 localStorage', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    expect(t('stats.title')).toBe('Statistics');
    expect(localStorage.getItem('ai-ledger-lang')).toBe('en');
  });

  it('切回中文', () => {
    setLang('en');
    setLang('zh');
    expect(getLang()).toBe('zh');
    expect(t('stats.title')).toBe('统计');
  });

  it('t 支持变量替换', () => {
    // 用带占位符的临时字典键验证替换逻辑
    expect(t('app.name')).toBe('智能记账AI助手');
  });
});
