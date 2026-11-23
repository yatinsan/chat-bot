import { useCallback, useEffect, useState } from 'react';
import MeetingCard from './MeetingCard.jsx';
import MeetingsCalendar from './MeetingsCalendar.jsx';

export default function MeetingsPanel({ subscribe, onOpenChat }) {
  const [meetings, setMeetings] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('meetings-view') === 'calendar' ? 'calendar' : 'list'; } catch { return 'list'; }
  });

  function changeView(next) {
    setView(next);
    try { localStorage.setItem('meetings-view', next); } catch { /* ignore */ }
  }

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/meetings');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Request failed');
      setMeetings(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => subscribe((event) => {
    if (event.type === 'meeting') load();
  }), [subscribe, load]);

  const open = meetings.filter((meeting) => meeting.status === 'pending' || meeting.status === 'countered');
  const decided = meetings.filter((meeting) => meeting.status !== 'pending' && meeting.status !== 'countered');

  return (
    <section className="stack">
      {error && <p className="banner">{error}</p>}
      {loading && <p className="empty-inline">Loading meeting requests…</p>}

      <div className="view-toggle" role="tablist" aria-label="Meetings view">
        <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => changeView('list')}>List</button>
        <button type="button" role="tab" aria-selected={view === 'calendar'} className={view === 'calendar' ? 'active' : ''} onClick={() => changeView('calendar')}>Calendar</button>
      </div>

      {view === 'calendar' && !loading && (
        <MeetingsCalendar meetings={meetings} onDecided={load} onOpenChat={onOpenChat} />
      )}

      {view === 'list' && <>
      <article className="panel">
        <header className="panel-head">
          <h2>Waiting for you</h2>
          <span className="tag">{open.length}</span>
        </header>
        {!loading && open.length === 0 && (
          <p className="empty-inline">No meeting requests waiting. They appear here when a customer proposes a time.</p>
        )}
        <div className="meeting-list">
          {open.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} onDecided={load} onOpenChat={onOpenChat} />
          ))}
        </div>
      </article>

      {decided.length > 0 && (
        <article className="panel">
          <header className="panel-head">
            <h2>Decided</h2>
          </header>
          <div className="meeting-list">
            {decided.map((meeting) => (
              <MeetingCard key={meeting.id} meeting={meeting} onOpenChat={onOpenChat} />
            ))}
          </div>
        </article>
      )}
      </>}
    </section>
  );
}
