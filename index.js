import TelegramBot from 'node-telegram-bot-api';
import { Ollama } from 'ollama';
import dotenv from 'dotenv';
import express from 'express';
import { initDB, upsertLead, getEnquiries, saveMessage, getChatHistory, getLead } from './database.js';

// Load environment variables
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const ollamaModel = process.env.OLLAMA_MODEL || 'gemma4:12b';

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set in the .env file');
  process.exit(1);
}

// Initialize Telegram Bot (polling mode)
const bot = new TelegramBot(token, { polling: true });

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDB();
  console.log(`🌐 Web Dashboard running at http://localhost:${PORT}`);
});

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
      description: 'Sends one or more text messages to the Telegram user. ALWAYS pass an array of messages to send them sequentially with a delay.',
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
async function streamOllamaChat(chatId, messages) {
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
    if (activeRequests[chatId]?.aborted) {
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

// Handle incoming messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userMessage = msg.text ? msg.text.trim() : '';

  if (!userMessage) return;

  if (activeRequests[chatId]) {
    activeRequests[chatId].aborted = true;
    console.log(`\n[System] Aborted AI response for chat ${chatId} due to new incoming message.`);
  }
  activeRequests[chatId] = { aborted: false };

  // Initialize history
  if (!chatHistories[chatId]) {
    chatHistories[chatId] = [{ role: 'system', content: SYSTEM_PROMPT }];
    
    try {
      const pastMessages = await getChatHistory(chatId);
      for (const m of pastMessages) {
        chatHistories[chatId].push({ role: m.role, content: m.content });
      }
    } catch (e) {
      console.error('Error loading chat history:', e.message);
    }
  }

  // Update dynamic context in system prompt
  try {
    const lead = await getLead(chatId);
    const contextStr = lead && lead.insights ? lead.insights : 'No context yet.';
    chatHistories[chatId][0].content = SYSTEM_PROMPT + `\n\nCLIENT CONTEXT SUMMARY (Always refer to this):\n${contextStr}`;
  } catch(e) {}

  // Add user message
  chatHistories[chatId].push({ role: 'user', content: userMessage });
  await saveMessage(chatId, 'user', userMessage);
  bot.sendChatAction(chatId, 'typing');
  const typingInterval = setInterval(() => {
    bot.sendChatAction(chatId, 'typing').catch(() => { });
  }, 4000);

  try {
    let response = await streamOllamaChat(chatId, chatHistories[chatId]);

    // Tool calling loop
    while (response.message.tool_calls && response.message.tool_calls.length > 0) {
      chatHistories[chatId].push(response.message); // Append the assistant's tool call message
      let shouldBreak = false;

      for (const toolCall of response.message.tool_calls) {
        const fn = toolCall.function;
        console.log(`\n[AI Tool Call] ${fn.name}(${JSON.stringify(fn.arguments)})`);

        let toolResultText = '';

        if (fn.name === 'sendMessages') {
          // AI wants to send intermediate messages
          const msgs = fn.arguments.messages || [];
          for (const msgText of msgs) {
            await bot.sendMessage(chatId, msgText);
            await saveMessage(chatId, 'assistant', msgText);
            // Add a 1 sec artificial delay for natural chat feel
            await new Promise(r => setTimeout(r, 1000));
          }
          toolResultText = JSON.stringify({ status: 'Messages sent successfully.' });
          shouldBreak = true; // Stop loop after sending message to user
        } else if (fn.name === 'fetchWebsiteContent') {
          try {
            console.log(`\n[Tool] Fetching website: ${fn.arguments.url}`);
            const res = await fetch(fn.arguments.url);
            const text = await res.text();
            // Extract some text to avoid huge responses
            toolResultText = JSON.stringify({ content: text.substring(0, 1500) });
          } catch (e) {
            toolResultText = JSON.stringify({ error: e.message });
          }
        } else if (fn.name === 'updateClientContext') {
          try {
            const data = fn.arguments;
            await upsertLead(chatId, data);
            toolResultText = JSON.stringify({ status: 'Context updated successfully.' });
            console.log(`\n[Database] Updated client context for chat ${chatId}`);
          } catch (e) {
            toolResultText = JSON.stringify({ error: e.message });
          }
        } else {
          toolResultText = JSON.stringify({ error: `Unknown tool: ${fn.name}` });
        }

        // Append tool result back to history
        chatHistories[chatId].push({
          role: 'tool',
          content: toolResultText,
          name: fn.name
        });
      }

      if (shouldBreak) {
        break;
      }

      // Request next AI response after tools have executed
      response = await streamOllamaChat(chatId, chatHistories[chatId]);
    }

    // Process final text response
    if (response.message.content) {
      chatHistories[chatId].push({ role: 'assistant', content: response.message.content });
    }

  } catch (error) {
    if (error.message === 'ABORTED') {
      return; // Silently exit, the new incoming message is handling it
    }
    console.error('Error during AI processing:', error.message);
    bot.sendMessage(chatId, 'Sorry, I encountered an internal error processing your request.');
  } finally {
    clearInterval(typingInterval);
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling Error:', error.code, error.message);
});

console.log('✅ Bot is running. Send a message to your bot on Telegram!');
