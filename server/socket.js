// Messages that arrive over the WebSocket: visitor chat messages and team replies.
import { randomUUID } from 'crypto';
import { channelFor } from './channels.js';
import { sendTo } from './realtime.js';
import { endCallsFor, setCall } from './calls.js';

export function handleSockets(wss, { engine, transport }) {
  wss.on('connection', (socket) => {
    sendTo(socket, { type: 'connected' });
    socket.on('close', () => endCallsFor(socket));

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
          // Replying as the team takes the chat over, so the AI does not answer on top of it.
          await engine.setAiPaused(chatId, true);
          await engine.sendTeamMessage(chatId, content);
        } catch (error) {
          sendTo(socket, { type: 'error', message: error.message });
        }
        return;
      }

      // The visitor started or ended a live voice call on this chat.
      if (data.type === 'call') {
        const chatId = String(data.chatId || '');
        if (chatId) setCall(chatId, socket, Boolean(data.active));
        return;
      }

      if (data.type !== 'send') return;

      const content = String(data.content || '').trim();
      if (!content) return;

      const chatId = data.chatId ? String(data.chatId) : `web-${randomUUID()}`;
      const channel = channelFor(chatId);

      if (channel === 'telegram' && !transport.hasTelegram) {
        sendTo(socket, { type: 'error', message: 'Telegram is not connected on this server.' });
        return;
      }

      if (!data.chatId) sendTo(socket, { type: 'chat_created', chatId });

      try {
        await engine.handleUserMessage(chatId, content, channel);
      } catch (error) {
        sendTo(socket, { type: 'error', message: error.message });
      }
    });
  });
}
