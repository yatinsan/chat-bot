// Dashboard JSON API under /api.
import express from 'express';
import {
  decideMeeting,
  deleteChat,
  getBusinessProfile,
  getChatHistory,
  getEnquiries,
  getLead,
  getMeeting,
  getStats,
  listChats,
  listMeetings,
  promoteLeadToMeeting,
  saveBusinessProfile,
  setLeadStatus,
} from '../database.js';
import { extractDocumentText, MAX_UPLOAD_BYTES } from './documents.js';
import { scrapeWebsite } from './scraper.js';
import { buildChatSummary, summaryPayload } from './summary.js';
import { formatBusinessTime } from './time.js';
import { synthesize } from './tts.js';
import { isInCall } from './calls.js';

// engine: the chat engine; askJson(prompt): the model call used for summaries;
// knowledge: the RAG knowledge base (reindex, retrieve, status).
export function createApiRouter({ engine, broadcast, askJson, knowledge }) {
  const router = express.Router();

  router.post('/tts', async (req, res) => {
    try {
      const audio = await synthesize(req.body?.text);
      res.type('audio/wav').send(audio);
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  router.get('/enquiries', async (req, res) => {
    try {
      const enquiries = await getEnquiries();
      res.json(enquiries);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/messages/:chatId', async (req, res) => {
    try {
      const messages = await getChatHistory(req.params.chatId);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/chats', async (req, res) => {
    try {
      res.json((await listChats()).map((chat) => ({ ...chat, in_call: isInCall(chat.chat_id) })));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/stats', async (req, res) => {
    try {
      res.json(await getStats());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  async function withIndex(profile, indexed) {
    if (!knowledge) return profile;
    return { ...profile, knowledge_index: indexed || await knowledge.status() };
  }

  router.get('/settings', async (_req, res) => {
    try {
      res.json(await withIndex(await getBusinessProfile()));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/settings', async (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        res.status(400).json({ error: 'Settings must be an object.' });
        return;
      }
      const profile = await saveBusinessProfile(req.body);
      let indexed;
      if (knowledge) {
        try {
          indexed = await knowledge.reindex(profile);
        } catch (error) {
          indexed = { ...(await knowledge.status()), warning: `Saved, but the knowledge index failed: ${error.message}` };
        }
      }
      res.json(await withIndex(profile, indexed));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Rebuilds the RAG index (and its embeddings) from the saved knowledge.
  router.post('/settings/knowledge/reindex', async (_req, res) => {
    if (!knowledge) { res.status(404).json({ error: 'RAG is not available.' }); return; }
    try {
      const indexed = await knowledge.reindex(await getBusinessProfile(), { force: true });
      res.json(indexed);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Shows which knowledge chunks a customer message would pull in.
  router.post('/settings/knowledge/search', async (req, res) => {
    if (!knowledge) { res.status(404).json({ error: 'RAG is not available.' }); return; }
    const query = String(req.body?.query || '').trim().slice(0, 500);
    if (!query) { res.status(400).json({ error: 'Type a question to search for.' }); return; }
    try {
      res.json({ results: await knowledge.retrieve(query) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Reads text out of an uploaded file (raw body, name in X-Filename). The text
  // is returned for review; it is added to the knowledge when the user saves.
  router.post('/settings/knowledge/extract', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), async (req, res) => {
    try {
      let filename = '';
      try { filename = decodeURIComponent(String(req.get('x-filename') || '')); } catch { /* keep blank */ }
      const text = await extractDocumentText(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), filename);
      res.json({ filename, text, characters: text.length });
    } catch (error) {
      res.status(error.statusCode || (error.type === 'entity.too.large' ? 413 : 400))
        .json({ error: error.type === 'entity.too.large' ? 'That file is too large (10 MB max).' : error.message });
    }
  });

  router.post('/settings/scrape', async (req, res) => {
    try {
      const scraped = await scrapeWebsite(req.body?.url, { mode: req.body?.mode });
      res.json(scraped);
    } catch (error) {
      const status = error.statusCode || 400;
      res.status(status).json({ error: error.message });
    }
  });

  router.delete('/leads/:chatId', async (req, res) => {
    try {
      const chatId = String(req.params.chatId);
      engine.forgetChat(chatId);
      await deleteChat(chatId);
      broadcast({ type: 'lead_deleted', chatId });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch('/leads/:chatId/status', async (req, res) => {
    try {
      const lead = await setLeadStatus(String(req.params.chatId), String(req.body?.status || ''));
      if (!lead) {
        res.status(404).json({ error: 'Lead not found.' });
        return;
      }
      broadcast({ type: 'lead', lead });
      res.json(lead);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Take over a chat (paused: true) or turn the AI back on (paused: false).
  router.patch('/chats/:chatId/ai', async (req, res) => {
    try {
      if (typeof req.body?.paused !== 'boolean') {
        res.status(400).json({ error: 'paused must be true or false.' });
        return;
      }
      const chatId = String(req.params.chatId);
      const aiPaused = await engine.setAiPaused(chatId, req.body.paused);
      res.json({ chat_id: chatId, ai_paused: aiPaused });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/chats/:chatId/summary', async (req, res) => {
    try {
      res.json(await summaryPayload(String(req.params.chatId)));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/chats/:chatId/summary', async (req, res) => {
    try {
      const chatId = String(req.params.chatId);
      await buildChatSummary(chatId, askJson);
      res.json(await summaryPayload(chatId));
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  router.get('/meetings', async (_req, res) => {
    try {
      res.json(await listMeetings());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Team decision on a meeting request. The customer is told right away in the same chat.
  router.post('/meetings/:id/decision', async (req, res) => {
    try {
      const meeting = await getMeeting(req.params.id);
      if (!meeting) {
        res.status(404).json({ error: 'Meeting request not found.' });
        return;
      }
      if (!['pending', 'countered'].includes(meeting.status)) {
        res.status(409).json({ error: `This request is already ${meeting.status}.` });
        return;
      }

      const decision = String(req.body?.decision || '');
      const timezone = meeting.timezone || (await getBusinessProfile()).timezone;
      const when = meeting.preferred_at ? formatBusinessTime(meeting.preferred_at, timezone) : meeting.preferred_text;
      let status;
      let text;
      let proposed = null;

      if (decision === 'approve') {
        status = 'confirmed';
        text = `Great, we're on for ${when}. We'll see you then.`;
      } else if (decision === 'reject') {
        status = 'rejected';
        text = "Sorry, that time doesn't work on our side. Could you share another day or time that suits you?";
      } else if (decision === 'counter') {
        proposed = String(req.body?.proposed_text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!proposed) {
          res.status(400).json({ error: 'Type the time you want to suggest.' });
          return;
        }
        status = 'countered';
        text = `How about ${proposed}? Let us know if that works for you.`;
      } else {
        res.status(400).json({ error: 'decision must be approve, reject, or counter.' });
        return;
      }

      await engine.sendTeamMessage(meeting.chat_id, text);
      await decideMeeting(meeting.id, status, proposed);
      if (status === 'confirmed') await promoteLeadToMeeting(meeting.chat_id);
      const updated = await getMeeting(meeting.id);
      broadcast({ type: 'meeting', meeting: updated });
      const lead = await getLead(meeting.chat_id);
      if (lead) broadcast({ type: 'lead', lead });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
