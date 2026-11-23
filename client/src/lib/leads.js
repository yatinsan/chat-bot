export const LEAD_STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
];

export function statusOf(lead) {
  return LEAD_STATUSES.some((item) => item.id === lead?.status) ? lead.status : 'new';
}

export async function updateLeadStatus(chatId, status) {
  const response = await fetch(`/api/leads/${encodeURIComponent(chatId)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not change the status.');
  return data;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadLeadsCsv(leads) {
  const columns = ['name', 'contact', 'status', 'lead_score', 'service', 'stack', 'meeting_time', 'insights', 'updated_at'];
  const rows = leads.map((lead) => columns.map((key) => csvCell(key === 'status' ? statusOf(lead) : lead[key])).join(','));
  const blob = new Blob([[columns.join(','), ...rows].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
