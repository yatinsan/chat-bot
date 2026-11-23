import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BUSINESS_PROFILE, KNOWLEDGE_LIMITS, getBusinessProfile, saveBusinessProfile } from '../database.js';
import { buildSystemPrompt } from '../server/prompt.js';
import { createChatEngine } from '../server/chat-engine.js';
import { chunkText, cosine, createKnowledgeBase, keywordScores, rankChunks } from '../server/rag.js';
import { quietConsole, reply, toolCall, useTempDatabase } from './helpers.js';

let cleanup;
before(async () => { cleanup = await useTempDatabase(); });
after(async () => { await cleanup(); });

const KNOWLEDGE = [
  'Our office is in Business Bay, Dubai, open Sunday to Thursday from 9 AM to 6 PM.',
  'We build Shopify and WooCommerce stores with payment gateways like Stripe and Telr.',
  'Mobile apps are built in Flutter for Android and iOS, and we publish them to the stores.',
  'SEO packages include keyword research, technical audits, and monthly reports.',
].join('\n\n');

test('chunkText keeps paragraphs together and splits long text with overlap', () => {
  assert.deepEqual(chunkText(''), []);
  assert.equal(chunkText('Short fact.').length, 1);
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about service ${i}.`).join(' ');
  const chunks = chunkText(long, 200, 40);
  assert.ok(chunks.length > 5);
  for (const chunk of chunks) assert.ok(chunk.length <= 240, `chunk too long: ${chunk.length}`);
  assert.ok(chunks.join(' ').includes('Sentence number 39'));
});

test('keyword ranking finds the matching chunk', () => {
  const chunks = chunkText(KNOWLEDGE, 120, 0).map((content, position) => ({ content, position }));
  const scores = keywordScores('Do you make Flutter apps?', chunks);
  const best = scores.indexOf(Math.max(...scores));
  assert.match(chunks[best].content, /Flutter/);
  const top = rankChunks('what are your office hours in Dubai', chunks, null, 1);
  assert.match(top[0].content, /Business Bay/);
  assert.deepEqual(rankChunks('hello', chunks), []);
});

test('cosine handles matching, opposite and bad vectors', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(cosine([1, 0], [1, 0, 0]), 0);
  assert.equal(cosine(null, [1]), 0);
});

test('knowledge mode is saved, and RAG allows a larger knowledge base', async () => {
  const big = 'x'.repeat(KNOWLEDGE_LIMITS.prompt + 500);
  let profile = await saveBusinessProfile({ ...DEFAULT_BUSINESS_PROFILE, website_knowledge: big });
  assert.equal(profile.knowledge_mode, 'prompt');
  assert.equal(profile.website_knowledge.length, KNOWLEDGE_LIMITS.prompt);
  profile = await saveBusinessProfile({ ...DEFAULT_BUSINESS_PROFILE, knowledge_mode: 'rag', website_knowledge: big });
  assert.equal(profile.knowledge_mode, 'rag');
  assert.equal(profile.website_knowledge.length, big.length);
  profile = await saveBusinessProfile({ ...DEFAULT_BUSINESS_PROFILE, knowledge_mode: 'nonsense' });
  assert.equal(profile.knowledge_mode, 'prompt');
});

// A fake embedder: one dimension per topic word, so meaning can be checked without the API.
const TOPICS = ['office', 'shopify', 'flutter', 'seo'];
const fakeEmbed = async (texts) => texts.map((text) => TOPICS.map((word) => (text.toLowerCase().includes(word) ? 1 : 0.01)));

test('the knowledge base indexes, embeds and retrieves', async (t) => {
  quietConsole(t);
  let embedCalls = 0;
  const kb = createKnowledgeBase({ embed: async (texts) => { embedCalls += 1; return fakeEmbed(texts); } });
  const profile = await saveBusinessProfile({ ...DEFAULT_BUSINESS_PROFILE, knowledge_mode: 'rag', website_knowledge: KNOWLEDGE });
  const status = await kb.reindex(profile);
  assert.equal(status.search, 'semantic');
  assert.ok(status.chunks >= 1);
  assert.equal(status.embedded, status.chunks);

  // Same text again: nothing is re-embedded.
  const before = embedCalls;
  await kb.reindex(profile);
  assert.equal(embedCalls, before);

  const results = await kb.retrieve('Can you build my Shopify store?', { k: 1 });
  assert.equal(results.length, 1);
  assert.match(results[0].content, /Shopify/);

  // Switching back to prompt mode clears the index.
  const cleared = await kb.reindex({ ...profile, knowledge_mode: 'prompt' });
  assert.equal(cleared.chunks, 0);
});

test('a failing embedder falls back to keyword search', async (t) => {
  quietConsole(t);
  const kb = createKnowledgeBase({ embed: async () => { throw new Error('quota'); } });
  const profile = await saveBusinessProfile({ ...DEFAULT_BUSINESS_PROFILE, knowledge_mode: 'rag', website_knowledge: KNOWLEDGE });
  const status = await kb.reindex(profile, { force: true });
  assert.equal(status.search, 'keyword');
  assert.match(status.warning, /quota/);
  const results = await kb.retrieve('SEO audit');
  assert.ok(results.some((chunk) => /SEO/.test(chunk.content)));
});

test('the prompt holds retrieved chunks in RAG mode, and the full text otherwise', () => {
  const profile = { ...DEFAULT_BUSINESS_PROFILE, website_knowledge: KNOWLEDGE };
  assert.match(buildSystemPrompt(profile), /Website knowledge:\nOur office/);

  const rag = { ...profile, knowledge_mode: 'rag' };
  const prompt = buildSystemPrompt(rag, new Date(), { retrieved: [{ content: 'We build Shopify stores.' }] });
  assert.match(prompt, /Relevant knowledge/);
  assert.match(prompt, /\[1\] We build Shopify stores\./);
  assert.doesNotMatch(prompt, /Business Bay/);
  assert.match(buildSystemPrompt(rag, new Date(), { retrieved: [] }), /nothing matched the latest message/);
});

test('the engine retrieves knowledge for each customer message in RAG mode', async (t) => {
  quietConsole(t);
  await saveBusinessProfile({ ...(await getBusinessProfile()), knowledge_mode: 'rag', website_knowledge: KNOWLEDGE });
  const queries = [];
  const prompts = [];
  const engine = createChatEngine({
    completeChat: async (messages) => {
      prompts.push(messages[0].content);
      return reply({ tools: [toolCall('sendMessages', { messages: ['Sure.'] })] });
    },
    transport: { hasTelegram: false, async send() {}, startTyping: () => () => {} },
    broadcast: () => {},
    fetchPageText: async () => '',
    retrieveKnowledge: async (query) => { queries.push(query); return [{ content: 'Flutter apps for Android and iOS.' }]; },
    delays: { minMs: 0, maxMs: 0, perCharMs: 0, gapMs: 0 },
  });
  await engine.handleUserMessage('rag-chat', 'Do you build apps?', 'web');
  await engine.handleUserMessage('rag-chat', 'How long does it take?', 'web');
  assert.deepEqual(queries, ['Do you build apps?', 'Do you build apps?\nHow long does it take?']);
  assert.match(prompts.at(-1), /\[1\] Flutter apps for Android and iOS\./);
});
