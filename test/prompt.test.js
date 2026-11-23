import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BUSINESS_PROFILE } from '../database.js';
import { AI_TOOLS, buildSystemPrompt } from '../server/prompt.js';

const now = new Date('2026-07-01T09:00:00Z');

test('the default profile keeps Dubai and +04:00', () => {
  const prompt = buildSystemPrompt(DEFAULT_BUSINESS_PROFILE, now);
  assert.match(prompt, /business time zone Asia\/Dubai, currently UTC\+04:00/);
  assert.match(prompt, /Pixbit Solutions/);
});

test('the prompt follows the time zone set on the profile', () => {
  const prompt = buildSystemPrompt({ ...DEFAULT_BUSINESS_PROFILE, company_name: 'Acme', location: 'London', timezone: 'Europe/London' }, now);
  assert.match(prompt, /business time zone Europe\/London, currently UTC\+01:00/);
  assert.match(prompt, /Europe\/London offset for that date \(today it is \+01:00\)/);
  assert.doesNotMatch(prompt, /\+04:00/);
  assert.doesNotMatch(prompt, /Dubai/);
});

test('an invalid stored zone falls back to the default', () => {
  const prompt = buildSystemPrompt({ ...DEFAULT_BUSINESS_PROFILE, timezone: 'Nowhere/Land' }, now);
  assert.match(prompt, /Asia\/Dubai/);
});

test('tool definitions do not hard-code an offset', () => {
  assert.doesNotMatch(JSON.stringify(AI_TOOLS), /\+04:00/);
  assert.deepEqual(AI_TOOLS.map((tool) => tool.function.name), ['sendMessages', 'fetchWebsiteContent', 'updateClientContext', 'requestMeeting']);
});
