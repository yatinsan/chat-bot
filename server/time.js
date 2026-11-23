// Date helpers that work in the business time zone set on the Business profile.

export const DEFAULT_TIMEZONE = 'Asia/Dubai';

export function isValidTimeZone(zone) {
  if (typeof zone !== 'string' || !zone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone.trim() });
    return true;
  } catch {
    return false;
  }
}

function zoneOrDefault(zone) {
  return isValidTimeZone(zone) ? zone.trim() : DEFAULT_TIMEZONE;
}

// Today's date in the zone, with the year, e.g. "Tuesday 2026-11-17".
export function businessToday(zone, now = new Date()) {
  const timeZone = zoneOrDefault(zone);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long' }).format(now);
  return `${weekday} ${date}`;
}

// The zone's UTC offset at a moment, as ISO 8601 text, e.g. "+04:00" or "-05:00".
export function utcOffset(zone, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zoneOrDefault(zone), timeZoneName: 'longOffset' }).formatToParts(at);
  const name = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return '+00:00';
  return `${match[1]}${match[2].padStart(2, '0')}:${match[3] || '00'}`;
}

export function formatBusinessTime(iso, zone, options = {}) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zoneOrDefault(zone),
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...options,
  }).format(date);
}
