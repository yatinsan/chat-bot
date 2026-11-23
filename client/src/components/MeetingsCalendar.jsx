import { useMemo, useState } from 'react';
import MeetingCard from './MeetingCard.jsx';
import { chatLabel } from '../lib/format.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function dayKey(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

// The day a meeting falls on, in the time zone it was booked in.
function meetingDay(meeting) {
  const date = new Date(meeting.preferred_at);
  if (Number.isNaN(date.getTime())) return null;
  let timeZone = meeting.timezone || undefined;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
}

function meetingClock(meeting) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: meeting.timezone || undefined,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(meeting.preferred_at));
  } catch {
    return '';
  }
}

export default function MeetingsCalendar({ meetings, onDecided, onOpenChat }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selected, setSelected] = useState(dayKey(today.getFullYear(), today.getMonth(), today.getDate()));

  const { byDay, unscheduled } = useMemo(() => {
    const map = {};
    const loose = [];
    for (const meeting of meetings) {
      const key = meeting.preferred_at ? meetingDay(meeting) : null;
      if (!key) {
        if (meeting.status !== 'rejected') loose.push(meeting);
        continue;
      }
      (map[key] ||= []).push(meeting);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => new Date(a.preferred_at) - new Date(b.preferred_at));
    }
    return { byDay: map, unscheduled: loose };
  }, [meetings]);

  const first = new Date(cursor.year, cursor.month, 1);
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first.getDay(); i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);

  const todayKey = dayKey(today.getFullYear(), today.getMonth(), today.getDate());
  const monthLabel = first.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const selectedMeetings = byDay[selected] || [];

  function shift(delta) {
    const next = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: next.getFullYear(), month: next.getMonth() });
  }

  function goToday() {
    setCursor({ year: today.getFullYear(), month: today.getMonth() });
    setSelected(todayKey);
  }

  return (
    <>
      <article className="panel">
        <header className="panel-head cal-head">
          <h2>{monthLabel}</h2>
          <div className="cal-nav">
            <button type="button" className="btn" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
            <button type="button" className="btn" onClick={goToday}>Today</button>
            <button type="button" className="btn" onClick={() => shift(1)} aria-label="Next month">›</button>
          </div>
        </header>

        <div className="cal-grid cal-weekdays">
          {WEEKDAYS.map((name) => <span key={name}>{name}</span>)}
        </div>
        <div className="cal-grid">
          {cells.map((day, index) => {
            if (!day) return <span key={`blank-${index}`} className="cal-cell cal-blank" />;
            const key = dayKey(cursor.year, cursor.month, day);
            const list = byDay[key] || [];
            const classes = ['cal-cell'];
            if (key === todayKey) classes.push('cal-today');
            if (key === selected) classes.push('cal-selected');
            return (
              <button type="button" key={key} className={classes.join(' ')} onClick={() => setSelected(key)}>
                <span className="cal-day">{day}</span>
                {list.slice(0, 2).map((meeting) => (
                  <span key={meeting.id} className={`cal-chip cal-chip-${meeting.status}`}>
                    {meetingClock(meeting)} {chatLabel(meeting)}
                  </span>
                ))}
                {list.length > 2 && <span className="cal-more">+{list.length - 2} more</span>}
              </button>
            );
          })}
        </div>
      </article>

      <article className="panel">
        <header className="panel-head">
          <h2>{new Date(`${selected}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
          <span className="tag">{selectedMeetings.length}</span>
        </header>
        {selectedMeetings.length === 0 && <p className="empty-inline">No meetings on this day.</p>}
        <div className="meeting-list">
          {selectedMeetings.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} onDecided={onDecided} onOpenChat={onOpenChat} />
          ))}
        </div>
      </article>

      {unscheduled.length > 0 && (
        <article className="panel">
          <header className="panel-head">
            <h2>No exact time yet</h2>
            <span className="tag">{unscheduled.length}</span>
          </header>
          <div className="meeting-list">
            {unscheduled.map((meeting) => (
              <MeetingCard key={meeting.id} meeting={meeting} onDecided={onDecided} onOpenChat={onOpenChat} />
            ))}
          </div>
        </article>
      )}
    </>
  );
}
