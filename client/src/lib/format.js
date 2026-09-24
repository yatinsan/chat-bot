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

export function chatLabel(chat) {
  if (chat?.name && chat.name !== 'Anonymous') return chat.name;
  if (String(chat?.chat_id || '').startsWith('web-')) return 'Website chat';
  return `Telegram ${chat?.chat_id ?? ''}`;
}

export function channelOf(chatId) {
  return String(chatId || '').startsWith('web-') ? 'Web' : 'Telegram';
}
