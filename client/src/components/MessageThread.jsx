import { useEffect, useRef } from 'react';
import { formatTime } from '../lib/format.js';

export default function MessageThread({ messages, typing, emptyText = 'No messages in this conversation yet.' }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, typing]);

  if (messages.length === 0 && !typing) {
    return (
      <div className="thread empty-thread">
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="thread">
      {messages.map((message) => {
        const mine = message.role === 'user';
        const team = message.role === 'admin';
        return (
          <article key={message.id} className={mine ? 'bubble mine' : team ? 'bubble team' : 'bubble'}>
            {team && <span className="team-label">Team</span>}
            <p>{message.content}</p>
            <time>{formatTime(message.created_at)}</time>
          </article>
        );
      })}
      {typing && (
        <article className="bubble typing" aria-label="Assistant is typing">
          <span />
          <span />
          <span />
        </article>
      )}
      <div ref={endRef} />
    </div>
  );
}
