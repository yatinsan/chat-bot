// Gemini, called through its OpenAI-compatible chat completions endpoint.
import { GEMINI_API_KEY, GEMINI_EMBEDDING_MODEL, GEMINI_MODEL } from './config.js';
import { AI_TOOLS } from './prompt.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const GEMINI_URL = `${GEMINI_BASE}/chat/completions`;
const EMBED_BATCH = 50;
const MAX_HISTORY_LENGTH = 20;

export const geminiConfigured = GEMINI_API_KEY.length > 0;

export function geminiErrorDetail(data) {
  if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
  if (typeof data?.error?.message === 'string' && data.error.message.trim()) return data.error.message.trim();
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  return '';
}

export function parseToolArguments(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Keeps the system prompt plus the latest messages.
export function recentMessages(messages) {
  if (messages.length <= MAX_HISTORY_LENGTH + 1) return messages;
  return [messages[0], ...messages.slice(-MAX_HISTORY_LENGTH)];
}

export function toGeminiMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.tool_call_id, content: message.content };
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

async function postGemini(body, signal) {
  if (!geminiConfigured) throw new Error('GEMINI_API_KEY is not set.');
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: GEMINI_MODEL, ...body }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(geminiErrorDetail(data) || response.statusText || 'Gemini request failed');
  }
  return data;
}

// One assistant turn with tools. Returns { message: { role, content, tool_calls } }
// with tool arguments already parsed. Throws 'ABORTED' when the request is cancelled.
export async function geminiChat(messages, request) {
  process.stdout.write('\n[AI is thinking/responding...] ');

  let data;
  try {
    data = await postGemini({
      messages: toGeminiMessages(recentMessages(messages)),
      tools: AI_TOOLS,
      tool_choice: 'auto',
    }, request?.abortController?.signal);
  } catch (error) {
    if (request?.aborted || error.name === 'AbortError') throw new Error('ABORTED');
    throw error;
  }
  if (request?.aborted) throw new Error('ABORTED');

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

  return { message: { role: 'assistant', content: message.content || '', tool_calls: toolCalls } };
}

// A single prompt that should come back as a JSON object. Returns the raw text.
export async function geminiJson(prompt) {
  const data = await postGemini({
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });
  return data.choices?.[0]?.message?.content;
}

// Embeds texts for RAG search. Returns one vector per input, in order.
export async function geminiEmbed(texts, signal) {
  if (!geminiConfigured) throw new Error('GEMINI_API_KEY is not set.');
  const vectors = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH) {
    const batch = texts.slice(start, start + EMBED_BATCH);
    const response = await fetch(`${GEMINI_BASE}/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: GEMINI_EMBEDDING_MODEL, input: batch }),
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(geminiErrorDetail(data) || response.statusText || 'Gemini embedding failed');
    const rows = [...(data.data || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== batch.length) throw new Error('Gemini returned the wrong number of embeddings.');
    for (const row of rows) vectors.push(row.embedding);
  }
  return vectors;
}
