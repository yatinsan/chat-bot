import { useState } from 'react';
import { chatLabel, formatDateTime } from '../lib/format.js';

export const STATUS_LABEL = {
  pending: 'Awaiting your decision',
  countered: 'Waiting for their reply',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
};

export default function MeetingCard({ meeting, onDecided, onOpenChat }) {
  const [suggesting, setSuggesting] = useState(false);
  const [proposed, setProposed] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = meeting.status === 'pending' || meeting.status === 'countered';

  async function decide(decision, extra = {}) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/meetings/${meeting.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, ...extra }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save that decision.');
      setSuggesting(false);
      setProposed('');
      onDecided?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`meeting-card meeting-${meeting.status}`}>
      <header className="meeting-head">
        <strong>{chatLabel(meeting)}</strong>
        <span className={`meeting-status meeting-${meeting.status}`}>
          {STATUS_LABEL[meeting.status] || meeting.status}
        </span>
      </header>
      <p className="meeting-when">{meeting.preferred_text}</p>
      <p className="meeting-meta">
        Asked {formatDateTime(meeting.created_at)}
        {meeting.note ? ` · ${meeting.note}` : ''}
      </p>
      {meeting.conflict && (
        <p className="meeting-conflict">Another open or confirmed request has this same time.</p>
      )}
      {meeting.status === 'countered' && meeting.proposed_text && (
        <p className="meeting-meta">You suggested: {meeting.proposed_text}</p>
      )}
      {error && <p className="banner">{error}</p>}

      {open && !suggesting && (
        <div className="meeting-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => decide('approve')}>
            Approve
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setSuggesting(true)}>
            Suggest another time
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => decide('reject')}>
            Reject
          </button>
          {onOpenChat && (
            <button type="button" className="btn ghost" onClick={() => onOpenChat(meeting.chat_id)}>
              Open chat
            </button>
          )}
        </div>
      )}

      {open && suggesting && (
        <form
          className="meeting-suggest"
          onSubmit={(event) => {
            event.preventDefault();
            if (proposed.trim()) decide('counter', { proposed_text: proposed.trim() });
          }}
        >
          <input
            value={proposed}
            onChange={(event) => setProposed(event.target.value)}
            placeholder="e.g. Monday 11 AM"
            aria-label="Time to suggest"
          />
          <button type="submit" className="btn primary" disabled={busy || !proposed.trim()}>
            Send suggestion
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setSuggesting(false)}>
            Cancel
          </button>
        </form>
      )}

      {onOpenChat && !(open && !suggesting) && (
        <button type="button" className="btn meeting-open" onClick={() => onOpenChat(meeting.chat_id)}>
          Open chat
        </button>
      )}
    </article>
  );
}
