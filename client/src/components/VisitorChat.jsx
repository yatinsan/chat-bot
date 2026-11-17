import { useEffect, useRef, useState } from 'react';
import MessageThread from './MessageThread.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';

const STORAGE_KEY = 'pixbit-chat-id';

export default function VisitorChat() {
  const [chatId, setChatId] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState('');
  const [companyName, setCompanyName] = useState('Pixbit Solutions');
  const chatRef = useRef(chatId);
  const mark = companyName.trim().charAt(0).toUpperCase() || 'P';

  const { status, send } = useWebSocket((event) => {
    if (event.type === 'chat_created' && event.chatId) {
      chatRef.current = event.chatId;
      setChatId(event.chatId);
      localStorage.setItem(STORAGE_KEY, event.chatId);
    }
    if (event.type === 'message' && String(event.message.chat_id) === String(chatRef.current)) {
      setMessages((prev) => (
        prev.some((message) => message.id === event.message.id) ? prev : [...prev, event.message]
      ));
    }
    if (event.type === 'typing' && String(event.chatId) === String(chatRef.current)) {
      setTyping(Boolean(event.active));
    }
    if (event.type === 'error') setError(event.message);
    if (event.type === 'lead_deleted' && String(event.chatId) === String(chatRef.current)) {
      localStorage.removeItem(STORAGE_KEY);
      chatRef.current = '';
      setChatId('');
      setMessages([]);
      setTyping(false);
    }
  });

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
    document.title = companyName;
  }, [companyName]);

  useEffect(() => {
    chatRef.current = chatId;
    if (!chatId) {
      setMessages([]);
      return undefined;
    }

    let cancelled = false;
    fetch(`/api/messages/${encodeURIComponent(chatId)}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return;
        setMessages((prev) => {
          const ids = new Set(data.map((message) => message.id));
          const extras = prev.filter((message) => !ids.has(message.id));
          return [...data, ...extras];
        });
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this chat. Send a message to try again.');
      });

    return () => {
      cancelled = true;
    };
  }, [chatId]);

  function startNew() {
    localStorage.removeItem(STORAGE_KEY);
    chatRef.current = '';
    setChatId('');
    setMessages([]);
    setDraft('');
    setTyping(false);
    setError('');
  }

  function sendContent(content) {
    if (status !== 'online') {
      setError('Still connecting. Try again in a second.');
      return;
    }

    const id = chatId || `web-${crypto.randomUUID()}`;
    if (!chatId) {
      chatRef.current = id;
      setChatId(id);
      localStorage.setItem(STORAGE_KEY, id);
    }
    setDraft('');
    setError('');
    send({ type: 'send', chatId: id, content });
  }

  function submit(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    sendContent(content);
  }

  const presence = status === 'online' ? 'Online' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  const showWelcome = messages.length === 0 && !typing;

  return (
    <div className="visitor-page">
    <div className="visitor">
      <header className="visitor-head">
        <div className="brand">
          <span className="brand-mark">{mark}</span>
          <div>
            <strong>{companyName}</strong>
            <small>{presence}</small>
          </div>
        </div>
        <button type="button" className="btn" onClick={startNew}>New chat</button>
      </header>
      {error && <p className="banner">{error}</p>}
      {showWelcome ? (
        <div className="visitor-welcome">
          <span className="brand-mark">{mark}</span>
          <p>Tell us what you want to build</p>
          <div className="visitor-chips">
            <button type="button" onClick={() => sendContent('A website')} disabled={status !== 'online'}>A website</button>
            <button type="button" onClick={() => sendContent('A mobile app')} disabled={status !== 'online'}>A mobile app</button>
          </div>
        </div>
      ) : (
        <MessageThread messages={messages} typing={typing} />
      )}
      <form className="composer" onSubmit={submit}>
        <textarea
          rows={2}
          value={draft}
          placeholder="Message…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" className="btn primary" disabled={!draft.trim() || status !== 'online'}>
          Send
        </button>
      </form>
    </div>
    </div>
  );
}
