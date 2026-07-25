import { useEffect, useState } from 'react';
import { bootstrap } from './ui/appState';
import { AccountsView } from './ui/AccountsView';
import { CalendarView } from './ui/CalendarView';
import { ChatView } from './ui/ChatView';
import { SettingsView } from './ui/SettingsView';
import { StatsView } from './ui/StatsView';
import { TxListView } from './ui/TxListView';
import { useStoreVersion } from './ui/useStoreVersion';

type Tab = 'chat' | 'accounts' | 'calendar' | 'txs' | 'stats' | 'settings';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'chat', label: '对话' },
  { key: 'accounts', label: '账户' },
  { key: 'calendar', label: '日历' },
  { key: 'txs', label: '流水' },
  { key: 'stats', label: '统计' },
  { key: 'settings', label: '设置' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [version, bump] = useStoreVersion();

  useEffect(() => {
    if (bootstrap() > 0) bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>智能记账AI助手</h1>
      </header>
      <main>
        {tab === 'chat' && <ChatView onChanged={bump} />}
        {tab === 'accounts' && <AccountsView onChanged={bump} />}
        {tab === 'calendar' && <CalendarView version={version} />}
        {tab === 'txs' && <TxListView />}
        {tab === 'stats' && <StatsView />}
        {tab === 'settings' && <SettingsView onChanged={bump} />}
      </main>
      <nav className="tab-bar">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
