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
  const chatRef = useRef(chatId);

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
    document.title = 'Pixbit';
  }, []);

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

  function submit(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
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

  const presence = status === 'online' ? 'Online' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…';

  return (
    <div className="visitor">
      <header className="visitor-head">
        <div className="brand">
          <span className="brand-mark">P</span>
          <div>
            <strong>Pixbit</strong>
            <small>{presence}</small>
          </div>
        </div>
        <button type="button" className="btn" onClick={startNew}>New chat</button>
      </header>
      {error && <p className="banner">{error}</p>}
      <MessageThread
        messages={messages}
        typing={typing}
        emptyText="Hi — what are you looking to build? A website, a mobile app, or both?"
      />
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
  );
}
