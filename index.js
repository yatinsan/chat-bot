import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import { Ollama } from 'ollama';
import dotenv from 'dotenv';
import express from 'express';
import { initDB, upsertLead, getEnquiries, saveMessage, getChatHistory, getLead, listChats, getStats } from './database.js';

// Load environment variables
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const ollamaModel = process.env.OLLAMA_MODEL || 'gemma4:12b';

if (!token) {
  console.warn('TELEGRAM_BOT_TOKEN is not set. Website chat still works; Telegram replies are disabled.');
}

const bot = token ? new TelegramBot(token, { polling: true }) : null;

// Initialize Ollama client
const ollama = new Ollama();

// Define the system prompt for the AI agent
const SYSTEM_PROMPT = `
You are a highly professional, energetic, and friendly Sales Executive AI for Pixbit Solutions (www.pixbitsolutions.com), Dubai's premier software development company. 
Tagline: "Dubai's premier web and mobile app development, SEO, and digital marketing experts. Innovation you can trust."
Mission: "Converting visionary ideas into real-world solutions that propel businesses towards unprecedented growth, guided by a relentless pursuit of excellence."

Detailed Services:
1. Web Development: Crafting modern, user-centric websites.
2. Mobile App Development: Building innovative mobile apps for seamless experiences across Android and iOS.
3. SEO: Boosting online visibility, improving rankings, and driving targeted traffic.
4. Digital Marketing: Enhancing brand visibility through efficient digital marketing strategies.
5. Branding: Helping businesses build a strong, unique identity.

CRITICAL RULES:
1. ALL COMMUNICATION VIA TOOL: You MUST NOT write regular text responses. ALL messages to the user MUST be sent using the 'sendMessages' tool.
2. MULTIPLE SHORT MESSAGES: You can send multiple messages at once by passing an array of strings to the 'sendMessages' tool. When a user first greets you (like "hi"), you MUST reply with an array of exactly two messages in a single tool call:
   - Message 1: A warm, short greeting (e.g., "Hi there! 👋")
   - Message 2: A professional introduction (e.g., "Welcome to Pixbit Solutions! We're Dubai's premier experts in Web & Mobile App Development, SEO, and Digital Marketing. How can we help propel your business forward today?")
3. KEEP IT BRIEF: Keep each individual message concise and punchy (1 to 2 sentences maximum) so it feels like a natural chat, but ensure you sound welcoming and professional.
4. CHECKING WEBSITES: If a user asks about a website, FIRST call 'sendMessages' with an array containing a single message like ["Let me check that website for you..."], then call the 'fetchWebsiteContent' tool to read the website, and finally use 'sendMessages' again with the result.
5. NEVER repeat the same information in consecutive messages.
6. INTERNAL THOUGHTS: You can use regular text to write your internal thoughts or reasoning, but the user will ONLY see what you send via the 'sendMessages' tool.
7. ITERATIVE TRACKING: Analyze every user message. If they mention useful details, IMMEDIATELY call the 'updateClientContext' tool to save those insights. Don't wait until the end of the chat.
8. MEETING SCHEDULING: If the client seems like a real, qualified lead, you MUST say: "We can schedule a meeting with our tech team. What time do you prefer?" via the 'sendMessages' tool. When they reply with a time, respond: "Let me discuss that time with our team and get back to you.", and call 'updateClientContext' to save the meeting_time.
`;

const app = express();
app.use(express.static('public'));

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
console.log(`Using Ollama model: ${ollamaModel}`);

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
      description: 'Continuously updates a client profile with new insights, contact details, or meeting time. Use this to remember important details.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the client if known' },
          contact: { type: 'string', description: 'Contact details (email/phone) if known' },
          insights: { type: 'string', description: 'A short, useful note/insight from the latest message (e.g., "Wants a mobile app", "Budget customer")' },
          service: { type: 'string', description: 'The service they want (e.g. Web Development)' },
          meeting_time: { type: 'string', description: 'The time they prefer for a meeting with the tech team' }
        },
        required: []
      }
    }
  }
];

const activeRequests = {};

/**
 * Streams the Ollama chat response to the console and collects tool calls
 */
async function streamOllamaChat(chatId, messages, request) {
  process.stdout.write('\n[AI is thinking/responding...] ');
  
  const messagesToSend = [
    messages[0], 
    ...messages.slice(-MAX_HISTORY_LENGTH)
  ];

  const stream = await ollama.chat({
    model: ollamaModel,
    messages: messagesToSend,
    tools: AI_TOOLS,
    stream: true,
  });

  let fullResponse = { message: { role: 'assistant', content: '', tool_calls: [] } };

  for await (const chunk of stream) {
    if (request?.aborted) {
      throw new Error('ABORTED');
    }
    if (chunk.message.content) {
      process.stdout.write(chunk.message.content);
      fullResponse.message.content += chunk.message.content;
    }
    if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
      for (const tc of chunk.message.tool_calls) {
        fullResponse.message.tool_calls.push(tc);
      }
    }
  }
  console.log(); // Print a newline at the end
  return fullResponse;
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
    console.log(`\n[System] Aborted AI response for chat ${chatId} due to new incoming message.`);
  }
  const request = { aborted: false };
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
    const contextStr = lead && lead.insights ? lead.insights : 'No context yet.';
    chatHistories[chatId][0].content = `${SYSTEM_PROMPT}\n\nCLIENT CONTEXT SUMMARY (Always refer to this):\n${contextStr}`;
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
    let response = await streamOllamaChat(chatId, chatHistories[chatId], request);

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

        chatHistories[chatId].push({
          role: 'tool',
          content: toolResultText,
          name: fn.name
        });
      }

      if (shouldBreak) break;
      response = await streamOllamaChat(chatId, chatHistories[chatId], request);
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
        'Sorry, I encountered an internal error processing your request.',
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
