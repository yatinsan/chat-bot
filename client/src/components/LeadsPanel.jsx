import { useCallback, useEffect, useMemo, useState } from 'react';
import { chatLabel, contactHref, formatDateTime, scoreBand } from '../lib/format.js';
import { LEAD_STATUSES, downloadLeadsCsv, statusOf } from '../lib/leads.js';
import TagChips from './TagChips.jsx';
import StatusSelect from './StatusSelect.jsx';

const SORTS = {
  score: (a, b) => (Number(b.lead_score) || 0) - (Number(a.lead_score) || 0)
    || String(b.updated_at || '').localeCompare(String(a.updated_at || '')),
  recent: (a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')),
};

export default function LeadsPanel({ subscribe, onOpenChat }) {
  const [leads, setLeads] = useState([]);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('score');
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState('');

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
    if (['lead', 'message', 'lead_deleted', 'meeting'].includes(event.type)) load();
  }), [subscribe, load]);

  const counts = useMemo(() => {
    const result = { all: leads.length };
    for (const item of LEAD_STATUSES) result[item.id] = 0;
    for (const lead of leads) result[statusOf(lead)] += 1;
    return result;
  }, [leads]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return leads
      .filter((lead) => filter === 'all' || statusOf(lead) === filter)
      .filter((lead) => {
        if (!needle) return true;
        return [chatLabel(lead), lead.contact, lead.service, lead.stack, lead.insights]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .sort(SORTS[sort]);
  }, [leads, filter, sort, query]);

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

  async function copyContact(lead, value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(lead.chat_id);
      setTimeout(() => setCopiedId((current) => (current === lead.chat_id ? '' : current)), 1500);
    } catch {
      setError('Could not copy to the clipboard.');
    }
  }

  return (
    <section className="stack leads-page">
      {error && <p className="banner">{error}</p>}

      <div className="leads-toolbar">
        <div className="filter-chips" role="tablist" aria-label="Filter by stage">
          {[{ id: 'all', label: 'All' }, ...LEAD_STATUSES].map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={filter === item.id ? 'filter-chip active' : 'filter-chip'}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span>{counts[item.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="leads-controls">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search leads"
            aria-label="Search leads"
          />
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort leads">
            <option value="score">Highest score</option>
            <option value="recent">Most recent</option>
          </select>
          <button type="button" className="btn" disabled={visible.length === 0} onClick={() => downloadLeadsCsv(visible)}>
            Export CSV
          </button>
        </div>
      </div>

      {leads.length === 0 ? (
        <article className="panel empty-panel">
          <h2>No leads yet</h2>
          <p>When the assistant learns a name, service, or meeting time, the profile shows up here.</p>
        </article>
      ) : visible.length === 0 ? (
        <article className="panel empty-panel">
          <h2>Nothing here</h2>
          <p>No leads match this stage or search.</p>
        </article>
      ) : (
        <div className="lead-grid">
          {visible.map((lead) => {
            const contact = contactHref(lead.contact);
            return (
              <article key={lead.chat_id} className={`lead-card lead-${statusOf(lead)}`}>
                <div className="lead-top">
                  <div>
                    <h2>{chatLabel(lead)}</h2>
                    <p className="lead-sub">
                      {lead.service && lead.service !== 'Not specified' ? lead.service : 'Service not captured'}
                      {' · '}
                      {formatDateTime(lead.updated_at)}
                    </p>
                  </div>
                  {Number(lead.lead_score) > 0 && (
                    <span className={`score-badge ${scoreBand(lead.lead_score)}`} title={lead.score_reason || undefined}>
                      {lead.lead_score}<small>/10</small>
                    </span>
                  )}
                </div>
                <div className="lead-row">
                  <StatusSelect lead={lead} onChanged={load} />
                  <TagChips tags={lead.tags} />
                </div>
                {contact ? (
                  <div className="contact-row">
                    <a className="contact" href={contact.href}>{contact.display}</a>
                    <button type="button" className="link-btn" onClick={() => copyContact(lead, contact.display)}>
                      {copiedId === lead.chat_id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ) : (
                  <p className="lead-sub">No contact yet</p>
                )}
                <dl className="lead-facts">
                  {lead.stack && (<><dt>Stack</dt><dd>{lead.stack}</dd></>)}
                  {lead.meeting_time && (<><dt>Meeting</dt><dd>{lead.meeting_time}</dd></>)}
                </dl>
                <p className="notes clamp">{lead.insights || 'No notes yet.'}</p>
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
            );
          })}
        </div>
      )}
    </section>
  );
}
