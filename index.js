import TelegramBot from 'node-telegram-bot-api';
import { Ollama } from 'ollama';
import dotenv from 'dotenv';
import { getRunningMovies, getMovieSlots } from './services/bookMyShowScraper.js';

// Load environment variables
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const ollamaModel = process.env.OLLAMA_MODEL || 'gemma4:12b'; // 3.1 is recommended for tool calling

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
You are a helpful, professional, and friendly Film Booking Assistant.
Your job is to help customers find new movies running in theaters and check ticket availability or book tickets.
Use the provided tools to search for movies in a specific city, and to get booking links for movies.
If the user does not specify a city when asking for movies, ask them which city they are in.
CRITICAL: You must keep your responses extremely short, concise, and to the point. Limit responses to 1-2 sentences at most.
`;

const chatHistories = {};
const MAX_HISTORY_LENGTH = 15;

const callbackCache = {};
let callbackIdCounter = 0;

const tools = [
  {
    type: 'function',
    function: {
      name: 'getRunningMovies',
      description: 'Search for currently running new movies in a specific city on BookMyShow.',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: 'The city to search in, e.g., mumbai, bangalore, kochi, etc.'
          }
        },
        required: ['city']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getMovieSlots',
      description: 'Check available slots and get a booking link for a specific movie on BookMyShow.',
      parameters: {
        type: 'object',
        properties: {
          movieUrl: {
            type: 'string',
            description: 'The full BookMyShow movie URL.'
          }
        },
        required: ['movieUrl']
      }
    }
  }
];

console.log('🤖 Film Booking Bot is starting...');
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
    chatHistories[chatId].push({ role: 'user', content: userMessage + '\n\n(Reply very briefly, max 1-2 sentences)' });

    if (chatHistories[chatId].length > MAX_HISTORY_LENGTH + 1) {
      chatHistories[chatId] = [
        chatHistories[chatId][0],
        ...chatHistories[chatId].slice(-MAX_HISTORY_LENGTH)
      ];
    }

    // Call local Ollama with full history and tools
    let response = await ollama.chat({
      model: ollamaModel,
      messages: chatHistories[chatId],
      tools: tools
    });

    let replyMarkup = null;

    let toolCalls = response.message.tool_calls || [];

    // Fallback heuristic for models that fail to use tool_calls natively
    if (toolCalls.length === 0) {
      const movieMatch = userMessage.match(/(?:movies|films|shows).*?\b(?:in|at|for)\s+([a-zA-Z]+)/i);
      if (movieMatch) {
        console.log('[Fallback] Model ignored tools. Manually triggering getRunningMovies for city:', movieMatch[1]);
        toolCalls = [{
          function: {
            name: 'getRunningMovies',
            arguments: { city: movieMatch[1].toLowerCase() }
          }
        }];
      }
    }

    // Check if we have tool calls (either from Ollama or our fallback)
    if (toolCalls.length > 0) {
      // Only push the message to history if it actually came from Ollama tool calls
      if (response.message.tool_calls && response.message.tool_calls.length > 0) {
        chatHistories[chatId].push(response.message);
      }

      for (const toolCall of toolCalls) {
        console.log(`[Tool Call] Executing ${toolCall.function.name}`);
        const args = toolCall.function.arguments;
        let toolResult = null;

        if (toolCall.function.name === 'getRunningMovies') {
          await bot.sendMessage(chatId, 'Let me check the latest movies for you... (this might take a few seconds)');
          bot.sendChatAction(chatId, 'typing');
          toolResult = await getRunningMovies(args.city);

          if (Array.isArray(toolResult) && toolResult.length > 0 && !toolResult.error) {
            replyMarkup = {
              inline_keyboard: toolResult.map(movie => {
                const cId = `m_${++callbackIdCounter}`;
                callbackCache[cId] = movie.url;
                return [{ text: movie.title, callback_data: cId }];
              })
            };
          }
        } else if (toolCall.function.name === 'getMovieSlots') {
          await bot.sendMessage(chatId, 'Checking available slots... (this might take a few seconds)');
          bot.sendChatAction(chatId, 'typing');
          toolResult = await getMovieSlots(args.movieUrl);
        }

        chatHistories[chatId].push({
          role: 'tool',
          content: JSON.stringify(toolResult),
          name: toolCall.function.name
        });
      }

      // After tool execution, call Ollama again to get the final response
      response = await ollama.chat({
        model: ollamaModel,
        messages: chatHistories[chatId],
        tools: tools
      });
    }

    const botReply = response.message.content || 'I have completed the task.';

    // Add bot reply to history
    chatHistories[chatId].push({ role: 'assistant', content: botReply });

    if (botReply.length > 4000) {
      const chunks = botReply.match(/(.|[\r\n]){1,4000}/g);
      for (let i = 0; i < chunks.length; i++) {
        if (i === chunks.length - 1 && replyMarkup) {
          await bot.sendMessage(chatId, chunks[i], { reply_markup: replyMarkup });
        } else {
          await bot.sendMessage(chatId, chunks[i]);
        }
      }
    } else {
      if (replyMarkup) {
        await bot.sendMessage(chatId, botReply, { reply_markup: replyMarkup });
      } else {
        await bot.sendMessage(chatId, botReply);
      }
    }

  } catch (error) {
    console.error('Error communicating with Ollama:', error.message);
    bot.sendMessage(chatId, 'Sorry, I am currently facing technical difficulties. Please try again later.');
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling Error:', error.code, error.message);
});

bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;

  bot.answerCallbackQuery(callbackQuery.id);

  if (data.startsWith('m_')) {
    const url = callbackCache[data];
    if (url) {
      bot.sendMessage(chatId, `Checking slots for the selected movie...`);
      bot.sendChatAction(chatId, 'typing');
      const toolResult = await getMovieSlots(url);
      if (toolResult && toolResult.bookingUrl) {
        bot.sendMessage(chatId, `🎟 Found booking page! You can check available slots and seats here: \n${toolResult.bookingUrl}`);
      } else {
        bot.sendMessage(chatId, toolResult.message || 'Could not find booking page.');
      }
    } else {
      bot.sendMessage(chatId, 'Sorry, this movie session has expired. Please search again.');
    }
  }
});

console.log('✅ Bot is running. Send a message to your bot on Telegram!');
