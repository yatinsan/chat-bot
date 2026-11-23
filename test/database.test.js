import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMeeting,
  decideMeeting,
  deleteChat,
  isAiPaused,
  setAiPaused,
  getBusinessProfile,
  getChatHistory,
  getChatSummary,
  getEnquiries,
  getLead,
  getMessageCount,
  getOpenMeetingForChat,
  getStats,
  listChats,
  listMeetings,
  promoteLeadToMeeting,
  saveBusinessProfile,
  saveChatSummary,
  saveMessage,
  setLeadStatus,
  upsertLead,
} from '../database.js';
import { useTempDatabase } from './helpers.js';

let cleanup;
before(async () => { cleanup = await useTempDatabase(); });
after(async () => { await cleanup(); });

test('upsertLead fills defaults, then merges new details', async () => {
  await upsertLead('lead-1', { service: 'website' });
  let lead = await getLead('lead-1');
  assert.equal(lead.name, 'Anonymous');
  assert.equal(lead.contact, 'Not provided');
  assert.equal(lead.service, 'website');
  assert.equal(lead.status, 'new');

  await upsertLead('lead-1', { name: 'Sara', contact: 'sara@example.com' });
  lead = await getLead('lead-1');
  assert.equal(lead.name, 'Sara');
  assert.equal(lead.service, 'website', 'earlier details are kept');
});

test('insights are appended once each', async () => {
  await upsertLead('lead-2', { insights: 'Wants a shop' });
  await upsertLead('lead-2', { insights: 'Wants a shop' });
  await upsertLead('lead-2', { insights: 'Needs Arabic' });
  assert.equal((await getLead('lead-2')).insights, '- Wants a shop\n- Needs Arabic');
});

test('lead_score is rounded and kept between 1 and 10', async () => {
  await upsertLead('lead-3', { lead_score: 14 });
  assert.equal((await getLead('lead-3')).lead_score, 10);
  await upsertLead('lead-3', { lead_score: '6.6' });
  assert.equal((await getLead('lead-3')).lead_score, 7);
  await upsertLead('lead-3', { lead_score: -2 });
  assert.equal((await getLead('lead-3')).lead_score, 1);
  await upsertLead('lead-3', { lead_score: 'high' });
  assert.equal((await getLead('lead-3')).lead_score, 1, 'a non-number leaves the score alone');
});

test('setLeadStatus checks the stage and the lead', async () => {
  await upsertLead('lead-4', {});
  assert.equal((await setLeadStatus('lead-4', 'contacted')).status, 'contacted');
  await assert.rejects(setLeadStatus('lead-4', 'maybe'), /status must be one of/);
  assert.equal(await setLeadStatus('missing-lead', 'won'), null);
});

test('promoteLeadToMeeting moves forward but never out of won or lost', async () => {
  await upsertLead('lead-5', {});
  await promoteLeadToMeeting('lead-5');
  assert.equal((await getLead('lead-5')).status, 'meeting');

  await upsertLead('lead-6', {});
  await setLeadStatus('lead-6', 'won');
  await promoteLeadToMeeting('lead-6');
  assert.equal((await getLead('lead-6')).status, 'won');
});

test('the business profile stores a time zone and rejects bad ones', async () => {
  const fresh = await getBusinessProfile();
  assert.equal(fresh.timezone, 'Asia/Dubai');

  const saved = await saveBusinessProfile({ company_name: 'Acme', timezone: 'Europe/London' });
  assert.equal(saved.company_name, 'Acme');
  assert.equal(saved.timezone, 'Europe/London');
  assert.equal(saved.location, 'Dubai', 'missing fields fall back to defaults');

  await assert.rejects(saveBusinessProfile({ timezone: 'Mars/Olympus' }), /not a time zone/);
  assert.equal((await getBusinessProfile()).timezone, 'Europe/London', 'a rejected save changes nothing');

  assert.equal((await saveBusinessProfile({ company_name: 'Acme', timezone: '' })).timezone, 'Asia/Dubai');
});

test('profile text is trimmed to its limit', async () => {
  const saved = await saveBusinessProfile({ about: 'x'.repeat(5000) });
  assert.equal(saved.about.length, 4000);
});

test('meetings: open request, decision, and conflict flag', async () => {
  const at = '2026-11-27T12:00:00.000Z';
  const first = await createMeeting('m-1', { preferred_text: 'Friday 4 PM', preferred_at: at, timezone: 'Asia/Dubai' });
  await createMeeting('m-2', { preferred_text: 'Friday at 4', preferred_at: at, timezone: 'Asia/Dubai' });
  assert.equal(first.status, 'pending');
  assert.equal((await getOpenMeetingForChat('m-1')).id, first.id);

  let rows = await listMeetings();
  assert.equal(rows.find((row) => row.chat_id === 'm-1').conflict, true);

  await decideMeeting(first.id, 'rejected');
  assert.equal(await getOpenMeetingForChat('m-1'), undefined);
  rows = await listMeetings();
  assert.equal(rows.find((row) => row.chat_id === 'm-2').conflict, false, 'a rejected meeting no longer conflicts');
});

test('messages, chat list tags and stats', async () => {
  await saveMessage('chat-1', 'user', 'hi');
  await saveMessage('chat-1', 'assistant', 'hello');
  await upsertLead('chat-1', { lead_score: 8 });
  await createMeeting('chat-1', { preferred_text: 'Monday' });

  assert.deepEqual((await getChatHistory('chat-1')).map((m) => m.content), ['hi', 'hello']);
  assert.equal(await getMessageCount('chat-1'), 2);

  const chat = (await listChats()).find((row) => row.chat_id === 'chat-1');
  assert.equal(chat.last_message, 'hello');
  assert.deepEqual(chat.tags, ['wants_meeting', 'pending_approval', 'hot_lead']);

  const enquiry = (await getEnquiries()).find((row) => row.chat_id === 'chat-1');
  assert.ok(enquiry.tags.includes('hot_lead'));

  const stats = await getStats();
  assert.ok(stats.messages >= 2);
  assert.ok(stats.pending_meetings >= 1);
});

test('chat summaries round-trip as JSON', async () => {
  assert.equal(await getChatSummary('chat-s'), null);
  await saveChatSummary('chat-s', { wants: 'An app' }, 4);
  const saved = await getChatSummary('chat-s');
  assert.deepEqual(saved.summary, { wants: 'An app' });
  assert.equal(saved.message_count, 4);
});

test('deleteChat removes messages, meetings and the lead', async () => {
  await saveMessage('chat-del', 'user', 'bye');
  await upsertLead('chat-del', {});
  await createMeeting('chat-del', { preferred_text: 'Tuesday' });
  await deleteChat('chat-del');
  assert.equal(await getLead('chat-del'), undefined);
  assert.equal(await getMessageCount('chat-del'), 0);
  assert.equal((await listMeetings()).some((row) => row.chat_id === 'chat-del'), false);
});

test('the AI pause switch is stored per chat and shows as a tag', async () => {
  await saveMessage('pause-1', 'user', 'hi');
  assert.equal(await isAiPaused('pause-1'), false);
  assert.equal(await setAiPaused('pause-1', true), true);
  const chat = (await listChats()).find((row) => row.chat_id === 'pause-1');
  assert.equal(chat.ai_paused, true);
  assert.ok(chat.tags.includes('ai_paused'));

  assert.equal(await setAiPaused('pause-1', false), false);
  assert.equal((await listChats()).find((row) => row.chat_id === 'pause-1').ai_paused, false);

  await setAiPaused('pause-1', true);
  await deleteChat('pause-1');
  assert.equal(await isAiPaused('pause-1'), false, 'deleting a chat clears the switch');
});
