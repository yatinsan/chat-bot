import { useCallback, useEffect, useState } from 'react';
import { chatLabel, formatDateTime, scoreBand } from '../lib/format.js';

export default function LeadsPanel({ subscribe, onOpenChat }) {
  const [leads, setLeads] = useState([]);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/enquiries');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Request failed');
      setLeads(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => subscribe((event) => {
    if (event.type === 'lead' || event.type === 'message' || event.type === 'lead_deleted') load();
  }), [subscribe, load]);

  async function removeLead(lead) {
    const label = chatLabel(lead);
    if (!window.confirm(`Delete ${label}? This removes the lead, the chat, and every message.`)) return;
    setPendingId(lead.chat_id);
    setError('');
    try {
      const response = await fetch(`/api/leads/${encodeURIComponent(lead.chat_id)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not delete this lead.');
      setLeads((current) => current.filter((item) => String(item.chat_id) !== String(lead.chat_id)));
    } catch (err) {
      setError(err.message);
    } finally {
      setPendingId('');
    }
  }

  return (
    <section className="stack">
      {error && <p className="banner">{error}</p>}
      {leads.length === 0 ? (
        <article className="panel empty-panel">
          <h2>No leads yet</h2>
          <p>When the assistant learns a name, service, or meeting time, the profile shows up here.</p>
        </article>
      ) : (
        <div className="lead-grid">
          {leads.map((lead) => (
            <article key={lead.chat_id} className="lead-card">
              <div className="conv-row">
                <span className="tag">{lead.service || 'Unspecified'}</span>
                {Number(lead.lead_score) > 0 && (
                  <span className={`score ${scoreBand(lead.lead_score)}`}>{lead.lead_score}/10</span>
                )}
                <time>{formatDateTime(lead.updated_at)}</time>
              </div>
              <h2>{chatLabel(lead)}</h2>
              <p className="contact">{lead.contact || 'No contact yet'}</p>
              {lead.stack && <p className="meeting">Stack · {lead.stack}</p>}
              {lead.meeting_time && <p className="meeting">Meeting · {lead.meeting_time}</p>}
              <h3>Notes</h3>
              <p className="notes">{lead.insights || 'No notes yet.'}</p>
              <div className="lead-actions">
                <button type="button" className="btn" onClick={() => onOpenChat(lead.chat_id)}>
                  Open chat
                </button>
                <button
                  type="button"
                  className="btn danger"
                  disabled={pendingId === lead.chat_id}
                  onClick={() => removeLead(lead)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
