import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Overview from './components/Overview.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import LeadsPanel from './components/LeadsPanel.jsx';
import InboxPanel from './components/InboxPanel.jsx';
import BusinessPanel from './components/BusinessPanel.jsx';
import MeetingsPanel from './components/MeetingsPanel.jsx';
import { useWebSocket } from './hooks/useWebSocket.js';
import './meetings.css';
import './summary.css';

const TITLES = {
  inbox: ['Inbox', 'Each chat, what they need, and who to contact'],
  meetings: ['Meetings', 'Call requests from customers, waiting for your decision'],
  overview: ['Overview', 'Leads, conversations, and live activity'],
  chat: ['Live Chat', 'Reply to a customer as the team, or test the assistant in a new chat'],
  history: ['Chat History', 'Every saved website and Telegram conversation'],
  leads: ['Leads', 'Profiles the assistant has collected'],
  business: ['Business', 'Company facts the assistant can use'],
};

export default function App() {
  const listeners = useRef(new Set());
  const [section, setSection] = useState('inbox');
  const [focusChatId, setFocusChatId] = useState(null);
  const [companyName, setCompanyName] = useState('Pixbit Solutions');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings')
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data?.company_name) setCompanyName(data.company_name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.title = `${companyName} — Dashboard`;
  }, [companyName]);

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
      <Sidebar section={section} onSection={setSection} status={status} companyName={companyName} />
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
          {section === 'inbox' && <InboxPanel subscribe={subscribe} />}
          {section === 'meetings' && <MeetingsPanel subscribe={subscribe} onOpenChat={openChat} />}
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
          {section === 'business' && <BusinessPanel onSaved={(profile) => setCompanyName(profile.company_name)} />}
        </main>
      </div>
    </div>
  );
}
