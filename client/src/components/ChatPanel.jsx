import { useCallback, useEffect, useRef, useState } from 'react';
import ConversationList from './ConversationList.jsx';
import MessageThread from './MessageThread.jsx';
import { channelOf, chatLabel } from '../lib/format.js';

export default function ChatPanel({ subscribe, send, status, initialChatId }) {
  const [chats, setChats] = useState([]);
  const [selectedId, setSelectedId] = useState(initialChatId);
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const selectedRef = useRef(initialChatId);

  function selectChat(chatId) {
    selectedRef.current = chatId;
    setSelectedId(chatId);
  }

  const loadChats = useCallback(async () => {
    try {
      const response = await fetch('/api/chats');
      const data = await response.json();
      setChats(Array.isArray(data) ? data : []);
    } catch {
      setError('Could not load conversations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEffect(() => {
    if (initialChatId) selectChat(initialChatId);
  }, [initialChatId]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setTyping(false);
      return undefined;
    }

    let cancelled = false;
    setMessages([]);
    fetch(`/api/messages/${encodeURIComponent(selectedId)}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return;
        setMessages((prev) => {
          const ids = new Set(data.map((message) => message.id));
          const extras = prev.filter(
            (message) => String(message.chat_id) === String(selectedId) && !ids.has(message.id)
          );
          return [...data, ...extras];
        });
      })
      .catch(() => {
        if (!cancelled) setError('Could not load messages.');
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => subscribe((event) => {
    if (event.type === 'message') {
      loadChats();
      if (String(event.message.chat_id) === String(selectedRef.current)) {
        setMessages((prev) => (
          prev.some((message) => message.id === event.message.id) ? prev : [...prev, event.message]
        ));
      }
    }
    if (event.type === 'typing' && String(event.chatId) === String(selectedRef.current)) {
      setTyping(Boolean(event.active));
    }
    if (event.type === 'lead') loadChats();
    if (event.type === 'lead_deleted') {
      loadChats();
      if (String(event.chatId) === String(selectedRef.current)) {
        selectChat(null);
        setMessages([]);
      }
    }
    if (event.type === 'error') setError(event.message);
    if (event.type === 'chat_created') selectChat(event.chatId);
  }), [subscribe, loadChats]);

  const active = chats.find((chat) => String(chat.chat_id) === String(selectedId));

  function submit(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    if (status !== 'online') {
      setError('WebSocket is offline. Wait for the connection, then send again.');
      return;
    }

    // In an existing chat the text is the team's reply. In a new chat it is a test message to the assistant.
    if (selectedId) {
      setDraft('');
      setError('');
      send({ type: 'admin_reply', chatId: selectedId, content });
      return;
    }

    const chatId = `web-${crypto.randomUUID()}`;
    selectChat(chatId);
    setDraft('');
    setError('');
    send({ type: 'send', chatId, content });
  }

  return (
    <section className="split">
      <ConversationList
        chats={chats}
        selectedId={selectedId}
        onSelect={selectChat}
        query={query}
        onQuery={setQuery}
        loading={loading}
        action={(
          <button type="button" className="btn" onClick={() => selectChat(null)}>
            New chat
          </button>
        )}
      />
      <div className="chat-pane">
        <header className="chat-head">
          <div>
            <h2>{active ? chatLabel(active) : selectedId ? 'Conversation' : 'New website chat'}</h2>
            <p>{selectedId ? `${channelOf(selectedId)} · ${selectedId}` : 'Messages are saved to chat history'}</p>
          </div>
        </header>
        {error && <p className="banner">{error}</p>}
        <MessageThread messages={messages} typing={typing} />
        <form className="composer" onSubmit={submit}>
          <textarea
            rows={2}
            value={draft}
            placeholder={selectedId ? 'Reply as the team…' : 'Test the assistant as a new customer…'}
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
    </section>
  );
}
