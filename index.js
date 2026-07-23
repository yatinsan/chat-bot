import TelegramBot from 'node-telegram-bot-api';
import { Ollama } from 'ollama';
import dotenv from 'dotenv';

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

// Initialize Ollama client (defaults to http://127.0.0.1:11434)
const ollama = new Ollama();

// Define the system prompt for the AI agent
const SYSTEM_PROMPT = `
You are a helpful, professional, and friendly AI Sales & Support Assistant for "Pixbit Solutions" (www.pixbitsolutions.com).
Pixbit Solutions is Dubai's premier software development company. 
Services offered: Web Development, Mobile App Development, Search Engine Optimization (SEO), Digital Marketing, and Branding.
Your goal is to answer customer queries, showcase the company's expertise, and guide them towards working with us.
If the customer wants to talk to a human or discuss a complex project, acknowledge it and let them know you will have a human representative contact them shortly (you can pretend you are taking their details or connecting them).

CRITICAL: Keep your responses extremely short, concise, and to the point. Limit responses to 1-3 sentences at most.
CRITICAL: NEVER repeat the same information or pitch in consecutive messages. If the user gives a short reply (like "ok", "yes", "sure"), respond with a natural, brief human-like acknowledgment (e.g., "Sounds good!", "Got it!", "Let's do it!", "Understood.") without repeating company details.
`;

const chatHistories = {};
const MAX_HISTORY_LENGTH = 15;

console.log('🤖 Pixbit Solutions Assistant Bot is starting...');
console.log(`Using Ollama model: ${ollamaModel}`);

// Handle incoming messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userMessage = msg.text;

  // Ignore non-text messages for now
  if (!userMessage) return;

  bot.sendChatAction(chatId, 'typing');

  try {
    if (!chatHistories[chatId]) {
      chatHistories[chatId] = [{ role: 'system', content: SYSTEM_PROMPT }];
    }

    // Add user message to history
    chatHistories[chatId].push({ role: 'user', content: userMessage });

    if (chatHistories[chatId].length > MAX_HISTORY_LENGTH + 1) {
      chatHistories[chatId] = [
        chatHistories[chatId][0],
        ...chatHistories[chatId].slice(-MAX_HISTORY_LENGTH)
      ];
    }

    // Call local Ollama with full history
    const response = await ollama.chat({
      model: ollamaModel,
      messages: chatHistories[chatId]
    });

    const botReply = response.message.content || 'I have completed the task.';

    // Add bot reply to history
    chatHistories[chatId].push({ role: 'assistant', content: botReply });

    // Send reply back to the user
    if (botReply.length > 4000) {
      const chunks = botReply.match(/(.|[\r\n]){1,4000}/g);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk);
      }
    } else {
      await bot.sendMessage(chatId, botReply);
    }

  } catch (error) {
    console.error('Error communicating with Ollama:', error.message);
    bot.sendMessage(chatId, 'Sorry, I am currently facing technical difficulties. Please try again later.');
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling Error:', error.code, error.message);
});

console.log('✅ Bot is running. Send a message to your bot on Telegram!');
