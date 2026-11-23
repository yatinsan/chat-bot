const DEFAULT_MINUTES = 30;

// Google wants UTC times as YYYYMMDDTHHMMSSZ.
function toGoogleDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Builds an "Add to Google Calendar" link for a meeting. When the meeting has no exact
// time (preferred_at), the link still opens a prefilled event and the user picks the time.
export function googleCalendarUrl(meeting, name = '') {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: name ? `Meeting with ${name}` : 'Meeting',
  });

  const details = [`Requested time: ${meeting.preferred_text}`];
  if (meeting.note) details.push(`Note: ${meeting.note}`);
  params.set('details', details.join('\n'));

  const start = meeting.preferred_at ? new Date(meeting.preferred_at) : null;
  if (start && !Number.isNaN(start.getTime())) {
    const end = new Date(start.getTime() + DEFAULT_MINUTES * 60 * 1000);
    params.set('dates', `${toGoogleDate(start)}/${toGoogleDate(end)}`);
    if (meeting.timezone) params.set('ctz', meeting.timezone);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
