// The assistant's turn loop: load the chat, ask the AI, run the tools it calls,
// and deliver chat bubbles with a human-like delay. A newer customer message
// cancels the turn that is still running.
import {
  DEFAULT_BUSINESS_PROFILE,
  createMeeting,
  getBusinessProfile,
  getChatHistory,
  getLead,
  getOpenMeetingForChat,
  isAiPaused,
  saveMessage,
  setAiPaused as storeAiPaused,
  updateMeetingRequest,
  upsertLead,
} from '../database.js';
import { buildSystemPrompt } from './prompt.js';
import { channelFor } from './channels.js';
import { DEFAULT_TIMEZONE, formatBusinessTime, isValidTimeZone } from './time.js';

export const MAX_BUBBLES = 3;
export const MAX_TOOL_ROUNDS = 4;
const ERROR_REPLY = 'Sorry, something went wrong on my side. Send that again?';

export function normalizeBubbles(raw) {
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

// Saving tools run before sendMessages, so the lead is stored even if delivery is cut short.
export function orderedToolCalls(toolCalls) {
  const other = [];
  const sends = [];
  for (const toolCall of toolCalls) {
    if (toolCall.function?.name === 'sendMessages') sends.push(toolCall);
    else other.push(toolCall);
  }
  return [...other, ...sends];
}

export function bubbleDelayMs(text, delays) {
  const min = Math.min(delays.minMs, delays.maxMs);
  const max = Math.max(delays.minMs, delays.maxMs);
  const scaled = min + String(text || '').length * delays.perCharMs;
  return Math.min(max, Math.max(min, scaled));
}

// After a cancelled turn, keeps the bubbles the customer already saw in memory,
// placed before any newer customer message.
export function rememberDeliveredBubbles(history, texts, checkpoint) {
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

function clientContext(lead) {
  if (!lead) return 'No context yet.';
  return [
    lead.name && `Name: ${lead.name}`,
    lead.contact && `Contact: ${lead.contact}`,
    lead.service && `Project: ${lead.service}`,
    lead.stack && `Stack: ${lead.stack}`,
    lead.meeting_time && `Meeting: ${lead.meeting_time}`,
    lead.lead_score ? `Private score: ${lead.lead_score}/10` : '',
    lead.score_reason && `Score reason: ${lead.score_reason}`,
    lead.insights && `Notes:\n${lead.insights}`,
  ].filter(Boolean).join('\n') || 'No context yet.';
}

async function loadProfile() {
  try {
    return await getBusinessProfile();
  } catch {
    return DEFAULT_BUSINESS_PROFILE; // A missing profile still leaves the default business facts in place.
  }
}

function profileTimeZone(profile) {
  return isValidTimeZone(profile?.timezone) ? profile.timezone : DEFAULT_TIMEZONE;
}

/**
 * deps:
 *   completeChat(messages, request) -> { message: { content, tool_calls } }
 *   transport: { hasTelegram, send(chatId, text, channel), startTyping(chatId, channel) -> stop() }
 *   broadcast(event)
 *   fetchPageText(url, signal) -> string
 *   delays: { minMs, maxMs, perCharMs, gapMs }
 */
export function createChatEngine({ completeChat, transport, broadcast, fetchPageText, delays }) {
  const chatHistories = {};
  const activeRequests = {};

  function cancelTurn(chatId) {
    const request = activeRequests[chatId];
    if (!request) return false;
    request.aborted = true;
    request.abortController?.abort();
    return true;
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

  function setTyping(chatId, active) {
    broadcast({ type: 'typing', chatId, active });
  }

  async function deliverMessage(chatId, text, channel, role = 'assistant') {
    const saved = await saveMessage(chatId, role, text);
    broadcast({ type: 'message', message: saved });
    await transport.send(chatId, text, channel);
    return saved;
  }

  // A message written by the team (admin reply or meeting decision). It is shown
  // to the customer, and the assistant sees it as its own earlier message.
  async function sendTeamMessage(chatId, text) {
    const id = String(chatId);
    const saved = await deliverMessage(id, text, channelFor(id), 'admin');
    if (chatHistories[id]) chatHistories[id].push({ role: 'assistant', content: text });
    return saved;
  }

  // Saves a meeting the customer proposed. A pending request for the same chat is
  // updated in place, so a changed time does not create a duplicate.
  async function createMeetingRequest(chatId, args = {}) {
    const timezone = profileTimeZone(await loadProfile());
    const preferredText = String(args.preferred_text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    let preferredAt = null;
    if (args.preferred_at) {
      const date = new Date(args.preferred_at);
      if (!Number.isNaN(date.getTime())) preferredAt = date.toISOString();
    }
    if (!preferredText && !preferredAt) throw new Error('preferred_text is required');

    const fields = {
      preferred_text: preferredText || formatBusinessTime(preferredAt, timezone),
      preferred_at: preferredAt,
      timezone,
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

  async function deliverBubbles(chatId, bubbles, channel, request, sentThisTurn, deliveredTexts) {
    const sent = [];
    let isFirst = true;
    for (const text of bubbles) {
      assertCurrentTurn(chatId, request);
      if (sentThisTurn.has(text)) continue;
      if (!isFirst) {
        await sleepWhileCurrent(delays.gapMs, chatId, request);
        setTyping(chatId, true);
        await sleepWhileCurrent(bubbleDelayMs(text, delays), chatId, request);
        assertCurrentTurn(chatId, request);
      }
      isFirst = false;
      await deliverMessage(chatId, text, channel);
      setTyping(chatId, false);
      sentThisTurn.add(text);
      deliveredTexts.push(text);
      sent.push(text);
    }
    return sent;
  }

  async function runTool(chatId, toolCall, ctx) {
    const fn = toolCall.function;
    console.log(`\n[AI Tool Call] ${fn.name}(${JSON.stringify(fn.arguments)})`);

    if (fn.name === 'sendMessages') {
      const bubbles = normalizeBubbles(fn.arguments?.messages);
      if (!bubbles || bubbles.length === 0) {
        ctx.invalidSend = true;
        return { error: 'messages must be a non-empty array of text bubbles.' };
      }
      const sent = await deliverBubbles(chatId, bubbles, ctx.channel, ctx.request, ctx.sentThisTurn, ctx.deliveredTexts);
      ctx.bubblesThisRound.push(...sent);
      if (sent.length === 0) return { status: 'No new messages to send.' };
      ctx.delivered = true;
      return { status: 'Messages sent successfully.', messages: sent };
    }

    if (fn.name === 'fetchWebsiteContent') {
      ctx.fetchedThisRound = true;
      try {
        console.log(`\n[Tool] Fetching website: ${fn.arguments?.url}`);
        return { content: await fetchPageText(fn.arguments?.url, ctx.request.abortController?.signal) };
      } catch (error) {
        if (ctx.request.aborted || error.name === 'AbortError') throw new Error('ABORTED');
        return { error: error.message };
      }
    }

    if (fn.name === 'requestMeeting') {
      try {
        const meeting = await createMeetingRequest(chatId, fn.arguments);
        console.log(`\n[Database] Meeting request #${meeting.id} for chat ${chatId}`);
        return {
          status: 'Meeting request saved as pending.',
          requested: meeting.preferred_text,
          instruction: 'Tell the customer you will discuss it with the team and get back to them. Do not confirm the time.',
        };
      } catch (error) {
        return { error: error.message };
      }
    }

    if (fn.name === 'updateClientContext') {
      try {
        await upsertLead(chatId, fn.arguments || {});
        const lead = await getLead(chatId);
        if (lead) broadcast({ type: 'lead', lead });
        console.log(`\n[Database] Updated client context for chat ${chatId}`);
        return { status: 'Context updated successfully.' };
      } catch (error) {
        return { error: error.message };
      }
    }

    return { error: `Unknown tool: ${fn.name}` };
  }

  async function prepareHistory(chatId) {
    const profile = await loadProfile();
    const systemPrompt = buildSystemPrompt(profile);

    if (!chatHistories[chatId]) {
      chatHistories[chatId] = [{ role: 'system', content: systemPrompt }];
      try {
        for (const message of await getChatHistory(chatId)) {
          // Team messages are stored as role 'admin'; the model only knows user and assistant.
          const role = message.role === 'admin' ? 'assistant' : message.role;
          chatHistories[chatId].push({ role, content: message.content });
        }
      } catch (error) {
        console.error('Error loading chat history:', error.message);
      }
    }

    try {
      const context = clientContext(await getLead(chatId));
      chatHistories[chatId][0].content = `${systemPrompt}\n\nCLIENT CONTEXT SUMMARY (private, never quote the score to the customer):\n${context}`;
    } catch {
      chatHistories[chatId][0].content = systemPrompt;
    }
    return chatHistories[chatId];
  }

  // The team takes over (paused = true) or hands the chat back to the AI.
  async function setAiPaused(rawChatId, paused) {
    const chatId = String(rawChatId);
    const aiPaused = await storeAiPaused(chatId, paused);
    if (aiPaused && cancelTurn(chatId)) {
      delete activeRequests[chatId];
      setTyping(chatId, false);
    }
    broadcast({ type: 'ai_control', chatId, ai_paused: aiPaused });
    return aiPaused;
  }

  async function handleUserMessage(rawChatId, userMessage, channel) {
    const chatId = String(rawChatId);

    // While the team handles the chat, the message is saved and shown, but the AI does not reply.
    if (await isAiPaused(chatId)) {
      if (cancelTurn(chatId)) {
        delete activeRequests[chatId];
        setTyping(chatId, false);
      }
      const history = await prepareHistory(chatId);
      history.push({ role: 'user', content: userMessage });
      const saved = await saveMessage(chatId, 'user', userMessage);
      broadcast({ type: 'message', message: saved });
      return;
    }

    if (cancelTurn(chatId)) {
      console.log(`\n[System] Aborted AI response for chat ${chatId} due to new incoming message.`);
    }
    const request = { aborted: false, abortController: new AbortController() };
    activeRequests[chatId] = request;

    const history = await prepareHistory(chatId);
    history.push({ role: 'user', content: userMessage });
    const savedUser = await saveMessage(chatId, 'user', userMessage);
    broadcast({ type: 'message', message: savedUser });

    setTyping(chatId, true);
    const stopTyping = transport.startTyping(chatId, channel);

    const historyCheckpoint = history.length;
    const ctx = {
      channel,
      request,
      delivered: false,
      sentThisTurn: new Set(),
      deliveredTexts: [],
      bubblesThisRound: [],
      fetchedThisRound: false,
      invalidSend: false,
    };

    try {
      let response = await completeChat(history, request);
      let toolRound = 0;

      while (response.message.tool_calls?.length) {
        assertCurrentTurn(chatId, request);
        if (toolRound >= MAX_TOOL_ROUNDS) break;
        toolRound += 1;

        ctx.bubblesThisRound = [];
        ctx.fetchedThisRound = false;
        ctx.invalidSend = false;
        const results = new Map();

        for (const toolCall of orderedToolCalls(response.message.tool_calls)) {
          assertCurrentTurn(chatId, request);
          results.set(toolCall, JSON.stringify(await runTool(chatId, toolCall, ctx)));
        }

        assertCurrentTurn(chatId, request);
        history.push(response.message);
        for (const toolCall of response.message.tool_calls) {
          const toolMessage = {
            role: 'tool',
            content: results.get(toolCall) || JSON.stringify({ error: 'Tool did not run.' }),
            name: toolCall.function?.name,
          };
          if (toolCall.id) toolMessage.tool_call_id = toolCall.id;
          history.push(toolMessage);
        }
        for (const text of ctx.bubblesThisRound) {
          history.push({ role: 'assistant', content: text });
        }

        assertCurrentTurn(chatId, request);
        // A website fetch needs another round so the AI can talk about what it found.
        if (!ctx.fetchedThisRound) {
          if (ctx.delivered) break;
          if (ctx.invalidSend && String(response.message.content || '').trim()) break;
        }
        setTyping(chatId, true);
        response = await completeChat(history, request);
      }

      // Plain text without a sendMessages call is still delivered.
      const leftover = String(response.message.content || '').trim();
      if (!ctx.delivered && leftover) {
        assertCurrentTurn(chatId, request);
        if (!ctx.sentThisTurn.has(leftover)) {
          await deliverMessage(chatId, leftover, channel);
          history.push({ role: 'assistant', content: leftover });
        }
      }
    } catch (error) {
      if (error.message === 'ABORTED') {
        rememberDeliveredBubbles(chatHistories[chatId], ctx.deliveredTexts, historyCheckpoint);
        return;
      }
      console.error('Error during AI processing:', error.message);
      try {
        if (!turnIsCurrent(chatId, request)) return;
        await deliverMessage(chatId, ERROR_REPLY, channel);
      } catch (sendError) {
        console.error('Failed to send error message:', sendError.message);
      }
    } finally {
      stopTyping();
      if (activeRequests[chatId] === request) {
        delete activeRequests[chatId];
        setTyping(chatId, false);
      }
    }
  }

  // Stops any running turn and drops the in-memory history (used when a chat is deleted).
  function forgetChat(chatId) {
    const id = String(chatId);
    cancelTurn(id);
    delete activeRequests[id];
    delete chatHistories[id];
  }

  return { handleUserMessage, sendTeamMessage, setAiPaused, createMeetingRequest, forgetChat, histories: chatHistories };
}
