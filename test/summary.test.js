import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { saveMessage } from '../database.js';
import { SUMMARY_EMPTY, buildChatSummary, parseSummaryJson, summaryPayload } from '../server/summary.js';
import { useTempDatabase } from './helpers.js';

let cleanup;
before(async () => { cleanup = await useTempDatabase(); });
after(async () => { await cleanup(); });

test('parseSummaryJson reads JSON wrapped in extra text', () => {
  assert.deepEqual(parseSummaryJson('Here you go: {"wants": "an app"} thanks'), { wants: 'an app' });
  assert.throws(() => parseSummaryJson('no json here'), /unexpected format/);
});

test('buildChatSummary sends the transcript and saves cleaned fields', async () => {
  await saveMessage('sum-1', 'user', 'I want a shop app');
  await saveMessage('sum-1', 'assistant', 'Nice, Android or iOS?');
  await saveMessage('sum-1', 'admin', 'Hi, this is the team');

  let prompt = '';
  const summary = await buildChatSummary('sum-1', async (text) => {
    prompt = text;
    return JSON.stringify({ wants: '  A shop   app ', budget: '', timeline: null, missing: 'contact' });
  });

  assert.match(prompt, /Customer: I want a shop app/);
  assert.match(prompt, /Assistant: Nice, Android or iOS\?/);
  assert.match(prompt, /Team: Hi, this is the team/);
  assert.deepEqual(summary, { wants: 'A shop app', budget: SUMMARY_EMPTY, timeline: SUMMARY_EMPTY, missing: 'contact' });

  const payload = await summaryPayload('sum-1');
  assert.deepEqual(payload.summary, summary);
  assert.equal(payload.message_count, 3);
  assert.equal(payload.current_count, 3);
});

test('an empty chat cannot be summarised', async () => {
  await assert.rejects(buildChatSummary('nobody', async () => '{}'), /no messages yet/);
});
