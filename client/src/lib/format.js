export function parseTimestamp(value) {
  if (!value) return null;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(value) {
  const date = parseTimestamp(value);
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(value) {
  const date = parseTimestamp(value);
  if (!date) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isTestChat(chatId) {
  return String(chatId || '').startsWith('web-test-');
}

export function chatLabel(chat) {
  if (chat?.name && chat.name !== 'Anonymous') return chat.name;
  if (isTestChat(chat?.chat_id)) return 'Test chat';
  if (String(chat?.chat_id || '').startsWith('web-')) return 'Website chat';
  return `Telegram ${chat?.chat_id ?? ''}`;
}

export function channelOf(chatId) {
  if (isTestChat(chatId)) return 'Test';
  return String(chatId || '').startsWith('web-') ? 'Web' : 'Telegram';
}

export function contactHref(contact) {
  const value = String(contact || '').trim();
  if (!value || value.toLowerCase() === 'not provided') return null;
  if (value.includes('@')) {
    return { href: `mailto:${value}`, label: 'Email them', display: value };
  }
  const digits = value.replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length >= 7) {
    return { href: `tel:${digits}`, label: 'Call them', display: value };
  }
  return null;
}

export function scoreBand(score) {
  const value = Number(score);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 7) return 'score-high';
  if (value >= 4) return 'score-mid';
  return 'score-low';
}
