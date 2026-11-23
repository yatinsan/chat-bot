import { useEffect, useRef, useState } from 'react';
import MessageThread from './MessageThread.jsx';
import CallBar from './CallBar.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { callSupported, useCall } from '../hooks/useCall.js';

// The chat window customers see. In test mode (the dashboard's Test chat page) it keeps
// its own chat, and the chat id starts with "web-test-" so the team can tell it apart.
export default function VisitorChat({ test = false }) {
  const STORAGE_KEY = test ? 'pixbit-test-chat-id' : 'pixbit-chat-id';
  const ID_PREFIX = test ? 'web-test-' : 'web-';
  const [chatId, setChatId] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
  });
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
    if (!test) document.title = companyName;
  }, [companyName, test]);

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

  // The chat id for this conversation, creating one if this is the very first message or call.
  function ensureChatId() {
    if (chatRef.current) return chatRef.current;
    const id = `${ID_PREFIX}${crypto.randomUUID()}`;
    chatRef.current = id;
    setChatId(id);
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  }

  function sendContent(content) {
    if (status !== 'online') {
      setError('Still connecting. Try again in a second.');
      return;
    }

    const id = ensureChatId();
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

  const call = useCall({ messages, typing, online: status === 'online', sendContent, ensureChatId, wsSend: send });

  const presence = status === 'online' ? 'Online' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  const showWelcome = messages.length === 0 && !typing;

  return (
    <div className={test ? 'visitor-page embedded' : 'visitor-page'}>
    <div className="visitor">
      <header className="visitor-head">
        <div className="brand">
          <span className="brand-mark">{mark}</span>
          <div>
            <strong>{companyName}</strong>
            <small>{call.active ? 'In call' : presence}</small>
          </div>
        </div>
        <div className="visitor-actions">
          {callSupported && !call.active && (
            <button type="button" className="btn call-start" onClick={call.start} disabled={status !== 'online'} aria-label="Start voice call" title="Start voice call">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" /></svg>
              Call
            </button>
          )}
          <button type="button" className="btn" onClick={startNew} disabled={call.active}>New chat</button>
        </div>
      </header>
      {(error || call.error) && <p className="banner">{error || call.error}</p>}
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
      {call.active ? <CallBar call={call} /> : (
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
      )}
    </div>
    </div>
  );
}
