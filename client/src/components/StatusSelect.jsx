import { useState } from 'react';
import { LEAD_STATUSES, statusOf, updateLeadStatus } from '../lib/leads.js';

export default function StatusSelect({ lead, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = statusOf(lead);

  async function change(event) {
    const next = event.target.value;
    setBusy(true);
    setError('');
    try {
      onChanged?.(await updateLeadStatus(lead.chat_id, next));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="status-select-wrap">
      <select
        className={`status-select lead-status-${current}`}
        value={current}
        onChange={change}
        disabled={busy}
        aria-label="Lead status"
      >
        {LEAD_STATUSES.map((item) => (
          <option key={item.id} value={item.id}>{item.label}</option>
        ))}
      </select>
      {error && <small className="status-error">{error}</small>}
    </span>
  );
}
