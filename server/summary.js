// Conversation summary for the team. Uses only what the chat says; anything else is "Not mentioned yet".
import { getChatHistory, getChatSummary, getMessageCount, saveChatSummary } from '../database.js';

const SUMMARY_MAX_MESSAGES = 60;
export const SUMMARY_EMPTY = 'Not mentioned yet';

export function cleanSummaryField(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return text || SUMMARY_EMPTY;
}

export function parseSummaryJson(content) {
  const text = String(content || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('The summary came back in an unexpected format.');
  }
}

// askJson(prompt) returns the model's JSON text; it is passed in so tests can fake it.
export async function buildChatSummary(chatId, askJson) {
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

  const parsed = parseSummaryJson(await askJson(prompt));
  const summary = {
    wants: cleanSummaryField(parsed.wants),
    budget: cleanSummaryField(parsed.budget),
    timeline: cleanSummaryField(parsed.timeline),
    missing: cleanSummaryField(parsed.missing),
  };
  await saveChatSummary(chatId, summary, await getMessageCount(chatId));
  return summary;
}

export async function summaryPayload(chatId) {
  const [saved, currentCount] = await Promise.all([getChatSummary(chatId), getMessageCount(chatId)]);
  return {
    summary: saved?.summary ?? null,
    message_count: saved?.message_count ?? null,
    current_count: currentCount,
    updated_at: saved?.updated_at ?? null,
  };
}
