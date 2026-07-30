import { useSyncExternalStore } from 'react';
import { getLang, onLangChange, setLang, t, type Lang } from './index';

/** React 绑定：语言变化时自动重渲染当前组件 */
export function useI18n(): { lang: Lang; setLang: (l: Lang) => void; t: typeof t } {
  const lang = useSyncExternalStore(onLangChange, getLang, getLang);
  return { lang, setLang, t };
}
