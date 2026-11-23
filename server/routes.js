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
import { scrapeWebsite } from './scraper.js';
import { buildChatSummary, summaryPayload } from './summary.js';
import { formatBusinessTime } from './time.js';

// engine: the chat engine; askJson(prompt): the model call used for summaries.
export function createApiRouter({ engine, broadcast, askJson }) {
  const router = express.Router();

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
      res.json(await listChats());
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

  router.get('/settings', async (_req, res) => {
    try {
      res.json(await getBusinessProfile());
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
      res.json(await saveBusinessProfile(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/settings/scrape', async (req, res) => {
    try {
      const scraped = await scrapeWebsite(req.body?.url);
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
