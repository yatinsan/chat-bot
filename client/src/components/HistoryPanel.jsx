import { useCallback, useEffect, useState } from 'react';
import ConversationList from './ConversationList.jsx';
import MessageThread from './MessageThread.jsx';
import { channelOf, chatLabel, formatDateTime } from '../lib/format.js';

export default function HistoryPanel({ subscribe, onOpenChat }) {
  const [chats, setChats] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadChats = useCallback(async () => {
    try {
      const response = await fetch('/api/chats');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Request failed');
      setChats(Array.isArray(data) ? data : []);
      setSelectedId((current) => current || data[0]?.chat_id || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return undefined;
    }
    let cancelled = false;
    fetch(`/api/messages/${encodeURIComponent(selectedId)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setMessages(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this transcript.');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => subscribe((event) => {
    if (event.type === 'message' || event.type === 'lead') loadChats();
    if (event.type === 'message' && String(event.message.chat_id) === String(selectedId)) {
      setMessages((prev) => (
        prev.some((message) => message.id === event.message.id) ? prev : [...prev, event.message]
      ));
    }
  }), [subscribe, loadChats, selectedId]);

  const active = chats.find((chat) => String(chat.chat_id) === String(selectedId));

  return (
    <section className="split">
      <ConversationList
        chats={chats}
        selectedId={selectedId}
        onSelect={setSelectedId}
        query={query}
        onQuery={setQuery}
        loading={loading}
      />
      <div className="chat-pane">
        <header className="chat-head">
          <div>
            <h2>{active ? chatLabel(active) : 'Select a conversation'}</h2>
            <p>
              {active
                ? `${channelOf(active.chat_id)} · ${active.message_count} messages · ${formatDateTime(active.last_at)}`
                : 'Transcripts stay here after you leave Live Chat.'}
            </p>
          </div>
          {selectedId && (
            <button type="button" className="btn" onClick={() => onOpenChat(selectedId)}>
              Open in chat
            </button>
          )}
        </header>
        {error && <p className="banner">{error}</p>}
        {selectedId ? <MessageThread messages={messages} /> : <div className="thread empty-thread"><p>Pick a conversation from the list.</p></div>}
      </div>
    </section>
  );
}
