import { useEffect, useRef } from 'react';
import { formatTime } from '../lib/format.js';
import { SpeakButton, SpeechPlayer, useSpeech } from './SpeakButton.jsx';

function Bubble({ message }) {
  const mine = message.role === 'user';
  const team = message.role === 'admin';
  const speech = useSpeech(message.content);
  return (
    <article className={mine ? 'bubble mine' : team ? 'bubble team' : 'bubble'}>
      {team && <span className="team-label">Team</span>}
      <p>{message.content}</p>
      <SpeechPlayer speech={speech} />
      <div className="bubble-foot">
        <time>{formatTime(message.created_at)}</time>
        {!mine && <SpeakButton speech={speech} />}
      </div>
    </article>
  );
}

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
      {messages.map((message) => <Bubble key={message.id} message={message} />)}
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
