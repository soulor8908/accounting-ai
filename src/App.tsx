import { useEffect, useState } from 'react';
import { bootstrap } from './ui/appState';
import { AccountsView } from './ui/AccountsView';
import { CalendarView } from './ui/CalendarView';
import { ChatView } from './ui/ChatView';
import { DialogContainer } from './ui/Dialog';
import { Icon, type IconName } from './ui/Icon';
import { LockView } from './ui/LockView';
import { SettingsView } from './ui/SettingsView';
import { StatsView } from './ui/StatsView';
import { TxListView } from './ui/TxListView';
import { useStoreVersion } from './ui/useStoreVersion';
import { isVaultEnabled } from './core/security/vault';

type Tab = 'chat' | 'accounts' | 'calendar' | 'txs' | 'stats' | 'settings';

const TABS: Array<{ key: Tab; label: string; path: string; icon: IconName }> = [
  { key: 'chat', label: '对话', path: '/', icon: 'chat' },
  { key: 'accounts', label: '账户', path: '/accounts', icon: 'accounts' },
  { key: 'calendar', label: '日历', path: '/calendar', icon: 'calendar' },
  { key: 'txs', label: '流水', path: '/transactions', icon: 'list' },
  { key: 'stats', label: '统计', path: '/stats', icon: 'stats' },
  { key: 'settings', label: '设置', path: '/settings', icon: 'settings' },
];

/** 从 URL pathname 恢复 Tab，非法路径回退到 chat */
function tabFromPath(pathname: string): Tab {
  const found = TABS.find((t) => t.path === pathname);
  return found ? found.key : 'chat';
}

export function App() {
  const [tab, setTab] = useState<Tab>(() => tabFromPath(window.location.pathname));
  const [version, bump] = useStoreVersion();
  const [unlocked, setUnlocked] = useState(!isVaultEnabled());

  // 监听浏览器前进/后退，同步 tab
  useEffect(() => {
    const onPopState = () => setTab(tabFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // 切换 tab 时同步 URL（替换而非 push，避免初始加载产生多余历史条目）
  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    const path = TABS.find((t) => t.key === next)?.path ?? '/';
    window.history.pushState({ tab: next }, '', path);
  };

  useEffect(() => {
    if (unlocked && bootstrap() > 0) bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  if (!unlocked) {
    return (
      <div className="app">
        <header className="app-header">
          <div>
            <h1>智能记账</h1>
            <p className="header-sub">AI LEDGER · 加密保险库</p>
          </div>
        </header>
        <main>
          <LockView onUnlocked={() => { setUnlocked(true); bump(); }} />
        </main>
        <DialogContainer />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>智能记账</h1>
          <p className="header-sub">AI LEDGER · 一句话记一笔</p>
        </div>
      </header>
      <main>
        {tab === 'chat' && <ChatView onChanged={bump} />}
        {tab === 'accounts' && <AccountsView onChanged={bump} />}
        {tab === 'calendar' && <CalendarView version={version} />}
        {tab === 'txs' && <TxListView onChanged={bump} />}
        {tab === 'stats' && <StatsView />}
        {tab === 'settings' && <SettingsView onChanged={bump} onLock={() => setUnlocked(false)} />}
      </main>
      <nav className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? 'active' : ''}
            onClick={(e) => { e.preventDefault(); switchTab(t.key); }}
            aria-current={tab === t.key ? 'page' : undefined}
            aria-label={t.label}
          >
            <Icon name={t.icon} size={22} className="tab-icon" />
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <DialogContainer />
    </div>
  );
}
