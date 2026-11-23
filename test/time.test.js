import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessToday, formatBusinessTime, isValidTimeZone, utcOffset } from '../server/time.js';

test('isValidTimeZone accepts IANA names and rejects junk', () => {
  assert.equal(isValidTimeZone('Asia/Dubai'), true);
  assert.equal(isValidTimeZone('Europe/London'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(undefined), false);
});

test('utcOffset gives the offset for the zone and date', () => {
  assert.equal(utcOffset('Asia/Dubai'), '+04:00');
  assert.equal(utcOffset('Asia/Kolkata'), '+05:30');
  assert.equal(utcOffset('UTC'), '+00:00');
  assert.equal(utcOffset('America/New_York', new Date('2026-01-15T12:00:00Z')), '-05:00');
  assert.equal(utcOffset('America/New_York', new Date('2026-07-15T12:00:00Z')), '-04:00');
});

test('businessToday uses the business zone, not the server zone', () => {
  const lateUtc = new Date('2026-11-23T22:30:00Z');
  assert.equal(businessToday('Asia/Dubai', lateUtc), 'Tuesday 2026-11-24');
  assert.equal(businessToday('America/Los_Angeles', lateUtc), 'Monday 2026-11-23');
});

test('formatBusinessTime shows the time in the given zone', () => {
  const text = formatBusinessTime('2026-11-27T12:00:00Z', 'Asia/Dubai');
  assert.match(text, /Friday/);
  assert.match(text, /4:00\s?pm/i);
  assert.equal(formatBusinessTime('not a date', 'Asia/Dubai'), '');
});
