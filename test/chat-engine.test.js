import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { getChatHistory, getLead, getOpenMeetingForChat, saveBusinessProfile } from '../database.js';
import {
  MAX_TOOL_ROUNDS,
  bubbleDelayMs,
  createChatEngine,
  normalizeBubbles,
  orderedToolCalls,
  rememberDeliveredBubbles,
} from '../server/chat-engine.js';
import { quietConsole, reply, toolCall, useTempDatabase } from './helpers.js';

let cleanup;
before(async () => { cleanup = await useTempDatabase(); });
after(async () => { await cleanup(); });

const NO_DELAY = { minMs: 0, maxMs: 0, perCharMs: 0, gapMs: 0 };
let chatCounter = 0;
const newChatId = () => `web-test-${++chatCounter}`;

// Builds an engine whose AI answers from a script. Each script step is a reply,
// or a function (messages, request) that returns or throws.
function setup(script, { fetchPageText = async () => 'page text', delays = NO_DELAY } = {}) {
  const calls = [];
  const sent = [];
  const events = [];
  const steps = [...script];
  const engine = createChatEngine({
    completeChat: async (messages, request) => {
      calls.push(structuredClone(messages));
      const step = steps.shift();
      if (!step) throw new Error('The script ran out of replies.');
      return typeof step === 'function' ? step(messages, request) : step;
    },
    transport: {
      hasTelegram: true,
      async send(chatId, text, channel) { sent.push({ chatId, text, channel }); },
      startTyping: () => () => {},
    },
    broadcast: (event) => events.push(event),
    fetchPageText,
    delays,
  });
  return { engine, calls, sent, events, steps };
}

const delivered = (events, chatId) => events
  .filter((event) => event.type === 'message' && event.message.chat_id === chatId && event.message.role === 'assistant')
  .map((event) => event.message.content);

test('saves the lead, then delivers the bubbles in order', async (t) => {
  quietConsole(t);
  const chatId = newChatId();
  const { engine, calls, events } = setup([
    reply({
      tools: [
        toolCall('sendMessages', { messages: ['Hi, we are Pixbit.', 'Website or app?'] }),
        toolCall('updateClientContext', { service: 'website', lead_score: 4, score_reason: 'real project' }),
      ],
    }),
  ]);

  await engine.handleUserMessage(chatId, 'I need a website', 'web');

  assert.equal(calls.length, 1, 'a delivered sendMessages ends the turn');
  assert.match(calls[0][0].content, /CLIENT CONTEXT SUMMARY/);
  assert.equal(calls[0].at(-1).content, 'I need a website');

  const leadEvent = events.findIndex((event) => event.type === 'lead');
  const firstBubble = events.findIndex((event) => event.type === 'message' && event.message.role === 'assistant');
  assert.ok(leadEvent !== -1 && leadEvent < firstBubble, 'updateClientContext runs before sendMessages');

  assert.deepEqual(delivered(events, chatId), ['Hi, we are Pixbit.', 'Website or app?']);
  const lead = await getLead(chatId);
  assert.equal(lead.service, 'website');
  assert.equal(lead.lead_score, 4);
  assert.deepEqual((await getChatHistory(chatId)).map((m) => m.role), ['user', 'assistant', 'assistant']);
});

test('plain text without a tool call is still delivered', async (t) => {
  quietConsole(t);
  const chatId = newChatId();
  const { engine, events } = setup([reply({ content: 'Hello there' })]);
  await engine.handleUserMessage(chatId, 'hi', 'web');
  assert.deepEqual(delivered(events, chatId), ['Hello there']);
});

test('telegram chats are sent through the transport', async (t) => {
  quietConsole(t);
  const { engine, sent } = setup([reply({ tools: [toolCall('sendMessages', { messages: ['Hey'] })] })]);
  await engine.handleUserMessage('12345', 'hi', 'telegram');
  assert.deepEqual(sent, [{ chatId: '12345', text: 'Hey', channel: 'telegram' }]);
});

test('a website fetch gets another AI round with the page text', async (t) => {
  quietConsole(t);
  const chatId = newChatId();
  const fetched = [];
  const { engine, calls, events } = setup([
    reply({
      tools: [
        toolCall('fetchWebsiteContent', { url: 'https://example.com' }, 'fetch-1'),
        toolCall('sendMessages', { messages: ['Let me take a look...'] }),
      ],
    }),
    reply({ tools: [toolCall('sendMessages', { messages: ['Your site sells shoes.'] })] }),
  ], { fetchPageText: async (url) => { fetched.push(url); return 'We sell shoes'; } });

  await engine.handleUserMessage(chatId, 'check example.com', 'web');

  assert.deepEqual(fetched, ['https://example.com']);
  assert.equal(calls.length, 2);
  const toolResult = calls[1].find((m) => m.role === 'tool' && m.tool_call_id === 'fetch-1');
  assert.deepEqual(JSON.parse(toolResult.content), { content: 'We sell shoes' });
  assert.deepEqual(delivered(events, chatId), ['Let me take a look...', 'Your site sells shoes.']);
});

test('a failed fetch is reported to the AI as an error', async (t) => {
  quietConsole(t);
  const chatId = newChatId();
  const { engine, calls } = setup([
    reply({ tools: [toolCall('fetchWebsiteContent', { url: 'http://localhost' }, 'f')] }),
    reply({ content: 'I could not open it.' }),
  ], { fetchPageText: async () => { throw new Error('That website address is not allowed.'); } });

  await engine.handleUserMessage(chatId, 'check localhost', 'web');
  const toolResult = calls[1].find((m) => m.role === 'tool');
  assert.deepEqual(JSON.parse(toolResult.content), { error: 'That website address is not allowed.' });
});

test('an empty sendMessages asks the AI again', async (t) => {
  quietConsole(t);
  const chatId = newChatId();
  const { engine, calls, events } = setup([
    reply({ tools: [toolCall('sendMessages', { messages: ['', '  '] }, 's')] }),
    reply({ tools: [toolCall('sendMessages', { messages: ['Fixed'] })] }),
  ]);
  await engine.handleUserMessage(chatId, 'hi', 'web');
  assert.equal(calls.length, 2);
  assert.match(calls[1].find((m) => m.role === 'tool').content, /non-empty array/);
  assert.deepEqual(delivered(events, chatId), ['Fixed']);
});

test('the loop stops after MAX_TOOL_ROUNDS', async (t) => {
  quietConsole(t);
  const chatId = newChatId();
  const save = () => reply({ tools: [toolCall('updateClientContext', { insights: 'still thinking' })] });
  const { engine, calls } = setup(Array.from({ length: MAX_TOOL_ROUNDS + 3 }, save));
  await engine.handleUserMessage(chatId, 'hi', 'web');
  assert.equal(calls.length, MAX_TOOL_ROUNDS + 1);
});

test('an AI error sends the apology message', async (t) => {
  quietConsole(t);
  const chatId = newChatId();
  const { engine, events } = setup([() => { throw new Error('quota exceeded'); }]);
  await engine.handleUserMessage(chatId, 'hi', 'web');
  assert.deepEqual(delivered(events, chatId), ['Sorry, something went wrong on my side. Send that again?']);
});

test('requestMeeting stores the profile time zone and updates the open request', async (t) => {
  quietConsole(t);
  await saveBusinessProfile({ timezone: 'Europe/London' });
  t.after(() => saveBusinessProfile({ timezone: 'Asia/Dubai' }));
  const chatId = newChatId();
  const { engine } = setup([
    reply({ tools: [toolCall('requestMeeting', { preferred_text: 'Friday 4 PM', preferred_at: '2026-11-27T16:00:00+00:00' })] }),
    reply({ content: 'I will check with the team.' }),
    reply({ tools: [toolCall('requestMeeting', { preferred_text: 'Monday 10 AM' })] }),
    reply({ content: 'Noted.' }),
  ]);

  await engine.handleUserMessage(chatId, 'Friday 4pm works', 'web');
  const first = await getOpenMeetingForChat(chatId);
  assert.equal(first.timezone, 'Europe/London');
  assert.equal(first.preferred_at, '2026-11-27T16:00:00.000Z');
  assert.equal((await getLead(chatId)).meeting_time, 'Friday 4 PM');

  await engine.handleUserMessage(chatId, 'actually Monday 10am', 'web');
  const second = await getOpenMeetingForChat(chatId);
  assert.equal(second.id, first.id, 'a changed time updates the same request');
  assert.equal(second.preferred_text, 'Monday 10 AM');
});

test('a new message cancels the turn that is still running', async (t) => {
  quietConsole(t);
  const chatId = newChatId();
  let releaseFirst;
  const firstStarted = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const { engine, events } = setup([
    (_messages, request) => new Promise((_resolve, reject) => {
      releaseFirst();
      request.abortController.signal.addEventListener('abort', () => reject(new Error('ABORTED')));
    }),
    reply({ tools: [toolCall('sendMessages', { messages: ['Answer to the second message'] })] }),
  ]);

  const first = engine.handleUserMessage(chatId, 'first', 'web');
  await firstStarted;
  await engine.handleUserMessage(chatId, 'second', 'web');
  await first;

  assert.deepEqual(delivered(events, chatId), ['Answer to the second message']);
});

test('team messages reach the customer and the AI history', async (t) => {
  quietConsole(t);
  const chatId = newChatId();
  const { engine, calls } = setup([
    reply({ content: 'Hi!' }),
    reply({ content: 'Sure.' }),
  ]);
  await engine.handleUserMessage(chatId, 'hi', 'web');
  await engine.sendTeamMessage(chatId, 'This is Omar from the team.');
  await engine.handleUserMessage(chatId, 'thanks', 'web');

  const roles = (await getChatHistory(chatId)).map((m) => m.role);
  assert.deepEqual(roles, ['user', 'assistant', 'admin', 'user', 'assistant']);
  assert.ok(calls[1].some((m) => m.role === 'assistant' && m.content === 'This is Omar from the team.'));
});

test('forgetChat drops the in-memory history', async (t) => {
  quietConsole(t);
  const chatId = newChatId();
  const { engine } = setup([reply({ content: 'Hi!' })]);
  await engine.handleUserMessage(chatId, 'hi', 'web');
  assert.ok(engine.histories[chatId]);
  engine.forgetChat(chatId);
  assert.equal(engine.histories[chatId], undefined);
});

test('normalizeBubbles trims, drops repeats and caps at three', () => {
  assert.equal(normalizeBubbles('hello'), null);
  assert.deepEqual(normalizeBubbles([' a ', 'a', '', { text: 'b' }, 7, 'c', 'd']), ['a', 'b', '7']);
});

test('orderedToolCalls puts sendMessages last', () => {
  const calls = [toolCall('sendMessages', {}, '1'), toolCall('updateClientContext', {}, '2'), toolCall('requestMeeting', {}, '3')];
  assert.deepEqual(orderedToolCalls(calls).map((c) => c.id), ['2', '3', '1']);
});

test('bubbleDelayMs grows with length inside the limits', () => {
  const delays = { minMs: 100, maxMs: 500, perCharMs: 10, gapMs: 0 };
  assert.equal(bubbleDelayMs('', delays), 100);
  assert.equal(bubbleDelayMs('x'.repeat(20), delays), 300);
  assert.equal(bubbleDelayMs('x'.repeat(200), delays), 500);
});

test('rememberDeliveredBubbles keeps seen bubbles before the newer message', () => {
  const history = [{ role: 'system', content: 's' }, { role: 'user', content: 'first' }, { role: 'user', content: 'second' }];
  rememberDeliveredBubbles(history, ['Hello'], 2);
  assert.deepEqual(history.map((m) => m.content), ['s', 'first', 'Hello', 'second']);
});
