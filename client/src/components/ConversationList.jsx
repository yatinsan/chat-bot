import { chatLabel, channelOf, formatDateTime } from '../lib/format.js';

export default function ConversationList({ chats, selectedId, onSelect, query, onQuery, action, loading }) {
  const needle = query.trim().toLowerCase();
  const visible = chats.filter((chat) => {
    if (!needle) return true;
    const haystack = [chatLabel(chat), chat.chat_id, chat.last_message, chat.service, chat.contact]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });

  return (
    <div className="conv-list">
      <div className="conv-toolbar">
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
        />
        {action}
      </div>
      <div className="conv-scroll">
        {loading && <p className="empty-inline">Loading conversations…</p>}
        {!loading && visible.length === 0 && (
          <p className="empty-inline">{needle ? 'No conversations match.' : 'No conversations yet.'}</p>
        )}
        {visible.map((chat) => (
          <button
            key={chat.chat_id}
            type="button"
            className={String(selectedId) === String(chat.chat_id) ? 'conv-item active' : 'conv-item'}
            onClick={() => onSelect(chat.chat_id)}
          >
            <div className="conv-row">
              <strong>{chatLabel(chat)}</strong>
              <span>{formatDateTime(chat.last_at)}</span>
            </div>
            <p>{chat.last_message || 'No messages yet'}</p>
            <div className="conv-meta">
              <span className="tag">{channelOf(chat.chat_id)}</span>
              <span>{chat.message_count} messages</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
