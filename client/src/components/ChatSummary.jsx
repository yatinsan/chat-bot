import { useCallback, useEffect, useState } from 'react';

export const SUMMARY_MIN_MESSAGES = 6;

const FIELDS = [
  ['wants', 'Wants'],
  ['budget', 'Budget'],
  ['timeline', 'Timeline'],
  ['missing', 'Still missing'],
];

export default function ChatSummary({ chatId, messageCount }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/summary`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not load the summary.');
    return body;
  }, [chatId]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/summary`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not create the summary.');
      setData(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [chatId]);

  // Reload the saved summary whenever the chat or its message count changes.
  useEffect(() => {
    setData(null);
    setError('');
    if (!chatId || messageCount < SUMMARY_MIN_MESSAGES) return undefined;
    let cancelled = false;
    load()
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, messageCount, load]);

  // First time a long chat is opened, create its summary automatically.
  useEffect(() => {
    if (data && !data.summary && !busy && !error && messageCount >= SUMMARY_MIN_MESSAGES) refresh();
  }, [data, busy, error, messageCount, refresh]);

  if (messageCount < SUMMARY_MIN_MESSAGES) return null;

  const stale = data?.summary && data.current_count !== data.message_count;

  return (
    <section className="chat-summary" aria-label="Conversation summary">
      <header>
        <strong>Summary</strong>
        <span className="chat-summary-note">
          {!data
            ? 'Loading…'
            : stale
              ? 'New messages since this summary'
              : data.summary
                ? `Based on ${data.message_count} messages`
                : 'Not created yet'}
        </span>
        <button type="button" className="btn" disabled={busy} onClick={refresh}>
          {busy ? 'Updating…' : stale || !data?.summary ? 'Update' : 'Refresh'}
        </button>
      </header>
      {data?.summary && (
        <dl>
          {FIELDS.map(([key, label]) => (
            <div key={key} className={`chat-summary-row summary-${key}`}>
              <dt>{label}</dt>
              <dd>{data.summary[key]}</dd>
            </div>
          ))}
        </dl>
      )}
      {error && <p className="banner">{error}</p>}
    </section>
  );
}
