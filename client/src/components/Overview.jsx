import { useCallback, useEffect, useState } from 'react';
import { formatDateTime, chatLabel, channelOf } from '../lib/format.js';

export default function Overview({ subscribe, onOpenChat }) {
  const [stats, setStats] = useState({ leads: 0, messages: 0, chats: 0, meetings: 0 });
  const [chats, setChats] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [statsRes, chatsRes] = await Promise.all([fetch('/api/stats'), fetch('/api/chats')]);
      const statsData = await statsRes.json();
      const chatsData = await chatsRes.json();
      if (!statsRes.ok || !chatsRes.ok) throw new Error(statsData.error || chatsData.error || 'Request failed');
      setStats(statsData);
      setChats(Array.isArray(chatsData) ? chatsData.slice(0, 6) : []);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => subscribe((event) => {
    if (event.type === 'message' || event.type === 'lead' || event.type === 'lead_deleted' || event.type === 'meeting') load();
  }), [subscribe, load]);

  const cards = [
    { label: 'Conversations', value: stats.chats },
    { label: 'Messages', value: stats.messages },
    { label: 'Leads', value: stats.leads },
    { label: 'Meetings booked', value: stats.meetings },
    { label: 'Awaiting your decision', value: stats.pending_meetings },
  ];

  return (
    <section className="stack">
      {error && <p className="banner">{error}</p>}
      <div className="stat-grid">
        {cards.map((card) => (
          <article key={card.label} className="stat-card">
            <span>{card.label}</span>
            <strong>{card.value ?? 0}</strong>
          </article>
        ))}
      </div>
      <article className="panel">
        <header className="panel-head">
          <h2>Recent conversations</h2>
        </header>
        {chats.length === 0 ? (
          <p className="empty-inline">No chats yet. Start one from Live Chat.</p>
        ) : (
          <ul className="recent-list">
            {chats.map((chat) => (
              <li key={chat.chat_id}>
                <button type="button" onClick={() => onOpenChat(chat.chat_id)}>
                  <div>
                    <strong>{chatLabel(chat)}</strong>
                    <p>{chat.last_message}</p>
                  </div>
                  <div className="recent-side">
                    <span className="tag">{channelOf(chat.chat_id)}</span>
                    <time>{formatDateTime(chat.last_at)}</time>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
