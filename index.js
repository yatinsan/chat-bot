import { createServer } from 'http';
import path from 'path';
import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
// import { Ollama } from 'ollama';
import dotenv from 'dotenv';
import express from 'express';
import { initDB, upsertLead, getEnquiries, saveMessage, getChatHistory, getLead, listChats, getStats, deleteChat } from './database.js';

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

// Define the system prompt for the AI agent
const SYSTEM_PROMPT = `
You text customers on the Pixbit Solutions website (www.pixbitsolutions.com) as a real person on the sales team in Dubai. You are warm, brief, and specific. You are not a form and you do not sound like a bot.

Services you can talk about naturally:
- Websites
- Mobile apps (Android and iOS)
- SEO, digital marketing, and branding

CRITICAL RULES:
1. ALL COMMUNICATION VIA TOOL: The customer only sees text you pass to 'sendMessages'. Never mention tools, scores, dashboards, notes, or that you are an AI, a bot, a model, or an assistant.
2. TEXT LIKE A PERSON: Each message is 1 to 2 short sentences. When someone first says hi, send exactly two messages in one sendMessages call: a short hello, then a line asking what they want to build.
3. COLLECT IN CONVERSATION: When they describe a need, ask the next useful thing only. Order: website, mobile app, or both; then stack, platform, or main features; then their name and a phone or email. Do not dump every question at once.
4. SAVE AS YOU LEARN: On every message that adds a detail, call 'updateClientContext' in the same turn. Save service (website, mobile app, or both), stack, insights, name, and contact as soon as you know them.
5. PRIVATE SCORE: Also set lead_score from 1 to 10 and a one-line score_reason. Rescore when new details arrive. Never put the number or the reason in sendMessages.
   - 1-3: only a greeting, vague, or spam
   - 4-6: a real project (website or mobile app) but no phone or email
   - 7-10: a specific project, some stack or scope, and a phone or email
6. CHECKING WEBSITES: If they ask about a website, first sendMessages ["Let me take a look..."], then fetchWebsiteContent, then sendMessages with what you found.
7. NEVER repeat the same information in consecutive messages.
8. MEETING: Once they look like a real client (a clear project and a way to reach them), ask what time works for a call with the team. When they give a time, say you'll check with the team and save meeting_time.
`;

const app = express();
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
      description: 'Sends one or more text messages to the user (Telegram or the website chat). ALWAYS pass an array of messages to send them sequentially.',
      parameters: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: { type: 'string' },
            description: 'An array of short text messages to send sequentially to the user'
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
          meeting_time: { type: 'string', description: 'The time they prefer for a meeting with the tech team' },
          lead_score: { type: 'number', description: 'Private 1-10 score for how real this client feels. Never show this to the customer.' },
          score_reason: { type: 'string', description: 'One private line explaining the score. Never send this to the customer.' }
        },
        required: []
      }
    }
  }
];

const activeRequests = {};

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

async function deliverAssistantMessage(chatId, text, channel) {
  const saved = await saveMessage(chatId, 'assistant', text);
  broadcast({ type: 'message', message: saved });
  if (channel === 'telegram') {
    if (!bot) throw new Error('Telegram bot is not configured');
    await bot.sendMessage(chatId, text);
  }
  return saved;
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

  if (!chatHistories[chatId]) {
    chatHistories[chatId] = [{ role: 'system', content: SYSTEM_PROMPT }];
    try {
      const pastMessages = await getChatHistory(chatId);
      for (const message of pastMessages) {
        chatHistories[chatId].push({ role: message.role, content: message.content });
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
    chatHistories[chatId][0].content = `${SYSTEM_PROMPT}\n\nCLIENT CONTEXT SUMMARY (private, never quote the score to the customer):\n${contextStr || 'No context yet.'}`;
  } catch {
    // Context is optional; the reply can still proceed.
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

  try {
    let response = await completeChat(chatId, chatHistories[chatId], request);

    while (response.message.tool_calls && response.message.tool_calls.length > 0) {
      if (request.aborted) throw new Error('ABORTED');
      chatHistories[chatId].push(response.message);
      let shouldBreak = false;

      for (const toolCall of response.message.tool_calls) {
        const fn = toolCall.function;
        console.log(`\n[AI Tool Call] ${fn.name}(${JSON.stringify(fn.arguments)})`);

        let toolResultText = '';

        if (fn.name === 'sendMessages') {
          const msgs = fn.arguments.messages || [];
          for (const msgText of msgs) {
            if (request.aborted) throw new Error('ABORTED');
            await deliverAssistantMessage(chatId, msgText, channel);
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
          toolResultText = JSON.stringify({ status: 'Messages sent successfully.' });
          shouldBreak = true;
        } else if (fn.name === 'fetchWebsiteContent') {
          try {
            console.log(`\n[Tool] Fetching website: ${fn.arguments.url}`);
            const res = await fetch(fn.arguments.url);
            const text = await res.text();
            toolResultText = JSON.stringify({ content: text.substring(0, 1500) });
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

        const toolMessage = {
          role: 'tool',
          content: toolResultText,
          name: fn.name,
        };
        if (toolCall.id) toolMessage.tool_call_id = toolCall.id;
        chatHistories[chatId].push(toolMessage);
      }

      if (shouldBreak) break;
      response = await completeChat(chatId, chatHistories[chatId], request);
    }

    if (response.message.content) {
      chatHistories[chatId].push({ role: 'assistant', content: response.message.content });
    }
  } catch (error) {
    if (error.message === 'ABORTED') return;
    console.error('Error during AI processing:', error.message);
    try {
      await deliverAssistantMessage(
        chatId,
        error.message || 'Sorry, I encountered an internal error processing your request.',
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
