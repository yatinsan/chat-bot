import { createServer } from 'http';
import path from 'path';
import { randomUUID } from 'crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { WebSocketServer, WebSocket } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
// import { Ollama } from 'ollama';
import dotenv from 'dotenv';
import express from 'express';
import { load as loadHtml } from 'cheerio';
import { initDB, upsertLead, getEnquiries, saveMessage, getChatHistory, getLead, listChats, getStats, deleteChat, getBusinessProfile, saveBusinessProfile, DEFAULT_BUSINESS_PROFILE, BUSINESS_LIMITS, createMeeting, getMeeting, getOpenMeetingForChat, updateMeetingRequest, decideMeeting, listMeetings, getMessageCount, getChatSummary, saveChatSummary, setLeadStatus, promoteLeadToMeeting } from './database.js';

// Meetings are proposed in the customer's local time. One zone for the whole business.
const BUSINESS_TZ = 'Asia/Dubai';

// Today's date in the business zone, with the year, e.g. "Tuesday 2026-11-17".
function businessToday() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TZ, weekday: 'long' }).format(now);
  return `${weekday} ${date}`;
}

function formatBusinessTime(iso, options = {}) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...options,
  }).format(date);
}

// Load environment variables
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
// const ollamaModel = process.env.OLLAMA_MODEL || 'gemma4:12b';
const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim();
const geminiModel = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const useGemini = geminiApiKey.length > 0;

if (!token) {
  console.warn('TELEGRAM_BOT_TOKEN is not set. Website chat still works; Telegram replies are disabled.');
}

const bot = token ? new TelegramBot(token, { polling: true }) : null;

// Initialize Ollama client
// const ollama = new Ollama();

function isUntouchedProfile(profile) {
  return Object.keys(DEFAULT_BUSINESS_PROFILE).every((key) => profile[key] === DEFAULT_BUSINESS_PROFILE[key]);
}

function businessFacts(profile) {
  const about = profile.about.trim();
  const knowledge = profile.website_knowledge.trim();
  if (!about && !knowledge) return '';
  const lines = ['', 'BUSINESS FACTS (private. Do not invent prices, clients, or claims that are not here):'];
  if (about) lines.push(`About: ${about}`);
  if (knowledge) lines.push('Website knowledge:', knowledge);
  return `\n${lines.join('\n')}\n`;
}

function buildSystemPrompt(profile) {
  const untouched = isUntouchedProfile(profile);
  const name = untouched ? 'Pixbit' : profile.company_name;
  const fullName = untouched ? 'Pixbit Solutions' : profile.company_name;
  const services = profile.services.trim();
  const prompt = `
You text customers for ${fullName} in ${profile.location} (${profile.website}) the way a business development manager would. Speak as "we" for ${name}. You are warm and specific. You are not a form, and you do not sound like a script.

TODAY: ${businessToday()} (business time zone ${BUSINESS_TZ}). Use this to work out dates like "Friday" or "next week", and always use this year.

What you can talk about:
${services}

VOICE:
- Text like a person on WhatsApp, a business development colleague at ${name}. Professional and approachable. Not a script, and not a help desk.
- In one sendMessages call, send 1 to 3 separate bubbles. Most turns are 2. A simple acknowledgement can be one bubble. Do not force three.
- Length follows what they just wrote. A short "hi" gets a short reply. If they explain their shop in a paragraph, the first bubble can be a few sentences that actually respond to what they said, then a shorter bubble with one question.
- Do not make every bubble the same size. Do not pad. Do not write an essay. One question per turn, in the last bubble.
- Use a natural acknowledgement when it fits ("Got it", "Oh, nice"). Match their tone: casual if they are casual, plain and polite if they are formal.
- Occasional conversational phrasing is fine. Emoji only rarely, never more than one, and only if they used one first.
- Do not echo their whole message back. Do not ask for something already in the client context.
- No bullet lists, no "Certainly", no "How may I assist you", and no mention of tools, scores, dashboards, or notes.
- Do not claim to be a human, and do not invent personal stories. Do not bring up that this chat is automated. If they ask directly whether it is a bot or AI, answer honestly in one short bubble: the chat is automated, and the team follows up.
- Do not invent prices, timelines, rankings, client names, or booked meetings.
- Do not rush. Answer what they just asked before you ask for the next detail. Never ask for a phone or email in the same turn as a price question.

WHAT THE CUSTOMER SEES:
- The customer only sees text you pass to sendMessages.
- On every turn that adds a detail, call updateClientContext first, then sendMessages, in the same turn.
- If a turn has nothing new to save, still call sendMessages.

FIRST MESSAGE:
- If it is only a greeting, send two short messages in one sendMessages call.
- First message: greet them and say we are ${name}, in your own words. Do not reuse one fixed sentence. No "How may I assist you today?"
- Second message: ask what they need, in your own words. A website, a mobile app, or both is the usual question, but phrase it freshly each time.
- If they already named a project, still say who we are, then answer what they described in your own words. If they wrote a lot, that first bubble can be longer. Then ask the next missing detail instead of the opening question.

ASK IN THIS ORDER, and skip anything already in the client context. One missing item per turn, and only when they are not asking something else:
1. Website, mobile app, or both
2. Main features or platform
3. Rough timeline, only if they seem serious
4. A call or meeting with the team
5. Their name and a phone or email, after they are open to a call

PRICE:
- If they ask what it costs, do not give a number.
- The first message says it depends on the features, in your own words. If they already described the shop, mention that scope (catalog, checkout, and so on) so the answer feels specific. This bubble can be a bit longer than a one-liner.
- The next message offers a call or a meeting so we can discuss the details and the price there. Do not ask for a phone number or email in that turn.
- Phrase both messages freshly. Do not reuse one fixed sentence.

PRIVATE SCORE:
- Whenever you call updateClientContext, set lead_score from 1 to 10 and a one-line score_reason. Rescore when new details arrive. Never put the number or the reason in sendMessages.
- 1-3: only a greeting, vague, or spam
- 4-6: a real project (website or mobile app) but no phone or email
- 7-10: a specific project, some stack or scope, and a phone or email

WEBSITES:
- If they ask about a website, call fetchWebsiteContent for that URL. You may also sendMessages ["Let me take a look..."] in that same turn.
- After the page text comes back, sendMessages with what you actually found. Do not describe the page before that tool result.
- If the fetch fails, say you could not open it.

MEETING:
- A call or meeting comes before you ask how to reach them.
- When they agree to a call, ask: are you okay with a date, or what time works for you? Do not offer a list of open slots.
- When they give a day or time, call requestMeeting with preferred_text (their words) and, when you can work out the exact date, preferred_at as ISO 8601 with the +04:00 offset. Then send one short message saying you will discuss it with the team and get back to them.
- Never say the meeting is booked, confirmed, approved, or fixed. Only the team confirms it, and they will message the customer.
- If the customer changes the time before it is confirmed, call requestMeeting again with the new time.
- Ask for a name and a phone or email after the call is the plan, not before.

STOP:
- Spam, insults, or job seekers get one short polite reply, a score of 1, and no more qualifying questions.
- Never repeat the same information in consecutive messages. Do not ask for something already saved.
`;
  return `${prompt.replace(/\s*$/, '\n')}${businessFacts(profile)}`;
}

const app = express();
app.use(express.json({ limit: '64kb' }));
const publicDir = path.resolve('public');

app.get('/', (_req, res) => {
  res.redirect('/admin');
});

app.get(['/admin', '/chat'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(express.static(publicDir));

app.get('/api/enquiries', async (req, res) => {
  try {
    const enquiries = await getEnquiries();
    res.json(enquiries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/messages/:chatId', async (req, res) => {
  try {
    const messages = await getChatHistory(req.params.chatId);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chats', async (req, res) => {
  try {
    res.json(await listChats());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    res.json(await getStats());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/settings', async (_req, res) => {
  try {
    res.json(await getBusinessProfile());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'Settings must be an object.' });
      return;
    }
    res.json(await saveBusinessProfile(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/settings/scrape', async (req, res) => {
  try {
    const scraped = await scrapeWebsite(req.body?.url);
    res.json(scraped);
  } catch (error) {
    const status = error.statusCode || 400;
    res.status(status).json({ error: error.message });
  }
});

app.delete('/api/leads/:chatId', async (req, res) => {
  try {
    const chatId = String(req.params.chatId);
    if (activeRequests[chatId]) {
      activeRequests[chatId].aborted = true;
      activeRequests[chatId].abortController?.abort();
    }
    delete chatHistories[chatId];
    await deleteChat(chatId);
    broadcast({ type: 'lead_deleted', chatId });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/leads/:chatId/status', async (req, res) => {
  try {
    const lead = await setLeadStatus(String(req.params.chatId), String(req.body?.status || ''));
    if (!lead) {
      res.status(404).json({ error: 'Lead not found.' });
      return;
    }
    broadcast({ type: 'lead', lead });
    res.json(lead);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Conversation summary for the team. Uses only what the chat says; anything else is "Not mentioned yet".
const SUMMARY_MAX_MESSAGES = 60;
const SUMMARY_EMPTY = 'Not mentioned yet';

function cleanSummaryField(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return text || SUMMARY_EMPTY;
}

function parseSummaryJson(content) {
  const text = String(content || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('The summary came back in an unexpected format.');
  }
}

async function buildChatSummary(chatId) {
  if (!geminiApiKey) throw new Error('GEMINI_API_KEY is not set.');
  const history = (await getChatHistory(chatId))
    .filter((message) => ['user', 'assistant', 'admin'].includes(message.role))
    .slice(-SUMMARY_MAX_MESSAGES);
  if (history.length === 0) throw new Error('This chat has no messages yet.');

  const transcript = history
    .map((message) => {
      const who = message.role === 'user' ? 'Customer' : message.role === 'admin' ? 'Team' : 'Assistant';
      return `${who}: ${message.content}`;
    })
    .join('\n');

  const prompt = `Summarise this sales chat for the team. Use only facts the chat states. If something is not stated, write "${SUMMARY_EMPTY}".
Reply with JSON only, with exactly these keys:
{"wants": "what the customer wants built, one short line", "budget": "budget or price range they mentioned", "timeline": "when they need it", "missing": "what we still need to ask or confirm, e.g. contact, scope, decision maker"}

CHAT:
${transcript}`;

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${geminiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: geminiModel,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(geminiErrorDetail(data) || 'Could not create the summary.');

  const parsed = parseSummaryJson(data.choices?.[0]?.message?.content);
  const summary = {
    wants: cleanSummaryField(parsed.wants),
    budget: cleanSummaryField(parsed.budget),
    timeline: cleanSummaryField(parsed.timeline),
    missing: cleanSummaryField(parsed.missing),
  };
  await saveChatSummary(chatId, summary, await getMessageCount(chatId));
  return summary;
}

async function summaryPayload(chatId) {
  const [saved, currentCount] = await Promise.all([getChatSummary(chatId), getMessageCount(chatId)]);
  return {
    summary: saved?.summary ?? null,
    message_count: saved?.message_count ?? null,
    current_count: currentCount,
    updated_at: saved?.updated_at ?? null,
  };
}

app.get('/api/chats/:chatId/summary', async (req, res) => {
  try {
    res.json(await summaryPayload(String(req.params.chatId)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chats/:chatId/summary', async (req, res) => {
  try {
    const chatId = String(req.params.chatId);
    await buildChatSummary(chatId);
    res.json(await summaryPayload(chatId));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/meetings', async (_req, res) => {
  try {
    res.json(await listMeetings());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Team decision on a meeting request. The customer is told right away in the same chat.
app.post('/api/meetings/:id/decision', async (req, res) => {
  try {
    const meeting = await getMeeting(req.params.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting request not found.' });
      return;
    }
    if (!['pending', 'countered'].includes(meeting.status)) {
      res.status(409).json({ error: `This request is already ${meeting.status}.` });
      return;
    }

    const decision = String(req.body?.decision || '');
    const when = meeting.preferred_at ? formatBusinessTime(meeting.preferred_at) : meeting.preferred_text;
    let status;
    let text;
    let proposed = null;

    if (decision === 'approve') {
      status = 'confirmed';
      text = `Great, we're on for ${when}. We'll see you then.`;
    } else if (decision === 'reject') {
      status = 'rejected';
      text = "Sorry, that time doesn't work on our side. Could you share another day or time that suits you?";
    } else if (decision === 'counter') {
      proposed = String(req.body?.proposed_text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!proposed) {
        res.status(400).json({ error: 'Type the time you want to suggest.' });
        return;
      }
      status = 'countered';
      text = `How about ${proposed}? Let us know if that works for you.`;
    } else {
      res.status(400).json({ error: 'decision must be approve, reject, or counter.' });
      return;
    }

    await sendTeamMessage(meeting.chat_id, text);
    await decideMeeting(meeting.id, status, proposed);
    if (status === 'confirmed') await promoteLeadToMeeting(meeting.chat_id);
    const updated = await getMeeting(meeting.id);
    broadcast({ type: 'meeting', meeting: updated });
    const lead = await getLead(meeting.chat_id);
    if (lead) broadcast({ type: 'lead', lead });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(event) {
  const data = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

function sendTo(socket, event) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

const chatHistories = {};
const MAX_HISTORY_LENGTH = 20;
const MAX_BUBBLES = 3;
const MAX_TOOL_ROUNDS = 4;
const BUBBLE_GAP_MS = 200;

function readNonNegativeMs(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const MESSAGE_DELAY_MIN_MS = readNonNegativeMs('MESSAGE_DELAY_MIN_MS', 350);
const MESSAGE_DELAY_MAX_MS = readNonNegativeMs('MESSAGE_DELAY_MAX_MS', 1100);
const MESSAGE_DELAY_PER_CHAR_MS = readNonNegativeMs('MESSAGE_DELAY_PER_CHAR_MS', 12);

console.log('🤖 Assistant Bot (Tool Calling Edition) is starting...');
if (useGemini) {
  console.log(`Using Gemini model: ${geminiModel}`);
} else {
  console.warn('GEMINI_API_KEY is not set. Chat replies need a Gemini key.');
}

// Define the Ollama Tools JSON Schema
const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'sendMessages',
      description: 'Sends one or more text messages to the user (Telegram or the website chat). ALWAYS pass an array so each string is its own chat bubble, sent in order. At most 3 bubbles are delivered. Empty and duplicate strings are skipped. Bubble length should vary with what the customer just wrote.',
      parameters: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: { type: 'string' },
            description: 'Chat bubbles to send in order. Each string is one bubble. Length can vary: a short line, or a few sentences when they shared a lot. Usually 1 to 3 bubbles.'
          }
        },
        required: ['messages']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetchWebsiteContent',
      description: 'Fetches text content from a given website URL to answer user questions about a website.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch (must include http or https)'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'updateClientContext',
      description: 'Saves what the customer needs and a private 1-10 lead score. Call this whenever they mention a project, stack, name, or contact. Never tell the customer the score.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the client if known' },
          contact: { type: 'string', description: 'Contact details (email/phone) if known' },
          insights: { type: 'string', description: 'A short, useful note/insight from the latest message (e.g., "Wants a mobile app", "Budget customer")' },
          service: { type: 'string', description: 'What they want built: website, mobile app, or both' },
          stack: { type: 'string', description: 'Tech stack, platform, or main features they mentioned' },
          lead_score: { type: 'number', description: 'Private 1-10 score for how real this client feels. Never show this to the customer.' },
          score_reason: { type: 'string', description: 'One private line explaining the score. Never send this to the customer.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'requestMeeting',
      description: 'Records a call or meeting day/time the customer proposed. The team approves or rejects it later. Call this only when the customer gives a day or time. Never confirm the meeting to the customer.',
      parameters: {
        type: 'object',
        properties: {
          preferred_text: { type: 'string', description: 'What the customer said, in their words, e.g. "Friday 4 PM"' },
          preferred_at: { type: 'string', description: 'Exact date and time as ISO 8601 with the +04:00 offset, only when you can work it out from TODAY' },
          note: { type: 'string', description: 'Short private note, e.g. "wants to talk pricing"' }
        },
        required: ['preferred_text']
      }
    }
  }
];

const activeRequests = {};

const SCRAPE_TIMEOUT_MS = 12000;
const SCRAPE_MAX_BYTES = 1_500_000;
const SCRAPE_MIN_TEXT = 400;

function extractPage(html, limit) {
  const $ = loadHtml(html);
  const siteName = String($('meta[property="og:site_name"]').attr('content') || '').replace(/\s+/g, ' ').trim();
  const title = $('title').first().text().replace(/\s+/g, ' ').trim();
  const description = String(
    $('meta[name="description"]').attr('content')
    || $('meta[property="og:description"]').attr('content')
    || ''
  ).replace(/\s+/g, ' ').trim();
  const headings = [];
  $('h1, h2').each((_, el) => {
    const heading = $(el).text().replace(/\s+/g, ' ').trim();
    if (heading && !headings.includes(heading)) headings.push(heading);
  });
  $('script, style, noscript, svg').remove();
  $('p, div, h1, h2, h3, h4, li, tr, br, section, article').append(' ');
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, limit);
  return { title, description, siteName, headings: headings.slice(0, 12), text };
}

function visiblePageText(html) {
  return extractPage(html, 1500).text;
}

function cleanCompanyName(value) {
  const piece = String(value || '').replace(/\s+/g, ' ').trim();
  if (piece.length < 2 || /^(home|welcome|index|untitled)$/i.test(piece)) return '';
  return piece.slice(0, BUSINESS_LIMITS.company_name);
}

function companyFromTitle(title) {
  const parts = String(title || '')
    .split(/\s+\|\s+|\s+[-–—]\s+/)
    .map((part) => cleanCompanyName(part))
    .filter(Boolean);
  if (!parts.length) return '';
  const compact = parts.find((part) => part.length <= 40 && part.split(/\s+/).length <= 4);
  return compact || parts[0];
}

function suggestCompanyName(extracted) {
  return cleanCompanyName(extracted.siteName) || companyFromTitle(extracted.title);
}

function isPrivateIp(ip) {
  const normalized = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized.startsWith('::ffff:')) return isPrivateIp(normalized.slice(7));
  if (normalized.includes(':')) {
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fe80:')) return true;
    return normalized.startsWith('fc') || normalized.startsWith('fd');
  }
  const parts = normalized.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function assertPublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    const error = new Error('Enter a valid http or https website.');
    error.statusCode = 400;
    throw error;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const error = new Error('Only http and https websites can be scraped.');
    error.statusCode = 400;
    throw error;
  }
  if (url.username || url.password) {
    const error = new Error('Website addresses cannot include a username or password.');
    error.statusCode = 400;
    throw error;
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    const error = new Error('That website address is not allowed.');
    error.statusCode = 400;
    throw error;
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) {
      const error = new Error('That website address is not allowed.');
      error.statusCode = 400;
      throw error;
    }
  } else {
    let records = [];
    try {
      records = await lookup(host, { all: true, verbatim: true });
    } catch {
      const error = new Error('Could not find that website.');
      error.statusCode = 400;
      throw error;
    }
    if (!records.length || records.some((record) => isPrivateIp(record.address))) {
      const error = new Error('That website address is not allowed.');
      error.statusCode = 400;
      throw error;
    }
  }
  return url;
}

async function readLimitedText(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    return text.slice(0, SCRAPE_MAX_BYTES);
  }
  const chunks = [];
  let received = 0;
  while (received < SCRAPE_MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    chunks.push(Buffer.from(value));
  }
  try { await reader.cancel(); } catch { /* The extra bytes are discarded. */ }
  return Buffer.concat(chunks).subarray(0, SCRAPE_MAX_BYTES).toString('utf8');
}

async function fetchPageHtml(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
    try {
      const response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BusinessProfileBot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel?.().catch(() => {});
        if (!location) throw new Error('The website redirected without a destination.');
        current = await assertPublicHttpUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new Error(`The website returned ${response.status}.`);
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > SCRAPE_MAX_BYTES) {
        throw new Error('That page is too large to scrape.');
      }
      return await readLimitedText(response);
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The website took too long to respond.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('That website redirected too many times.');
}

async function launchBrowser(puppeteer) {
  try {
    return await puppeteer.launch({ headless: true, channel: 'chrome' });
  } catch {
    return puppeteer.launch({ headless: true });
  }
}

async function renderPageHtml(target) {
  const loaded = await import('puppeteer');
  const puppeteer = loaded.default || loaded;
  const browser = await launchBrowser(puppeteer);
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      try {
        const reqUrl = request.url();
        if (request.isNavigationRequest() && (reqUrl.startsWith('http://') || reqUrl.startsWith('https://'))) {
          await assertPublicHttpUrl(reqUrl);
        }
        await request.continue();
      } catch {
        await request.abort().catch(() => {});
      }
    });
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 15000 });
    await assertPublicHttpUrl(page.url());
    return await page.content();
  } finally {
    await browser.close();
  }
}

function knowledgeFromPage(extracted) {
  const parts = [];
  if (extracted.title) parts.push(`Title: ${extracted.title}`);
  if (extracted.description) parts.push(`Description: ${extracted.description}`);
  if (extracted.headings.length) parts.push(`Headings: ${extracted.headings.join(' | ')}`);
  if (extracted.text) parts.push(extracted.text);
  let knowledge = parts.join('\n').trim();
  let trimmed = false;
  if (knowledge.length > BUSINESS_LIMITS.website_knowledge) {
    knowledge = knowledge.slice(0, BUSINESS_LIMITS.website_knowledge).trim();
    trimmed = true;
  }
  return { knowledge, trimmed };
}

async function scrapeWebsite(rawUrl) {
  let value = String(rawUrl || '').trim();
  if (!value) {
    const error = new Error('Enter a website address.');
    error.statusCode = 400;
    throw error;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  const url = await assertPublicHttpUrl(value);

  let warning = '';
  let html = '';
  let fetchError = null;
  try {
    html = await fetchPageHtml(url);
  } catch (error) {
    fetchError = error;
  }

  let extracted = html
    ? extractPage(html, BUSINESS_LIMITS.website_knowledge)
    : { title: '', siteName: '', description: '', headings: [], text: '' };

  if (extracted.text.length < SCRAPE_MIN_TEXT) {
    try {
      const rendered = extractPage(await renderPageHtml(url), BUSINESS_LIMITS.website_knowledge);
      if (rendered.text.length > extracted.text.length) extracted = rendered;
    } catch (error) {
      if (!extracted.text && !extracted.title && !extracted.description) {
        throw fetchError || error;
      }
      warning = 'Only part of the page could be read.';
    }
  }

  const { knowledge, trimmed } = knowledgeFromPage(extracted);
  if (!knowledge) {
    const error = new Error(fetchError?.message || 'No readable text was found on that page.');
    error.statusCode = 400;
    throw error;
  }

  return {
    title: extracted.title,
    description: extracted.description,
    knowledge,
    trimmed,
    warning,
    suggested_name: suggestCompanyName(extracted),
    suggested_about: extracted.description.slice(0, BUSINESS_LIMITS.about),
  };
}

function parseToolArguments(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function recentMessages(messages) {
  if (messages.length <= MAX_HISTORY_LENGTH + 1) return messages;
  return [messages[0], ...messages.slice(-MAX_HISTORY_LENGTH)];
}

// function toOllamaMessages(messages) {
//   return messages.map((message) => {
//     if (message.role === 'tool') {
//       return { role: 'tool', content: message.content, name: message.name };
//     }
//     if (message.role === 'assistant' && message.tool_calls?.length) {
//       return {
//         role: 'assistant',
//         content: message.content || '',
//         tool_calls: message.tool_calls.map((tc) => ({
//           function: {
//             name: tc.function.name,
//             arguments: parseToolArguments(tc.function.arguments),
//           },
//         })),
//       };
//     }
//     return { role: message.role, content: message.content };
//   });
// }

function toGroqMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.tool_call_id,
        content: message.content,
      };
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          extra_content: tc.extra_content,
          function: {
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments ?? {}),
          },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

// Streams the Ollama chat response to the console and collects tool calls
// async function streamOllamaChat(chatId, messages, request) {
//   process.stdout.write('\n[AI is thinking/responding...] ');
//
//   const stream = await ollama.chat({
//     model: ollamaModel,
//     messages: toOllamaMessages(recentMessages(messages)),
//     tools: AI_TOOLS,
//     stream: true,
//   });
//
//   let fullResponse = { message: { role: 'assistant', content: '', tool_calls: [] } };
//
//   for await (const chunk of stream) {
//     if (request?.aborted) {
//       throw new Error('ABORTED');
//     }
//     if (chunk.message.content) {
//       process.stdout.write(chunk.message.content);
//       fullResponse.message.content += chunk.message.content;
//     }
//     if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
//       for (const tc of chunk.message.tool_calls) {
//         fullResponse.message.tool_calls.push(tc);
//       }
//     }
//   }
//   console.log();
//   return fullResponse;
// }

function geminiErrorDetail(data) {
  if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  if (typeof data?.error?.message === 'string' && data.error.message.trim()) return data.error.message.trim();
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  return '';
}

async function groqChat(messages, request) {
  process.stdout.write('\n[AI is thinking/responding...] ');

  let response;
  try {
    response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${geminiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: geminiModel,
        messages: toGroqMessages(recentMessages(messages)),
        tools: AI_TOOLS,
        tool_choice: 'auto',
      }),
      signal: request?.abortController?.signal,
    });
  } catch (error) {
    if (request?.aborted || error.name === 'AbortError') throw new Error('ABORTED');
    throw error;
  }

  if (request?.aborted) throw new Error('ABORTED');

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = geminiErrorDetail(data) || response.statusText || 'Gemini request failed';
    throw new Error(detail);
  }

  const message = data.choices?.[0]?.message || {};
  const toolCalls = (message.tool_calls || []).map((tc) => ({
    id: tc.id,
    type: tc.type || 'function',
    extra_content: tc.extra_content,
    function: {
      name: tc.function?.name,
      arguments: parseToolArguments(tc.function?.arguments),
    },
  }));

  if (message.content) process.stdout.write(message.content);
  console.log();

  return {
    message: {
      role: 'assistant',
      content: message.content || '',
      tool_calls: toolCalls,
    },
  };
}

function completeChat(chatId, messages, request) {
  if (!useGemini) throw new Error('GEMINI_API_KEY is not set.');
  return groqChat(messages, request);
  // return streamOllamaChat(chatId, messages, request);
}

function bubbleDelayMs(text) {
  const min = Math.min(MESSAGE_DELAY_MIN_MS, MESSAGE_DELAY_MAX_MS);
  const max = Math.max(MESSAGE_DELAY_MIN_MS, MESSAGE_DELAY_MAX_MS);
  const scaled = min + String(text || '').length * MESSAGE_DELAY_PER_CHAR_MS;
  return Math.min(max, Math.max(min, scaled));
}

function turnIsCurrent(chatId, request) {
  return Boolean(request) && !request.aborted && activeRequests[chatId] === request;
}

function assertCurrentTurn(chatId, request) {
  if (!turnIsCurrent(chatId, request)) throw new Error('ABORTED');
}

function sleepWhileCurrent(ms, chatId, request) {
  if (ms <= 0) {
    assertCurrentTurn(chatId, request);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const signal = request.abortController?.signal;
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      if (!turnIsCurrent(chatId, request)) {
        reject(new Error('ABORTED'));
        return;
      }
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('ABORTED'));
    };
    if (request.aborted || signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function normalizeBubbles(raw) {
  if (!Array.isArray(raw)) return null;
  const bubbles = [];
  for (const item of raw) {
    let text = '';
    if (typeof item === 'string' || typeof item === 'number') text = String(item).trim();
    else if (item && typeof item === 'object' && typeof item.text === 'string') text = item.text.trim();
    if (!text) continue;
    if (bubbles[bubbles.length - 1] === text) continue;
    bubbles.push(text);
    if (bubbles.length >= MAX_BUBBLES) break;
  }
  return bubbles;
}

function orderedToolCalls(toolCalls) {
  const other = [];
  const sends = [];
  for (const toolCall of toolCalls) {
    if (toolCall.function?.name === 'sendMessages') sends.push(toolCall);
    else other.push(toolCall);
  }
  return [...other, ...sends];
}

function setTyping(chatId, active) {
  broadcast({ type: 'typing', chatId, active });
}

async function deliverAssistantMessage(chatId, text, channel, role = 'assistant') {
  const saved = await saveMessage(chatId, role, text);
  broadcast({ type: 'message', message: saved });
  if (channel === 'telegram') {
    if (!bot) throw new Error('Telegram bot is not configured');
    await bot.sendMessage(chatId, text);
  }
  return saved;
}

function channelFor(chatId) {
  return String(chatId).startsWith('web-') ? 'web' : 'telegram';
}

// A message written by the team (admin reply or meeting decision). It is shown
// to the customer, and the assistant sees it as its own earlier message.
async function sendTeamMessage(chatId, text) {
  const id = String(chatId);
  const saved = await deliverAssistantMessage(id, text, channelFor(id), 'admin');
  if (chatHistories[id]) chatHistories[id].push({ role: 'assistant', content: text });
  return saved;
}

// Saves a meeting the customer proposed. A pending request for the same chat is
// updated in place, so a changed time does not create a duplicate.
async function createMeetingRequest(chatId, args = {}) {
  const preferredText = String(args.preferred_text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  let preferredAt = null;
  if (args.preferred_at) {
    const date = new Date(args.preferred_at);
    if (!Number.isNaN(date.getTime())) preferredAt = date.toISOString();
  }
  if (!preferredText && !preferredAt) throw new Error('preferred_text is required');

  const fields = {
    preferred_text: preferredText || formatBusinessTime(preferredAt),
    preferred_at: preferredAt,
    timezone: BUSINESS_TZ,
    note: String(args.note || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
  };

  const open = await getOpenMeetingForChat(chatId);
  const meeting = open
    ? await updateMeetingRequest(open.id, fields)
    : await createMeeting(chatId, fields);

  await upsertLead(chatId, { meeting_time: meeting.preferred_text });
  const lead = await getLead(chatId);
  if (lead) broadcast({ type: 'lead', lead });
  broadcast({ type: 'meeting', meeting });
  return meeting;
}

function rememberDeliveredBubbles(history, texts, checkpoint) {
  if (!history || texts.length === 0) return;
  const seen = new Set();
  for (let index = checkpoint; index < history.length; index += 1) {
    const message = history[index];
    if (message.role === 'assistant' && !message.tool_calls) seen.add(message.content);
  }
  const missing = [];
  for (const text of texts) {
    if (seen.has(text)) continue;
    seen.add(text);
    missing.push(text);
  }
  if (missing.length === 0) return;
  const newerUser = history.findIndex((message, index) => index >= checkpoint && message.role === 'user');
  const insertAt = newerUser === -1 ? history.length : newerUser;
  history.splice(insertAt, 0, ...missing.map((text) => ({ role: 'assistant', content: text })));
}

async function deliverBubbles(chatId, bubbles, channel, request, sentThisTurn, deliveredTexts) {
  const sent = [];
  let isFirst = true;
  for (const text of bubbles) {
    assertCurrentTurn(chatId, request);
    if (sentThisTurn.has(text)) continue;
    if (!isFirst) {
      await sleepWhileCurrent(BUBBLE_GAP_MS, chatId, request);
      setTyping(chatId, true);
      await sleepWhileCurrent(bubbleDelayMs(text), chatId, request);
      assertCurrentTurn(chatId, request);
    }
    isFirst = false;
    await deliverAssistantMessage(chatId, text, channel);
    setTyping(chatId, false);
    sentThisTurn.add(text);
    deliveredTexts.push(text);
    sent.push(text);
  }
  return sent;
}

async function handleUserMessage(chatId, userMessage, channel) {
  chatId = chatId.toString();

  if (activeRequests[chatId]) {
    activeRequests[chatId].aborted = true;
    activeRequests[chatId].abortController?.abort();
    console.log(`\n[System] Aborted AI response for chat ${chatId} due to new incoming message.`);
  }
  const request = { aborted: false, abortController: new AbortController() };
  activeRequests[chatId] = request;

  let systemPrompt = buildSystemPrompt(DEFAULT_BUSINESS_PROFILE);
  try {
    systemPrompt = buildSystemPrompt(await getBusinessProfile());
  } catch {
    // A missing profile still leaves the default business facts in place.
  }

  if (!chatHistories[chatId]) {
    chatHistories[chatId] = [{ role: 'system', content: systemPrompt }];
    try {
      const pastMessages = await getChatHistory(chatId);
      for (const message of pastMessages) {
        // Team messages are stored as role 'admin'; the model only knows user and assistant.
        const role = message.role === 'admin' ? 'assistant' : message.role;
        chatHistories[chatId].push({ role, content: message.content });
      }
    } catch (error) {
      console.error('Error loading chat history:', error.message);
    }
  }

  try {
    const lead = await getLead(chatId);
    const contextStr = lead
      ? [
          lead.name && `Name: ${lead.name}`,
          lead.contact && `Contact: ${lead.contact}`,
          lead.service && `Project: ${lead.service}`,
          lead.stack && `Stack: ${lead.stack}`,
          lead.meeting_time && `Meeting: ${lead.meeting_time}`,
          lead.lead_score ? `Private score: ${lead.lead_score}/10` : '',
          lead.score_reason && `Score reason: ${lead.score_reason}`,
          lead.insights && `Notes:\n${lead.insights}`,
        ].filter(Boolean).join('\n')
      : 'No context yet.';
    chatHistories[chatId][0].content = `${systemPrompt}\n\nCLIENT CONTEXT SUMMARY (private, never quote the score to the customer):\n${contextStr || 'No context yet.'}`;
  } catch {
    chatHistories[chatId][0].content = systemPrompt;
  }

  chatHistories[chatId].push({ role: 'user', content: userMessage });
  const savedUser = await saveMessage(chatId, 'user', userMessage);
  broadcast({ type: 'message', message: savedUser });

  broadcast({ type: 'typing', chatId, active: true });
  let typingInterval;
  if (channel === 'telegram' && bot) {
    bot.sendChatAction(chatId, 'typing').catch(() => {});
    typingInterval = setInterval(() => {
      bot.sendChatAction(chatId, 'typing').catch(() => {});
    }, 4000);
  }

  const historyCheckpoint = chatHistories[chatId].length;
  const deliveredTexts = [];

  try {
    let response = await completeChat(chatId, chatHistories[chatId], request);
    let delivered = false;
    const sentThisTurn = new Set();
    let toolRound = 0;

    while (response.message.tool_calls && response.message.tool_calls.length > 0) {
      assertCurrentTurn(chatId, request);
      if (toolRound >= MAX_TOOL_ROUNDS) break;
      toolRound += 1;

      const results = new Map();
      const bubblesThisRound = [];
      let fetchedThisRound = false;
      let invalidSend = false;

      for (const toolCall of orderedToolCalls(response.message.tool_calls)) {
        assertCurrentTurn(chatId, request);
        const fn = toolCall.function;
        console.log(`\n[AI Tool Call] ${fn.name}(${JSON.stringify(fn.arguments)})`);

        let toolResultText = '';

        if (fn.name === 'sendMessages') {
          const bubbles = normalizeBubbles(fn.arguments?.messages);
          if (!bubbles || bubbles.length === 0) {
            invalidSend = true;
            toolResultText = JSON.stringify({ error: 'messages must be a non-empty array of text bubbles.' });
          } else {
            const sent = await deliverBubbles(chatId, bubbles, channel, request, sentThisTurn, deliveredTexts);
            bubblesThisRound.push(...sent);
            if (sent.length === 0) {
              toolResultText = JSON.stringify({ status: 'No new messages to send.' });
            } else {
              delivered = true;
              toolResultText = JSON.stringify({ status: 'Messages sent successfully.', messages: sent });
            }
          }
        } else if (fn.name === 'fetchWebsiteContent') {
          fetchedThisRound = true;
          try {
            console.log(`\n[Tool] Fetching website: ${fn.arguments.url}`);
            const res = await fetch(fn.arguments.url, { signal: request.abortController?.signal });
            const html = await res.text();
            toolResultText = JSON.stringify({ content: visiblePageText(html) });
          } catch (error) {
            if (request.aborted || error.name === 'AbortError') throw new Error('ABORTED');
            toolResultText = JSON.stringify({ error: error.message });
          }
        } else if (fn.name === 'requestMeeting') {
          try {
            const meeting = await createMeetingRequest(chatId, fn.arguments);
            toolResultText = JSON.stringify({
              status: 'Meeting request saved as pending.',
              requested: meeting.preferred_text,
              instruction: 'Tell the customer you will discuss it with the team and get back to them. Do not confirm the time.',
            });
            console.log(`\n[Database] Meeting request #${meeting.id} for chat ${chatId}`);
          } catch (error) {
            toolResultText = JSON.stringify({ error: error.message });
          }
        } else if (fn.name === 'updateClientContext') {
          try {
            await upsertLead(chatId, fn.arguments);
            const lead = await getLead(chatId);
            if (lead) broadcast({ type: 'lead', lead });
            toolResultText = JSON.stringify({ status: 'Context updated successfully.' });
            console.log(`\n[Database] Updated client context for chat ${chatId}`);
          } catch (error) {
            toolResultText = JSON.stringify({ error: error.message });
          }
        } else {
          toolResultText = JSON.stringify({ error: `Unknown tool: ${fn.name}` });
        }

        results.set(toolCall, toolResultText);
      }

      assertCurrentTurn(chatId, request);
      chatHistories[chatId].push(response.message);
      for (const toolCall of response.message.tool_calls) {
        const toolMessage = {
          role: 'tool',
          content: results.get(toolCall) || JSON.stringify({ error: 'Tool did not run.' }),
          name: toolCall.function?.name,
        };
        if (toolCall.id) toolMessage.tool_call_id = toolCall.id;
        chatHistories[chatId].push(toolMessage);
      }

      for (const text of bubblesThisRound) {
        chatHistories[chatId].push({ role: 'assistant', content: text });
      }

      assertCurrentTurn(chatId, request);
      if (fetchedThisRound) {
        setTyping(chatId, true);
        response = await completeChat(chatId, chatHistories[chatId], request);
        continue;
      }
      if (delivered) break;
      if (invalidSend && String(response.message.content || '').trim()) break;
      setTyping(chatId, true);
      response = await completeChat(chatId, chatHistories[chatId], request);
    }

    const leftover = String(response.message.content || '').trim();
    if (!delivered && leftover) {
      assertCurrentTurn(chatId, request);
      if (!sentThisTurn.has(leftover)) {
        await deliverAssistantMessage(chatId, leftover, channel);
        chatHistories[chatId].push({ role: 'assistant', content: leftover });
      }
    }
  } catch (error) {
    if (error.message === 'ABORTED') {
      rememberDeliveredBubbles(chatHistories[chatId], deliveredTexts, historyCheckpoint);
      return;
    }
    console.error('Error during AI processing:', error.message);
    try {
      if (!turnIsCurrent(chatId, request)) return;
      await deliverAssistantMessage(
        chatId,
        'Sorry, something went wrong on my side. Send that again?',
        channel
      );
    } catch (sendError) {
      console.error('Failed to send error message:', sendError.message);
    }
  } finally {
    if (typingInterval) clearInterval(typingInterval);
    if (activeRequests[chatId] === request) {
      broadcast({ type: 'typing', chatId, active: false });
    }
  }
}

wss.on('connection', (socket) => {
  sendTo(socket, { type: 'connected' });

  socket.on('message', async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // The team's reply: saved and delivered as the business, never sent to the AI.
    if (data.type === 'admin_reply') {
      const chatId = String(data.chatId || '');
      const content = String(data.content || '').trim();
      if (!chatId || !content) return;
      try {
        await sendTeamMessage(chatId, content);
      } catch (error) {
        sendTo(socket, { type: 'error', message: error.message });
      }
      return;
    }

    if (data.type !== 'send') return;

    const content = String(data.content || '').trim();
    if (!content) return;

    const chatId = data.chatId ? String(data.chatId) : `web-${randomUUID()}`;
    const channel = chatId.startsWith('web-') ? 'web' : 'telegram';

    if (channel === 'telegram' && !bot) {
      sendTo(socket, { type: 'error', message: 'Telegram is not connected on this server.' });
      return;
    }

    if (!data.chatId) sendTo(socket, { type: 'chat_created', chatId });

    try {
      await handleUserMessage(chatId, content, channel);
    } catch (error) {
      sendTo(socket, { type: 'error', message: error.message });
    }
  });
});

if (bot) {
  bot.on('message', async (msg) => {
    const userMessage = msg.text ? msg.text.trim() : '';
    if (!userMessage) return;
    await handleUserMessage(msg.chat.id, userMessage, 'telegram');
  });

  bot.on('polling_error', (error) => {
    console.error('Polling Error:', error.code, error.message);
  });
  console.log('✅ Telegram bot is running.');
}

await initDB();
server.listen(PORT, () => {
  console.log(`🌐 Dashboard running at http://localhost:${PORT}`);
});
