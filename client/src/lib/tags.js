export const TAG_LABELS = {
  wants_meeting: 'Wants meeting',
  pending_approval: 'Pending approval',
  meeting_confirmed: 'Meeting confirmed',
  hot_lead: 'Hot lead',
};

export function tagLabel(tag) {
  return TAG_LABELS[tag] || tag;
}
