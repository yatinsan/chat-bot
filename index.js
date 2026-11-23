import { createServer } from 'http';
import path from 'path';
import express from 'express';
import { getBusinessProfile, initDB } from './database.js';
import { GEMINI_MODEL, MESSAGE_DELAYS, PORT } from './server/config.js';
import { geminiChat, geminiConfigured, geminiEmbed, geminiJson } from './server/gemini.js';
import { createKnowledgeBase } from './server/rag.js';
import { createTelegramBot, createTransport, listenToTelegram } from './server/channels.js';
import { attachRealtime, broadcast } from './server/realtime.js';
import { createChatEngine } from './server/chat-engine.js';
import { createApiRouter } from './server/routes.js';
import { handleSockets } from './server/socket.js';
import { fetchPageText } from './server/scraper.js';

console.log('🤖 Assistant Bot (Tool Calling Edition) is starting...');
if (geminiConfigured) {
  console.log(`Using Gemini model: ${GEMINI_MODEL}`);
} else {
  console.warn('GEMINI_API_KEY is not set. Chat replies need a Gemini key.');
}

const bot = createTelegramBot();
const transport = createTransport(bot);
const knowledge = createKnowledgeBase({ embed: geminiConfigured ? geminiEmbed : undefined });
const engine = createChatEngine({
  completeChat: geminiChat,
  transport,
  broadcast,
  fetchPageText,
  retrieveKnowledge: knowledge.retrieve,
  delays: MESSAGE_DELAYS,
});

const app = express();
app.use(express.json({ limit: '256kb' }));
const publicDir = path.resolve('public');

app.get('/', (_req, res) => res.redirect('/admin'));
app.get(['/admin', '/chat'], (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use(express.static(publicDir));
app.use('/api', createApiRouter({ engine, broadcast, askJson: geminiJson, knowledge }));

const server = createServer(app);
handleSockets(attachRealtime(server), { engine, transport });
listenToTelegram(bot, (chatId, text) => engine.handleUserMessage(chatId, text, 'telegram'));

await initDB();
// Builds the RAG index on start if the knowledge changed or embeddings are missing.
knowledge.reindex(await getBusinessProfile()).catch((error) => console.error('[RAG] Startup indexing failed:', error.message));
server.listen(PORT, () => {
  console.log(`🌐 Dashboard running at http://localhost:${PORT}`);
});
