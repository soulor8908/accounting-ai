/**
 * i18n 字典（P2 i18n）
 * 轻量脚手架：先用字典覆盖最高频的界面文案；其余文案的覆盖是增量工作（见改进路线图）。
 * 默认语言为中文，未翻译的 key 原样返回，保证不出现空白。
 */
export type Lang = 'zh' | 'en';

export const LANGS: Array<{ value: Lang; label: string }> = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
];

export const zh: Record<string, string> = {
  'app.name': '智能记账AI助手',
  'nav.stats': '统计',
  'nav.chat': '对话',
  'nav.settings': '设置',
  'stats.title': '统计',
  'stats.exportCsv': '导出月度报表 (CSV)',
  'stats.exportPng': '导出趋势图 (PNG)',
  'chat.welcome': '你好，我是记账助手。直接说「吃午饭25」就能记账，也可以问我「这个月花了多少」。',
  'chat.placeholder': '输入消息，AI 帮你记账...',
  'chat.placeholderLocal': '输入消息，离线也能记账（本地解析，无需联网）...',
  'settings.title': '设置',
  'settings.ai': 'AI 助手配置',
  'settings.data': '数据管理',
  'settings.language': '界面语言',
};

export const en: Record<string, string> = {
  'app.name': 'AI Ledger Assistant',
  'nav.stats': 'Stats',
  'nav.chat': 'Chat',
  'nav.settings': 'Settings',
  'stats.title': 'Statistics',
  'stats.exportCsv': 'Export Monthly Report (CSV)',
  'stats.exportPng': 'Export Trend Chart (PNG)',
  'chat.welcome': 'Hi, I am your ledger assistant. Say "lunch 25" to record, or ask "how much did I spend this month?".',
  'chat.placeholder': 'Type a message, AI helps you record...',
  'chat.placeholderLocal': 'Type a message, works offline (local parsing)...',
  'settings.title': 'Settings',
  'settings.ai': 'AI Assistant',
  'settings.data': 'Data Management',
  'settings.language': 'Language',
};

export function dictFor(lang: Lang): Record<string, string> {
  return lang === 'en' ? en : zh;
}
