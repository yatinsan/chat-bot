import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Overview from './components/Overview.jsx';
import LeadsPanel from './components/LeadsPanel.jsx';
import ConversationsPanel from './components/ConversationsPanel.jsx';
import VisitorChat from './components/VisitorChat.jsx';
import BusinessPanel from './components/BusinessPanel.jsx';
import MeetingsPanel from './components/MeetingsPanel.jsx';
import { useWebSocket } from './hooks/useWebSocket.js';
import './meetings.css';
import './summary.css';

const TITLES = {
  conversations: ['Conversations', 'Every website and Telegram chat: read, reply, or take over from the AI'],
  meetings: ['Meetings', 'Call requests from customers, waiting for your decision'],
  overview: ['Overview', 'Leads, conversations, and live activity'],
  leads: ['Leads', 'Profiles the assistant has collected'],
  business: ['Business', 'Company facts the assistant can use'],
  test: ['Test chat', 'Talk to the assistant exactly as a customer would'],
};

export default function App() {
  const listeners = useRef(new Set());
  const [section, setSection] = useState('conversations');
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

  const [pendingMeetings, setPendingMeetings] = useState(0);
  const loadBadges = useCallback(() => {
    fetch('/api/stats')
      .then((response) => response.json())
      .then((data) => setPendingMeetings(Number(data?.pending_meetings) || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadBadges();
  }, [loadBadges]);

  const { status, send } = useWebSocket((event) => {
    if (event.type === 'meeting' || event.type === 'lead_deleted') loadBadges();
    listeners.current.forEach((listener) => listener(event));
  });

  function openChat(chatId) {
    setFocusChatId(chatId);
    setSection('conversations');
  }

  const [title, subtitle] = TITLES[section];

  return (
    <div className="app">
      <Sidebar
        section={section}
        onSection={setSection}
        status={status}
        companyName={companyName}
        badges={{ meetings: pendingMeetings }}
      />
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
          {section === 'conversations' && (
            <ConversationsPanel
              subscribe={subscribe}
              send={send}
              status={status}
              initialChatId={focusChatId}
              onGoToMeetings={() => setSection('meetings')}
            />
          )}
          {section === 'meetings' && <MeetingsPanel subscribe={subscribe} onOpenChat={openChat} />}
          {section === 'overview' && <Overview subscribe={subscribe} onOpenChat={openChat} />}
          {section === 'leads' && <LeadsPanel subscribe={subscribe} onOpenChat={openChat} />}
          {section === 'business' && <BusinessPanel onSaved={(profile) => setCompanyName(profile.company_name)} />}
          {section === 'test' && (
            <section className="test-chat">
              <VisitorChat test />
              <p className="form-note">This is the chat window your customers see. Test chats show up in Conversations, marked Test.</p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
