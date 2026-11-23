// Where a reply goes once it is saved: the website chat (over the WebSocket
// broadcast) or Telegram. Chat ids that start with "web-" are website visitors.
import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_BOT_TOKEN } from './config.js';

export function channelFor(chatId) {
  return String(chatId).startsWith('web-') ? 'web' : 'telegram';
}

export function createTelegramBot() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN is not set. Website chat still works; Telegram replies are disabled.');
    return null;
  }
  return new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
}

// The chat engine talks to channels only through this object, so tests can pass a fake.
export function createTransport(bot) {
  return {
    hasTelegram: Boolean(bot),

    async send(chatId, text, channel) {
      if (channel !== 'telegram') return; // Website visitors get the message from the broadcast.
      if (!bot) throw new Error('Telegram bot is not configured');
      await bot.sendMessage(chatId, text);
    },

    // Shows "typing…" in Telegram until the returned function is called.
    startTyping(chatId, channel) {
      if (channel !== 'telegram' || !bot) return () => {};
      bot.sendChatAction(chatId, 'typing').catch(() => {});
      const interval = setInterval(() => bot.sendChatAction(chatId, 'typing').catch(() => {}), 4000);
      return () => clearInterval(interval);
    },
  };
}

export function listenToTelegram(bot, onMessage) {
  if (!bot) return;
  bot.on('message', async (msg) => {
    const text = msg.text ? msg.text.trim() : '';
    if (text) await onMessage(String(msg.chat.id), text);
  });
  bot.on('polling_error', (error) => {
    console.error('Polling Error:', error.code, error.message);
  });
  console.log('✅ Telegram bot is running.');
}
