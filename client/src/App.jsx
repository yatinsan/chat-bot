import { useCallback, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Overview from './components/Overview.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import LeadsPanel from './components/LeadsPanel.jsx';
import { useWebSocket } from './hooks/useWebSocket.js';

const TITLES = {
  overview: ['Overview', 'Leads, conversations, and live activity'],
  chat: ['Live Chat', 'Talk to the assistant and reply to Telegram threads'],
  history: ['Chat History', 'Every saved website and Telegram conversation'],
  leads: ['Leads', 'Profiles the assistant has collected'],
};

export default function App() {
  const listeners = useRef(new Set());
  const [section, setSection] = useState('overview');
  const [focusChatId, setFocusChatId] = useState(null);

  const subscribe = useCallback((listener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  const { status, send } = useWebSocket((event) => {
    listeners.current.forEach((listener) => listener(event));
  });

  function openChat(chatId) {
    setFocusChatId(chatId);
    setSection('chat');
  }

  const [title, subtitle] = TITLES[section];

  return (
    <div className="app">
      <Sidebar section={section} onSection={setSection} status={status} />
      <div className="workspace">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className={`status-pill status-${status}`}>
            <span className="status-dot" />
            {status === 'online' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline'}
          </div>
        </header>
        <main className="content">
          {section === 'overview' && <Overview subscribe={subscribe} onOpenChat={openChat} />}
          {section === 'chat' && (
            <ChatPanel
              subscribe={subscribe}
              send={send}
              status={status}
              initialChatId={focusChatId}
            />
          )}
          {section === 'history' && <HistoryPanel subscribe={subscribe} onOpenChat={openChat} />}
          {section === 'leads' && <LeadsPanel subscribe={subscribe} onOpenChat={openChat} />}
        </main>
      </div>
    </div>
  );
}
