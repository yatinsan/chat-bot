import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

export async function initDB() {
  db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      chat_id TEXT PRIMARY KEY,
      name TEXT,
      contact TEXT,
      insights TEXT,
      service TEXT,
      meeting_time TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const columns = await db.all('PRAGMA table_info(leads)');
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('stack')) await db.exec('ALTER TABLE leads ADD COLUMN stack TEXT');
  if (!names.has('lead_score')) await db.exec('ALTER TABLE leads ADD COLUMN lead_score INTEGER');
  if (!names.has('score_reason')) await db.exec('ALTER TABLE leads ADD COLUMN score_reason TEXT');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS business_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      company_name TEXT NOT NULL,
      location TEXT NOT NULL,
      website TEXT NOT NULL,
      services TEXT NOT NULL,
      about TEXT NOT NULL,
      website_knowledge TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      preferred_text TEXT NOT NULL,
      preferred_at TEXT,
      timezone TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      proposed_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS chat_summaries (
      chat_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('📦 Database initialized (Iterative Leads & Chat History).');
}

export const BUSINESS_LIMITS = {
  company_name: 120,
  location: 120,
  website: 300,
  services: 2000,
  about: 4000,
  website_knowledge: 6000,
};

export const DEFAULT_BUSINESS_PROFILE = {
  company_name: 'Pixbit Solutions',
  location: 'Dubai',
  website: 'www.pixbitsolutions.com',
  services: '- Websites\n- Mobile apps (Android and iOS)\n- SEO, digital marketing, and branding',
  about: '',
  website_knowledge: '',
};

function cleanProfileText(value, max) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

export function normalizeBusinessProfile(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const profile = {};
  for (const [key, max] of Object.entries(BUSINESS_LIMITS)) {
    const hasValue = Object.prototype.hasOwnProperty.call(source, key) && source[key] != null;
    profile[key] = hasValue ? cleanProfileText(source[key], max) : DEFAULT_BUSINESS_PROFILE[key];
  }
  if (!profile.company_name) profile.company_name = DEFAULT_BUSINESS_PROFILE.company_name;
  if (!profile.location) profile.location = DEFAULT_BUSINESS_PROFILE.location;
  if (!profile.website) profile.website = DEFAULT_BUSINESS_PROFILE.website;
  if (!profile.services) profile.services = DEFAULT_BUSINESS_PROFILE.services;
  return profile;
}

export async function getBusinessProfile() {
  if (!db) await initDB();
  const row = await db.get(
    'SELECT company_name, location, website, services, about, website_knowledge FROM business_profile WHERE id = 1'
  );
  if (!row) return { ...DEFAULT_BUSINESS_PROFILE };
  return normalizeBusinessProfile(row);
}

export async function saveBusinessProfile(input) {
  if (!db) await initDB();
  const profile = normalizeBusinessProfile(input);
  await db.run(
    `INSERT INTO business_profile (
       id, company_name, location, website, services, about, website_knowledge, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       company_name=excluded.company_name,
       location=excluded.location,
       website=excluded.website,
       services=excluded.services,
       about=excluded.about,
       website_knowledge=excluded.website_knowledge,
       updated_at=CURRENT_TIMESTAMP`,
    [
      profile.company_name,
      profile.location,
      profile.website,
      profile.services,
      profile.about,
      profile.website_knowledge,
    ]
  );
  return profile;
}

export async function upsertLead(chatId, data) {
  if (!db) await initDB();
  
  // Fetch existing
  const existing = await db.get('SELECT * FROM leads WHERE chat_id = ?', [chatId]);
  
  const name = data.name || (existing ? existing.name : 'Anonymous');
  const contact = data.contact || (existing ? existing.contact : 'Not provided');
  const service = data.service || (existing ? existing.service : 'Not specified');
  const meeting_time = data.meeting_time || (existing ? existing.meeting_time : '');
  const stack = data.stack || (existing ? existing.stack : '') || '';
  const score_reason = data.score_reason || (existing ? existing.score_reason : '') || '';
  let lead_score = existing ? existing.lead_score : null;
  if (data.lead_score !== undefined && data.lead_score !== null && data.lead_score !== '') {
    const parsed = Number(data.lead_score);
    if (Number.isFinite(parsed)) lead_score = Math.max(1, Math.min(10, Math.round(parsed)));
  }
  
  // Combine insights
  let insights = existing ? existing.insights : '';
  if (data.insights) {
    if (!insights) {
      insights = '- ' + data.insights;
    } else if (!insights.includes(data.insights)) {
      insights += '\n- ' + data.insights;
    }
  }

  await db.run(
    `INSERT INTO leads (chat_id, name, contact, insights, service, meeting_time, stack, lead_score, score_reason, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(chat_id) DO UPDATE SET
      name=excluded.name,
      contact=excluded.contact,
      insights=excluded.insights,
      service=excluded.service,
      meeting_time=excluded.meeting_time,
      stack=excluded.stack,
      lead_score=excluded.lead_score,
      score_reason=excluded.score_reason,
      updated_at=CURRENT_TIMESTAMP`,
    [chatId.toString(), name, contact, insights, service, meeting_time, stack, lead_score, score_reason]
  );
}

// Per-chat meeting counts, used to derive tags without storing them.
const MEETING_COUNTS_SQL = (chatExpr) => `
      (SELECT COUNT(*) FROM meetings m WHERE m.chat_id = ${chatExpr}) AS meeting_requests,
      (SELECT COUNT(*) FROM meetings m WHERE m.chat_id = ${chatExpr} AND m.status IN ('pending', 'countered')) AS pending_meetings,
      (SELECT COUNT(*) FROM meetings m WHERE m.chat_id = ${chatExpr} AND m.status = 'confirmed') AS confirmed_meetings`;

// Tags are derived on every read so they can never drift from the data.
export function tagsFor(row) {
  const tags = [];
  if (Number(row.meeting_requests) > 0) tags.push('wants_meeting');
  if (Number(row.pending_meetings) > 0) tags.push('pending_approval');
  if (Number(row.confirmed_meetings) > 0) tags.push('meeting_confirmed');
  if (Number(row.lead_score) >= 7) tags.push('hot_lead');
  return tags;
}

function withTags(row) {
  return { ...row, tags: tagsFor(row) };
}

export async function getEnquiries() {
  if (!db) await initDB();
  const rows = await db.all(
    `SELECT l.*, ${MEETING_COUNTS_SQL('l.chat_id')} FROM leads l ORDER BY l.updated_at DESC`
  );
  return rows.map(withTags);
}

export async function createMeeting(chatId, fields) {
  if (!db) await initDB();
  const result = await db.run(
    `INSERT INTO meetings (chat_id, preferred_text, preferred_at, timezone, note, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [chatId.toString(), fields.preferred_text, fields.preferred_at ?? null, fields.timezone ?? null, fields.note ?? null]
  );
  return getMeeting(result.lastID);
}

export async function getMeeting(id) {
  if (!db) await initDB();
  return db.get('SELECT * FROM meetings WHERE id = ?', [Number(id)]);
}

export async function getOpenMeetingForChat(chatId) {
  if (!db) await initDB();
  return db.get(
    "SELECT * FROM meetings WHERE chat_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
    [chatId.toString()]
  );
}

export async function updateMeetingRequest(id, fields) {
  if (!db) await initDB();
  await db.run(
    'UPDATE meetings SET preferred_text = ?, preferred_at = ?, timezone = ?, note = COALESCE(?, note) WHERE id = ?',
    [fields.preferred_text, fields.preferred_at ?? null, fields.timezone ?? null, fields.note ?? null, Number(id)]
  );
  return getMeeting(id);
}

export async function decideMeeting(id, status, proposedText = null) {
  if (!db) await initDB();
  await db.run(
    'UPDATE meetings SET status = ?, proposed_text = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, proposedText, Number(id)]
  );
  return getMeeting(id);
}

// A request is flagged when another open or confirmed meeting has the exact same start time.
export async function listMeetings() {
  if (!db) await initDB();
  const rows = await db.all(`
    SELECT
      m.*,
      l.name,
      l.contact,
      l.service,
      EXISTS (
        SELECT 1 FROM meetings o
        WHERE o.id != m.id
          AND o.preferred_at IS NOT NULL
          AND o.preferred_at = m.preferred_at
          AND o.status IN ('pending', 'countered', 'confirmed')
      ) AS conflict
    FROM meetings m
    LEFT JOIN leads l ON l.chat_id = m.chat_id
    ORDER BY
      CASE m.status WHEN 'pending' THEN 0 WHEN 'countered' THEN 1 ELSE 2 END,
      m.created_at DESC,
      m.id DESC
  `);
  return rows.map((row) => ({ ...row, conflict: Boolean(row.conflict) }));
}

export async function getLead(chatId) {
  if (!db) await initDB();
  return await db.get('SELECT * FROM leads WHERE chat_id = ?', [chatId.toString()]);
}

export async function deleteChat(chatId) {
  if (!db) await initDB();
  const id = chatId.toString();
  await db.exec('BEGIN');
  try {
    await db.run('DELETE FROM messages WHERE chat_id = ?', [id]);
    await db.run('DELETE FROM meetings WHERE chat_id = ?', [id]);
    await db.run('DELETE FROM leads WHERE chat_id = ?', [id]);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

export async function saveMessage(chatId, role, content) {
  if (!db) await initDB();
  const result = await db.run(
    'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
    [chatId.toString(), role, content]
  );
  return db.get('SELECT * FROM messages WHERE id = ?', [result.lastID]);
}

export async function getChatHistory(chatId) {
  if (!db) await initDB();
  return db.all(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC',
    [chatId.toString()]
  );
}

export async function listChats() {
  if (!db) await initDB();
  const rows = await db.all(`
    SELECT
      chats.chat_id,
      l.name,
      l.contact,
      l.service,
      l.stack,
      l.insights,
      l.meeting_time,
      l.lead_score,
      l.score_reason,
      ${MEETING_COUNTS_SQL('chats.chat_id')},
      chats.message_count,
      last.content AS last_message,
      last.role AS last_role,
      last.created_at AS last_at
    FROM (
      SELECT chat_id, COUNT(*) AS message_count, MAX(id) AS last_id
      FROM messages
      GROUP BY chat_id
    ) chats
    JOIN messages last ON last.id = chats.last_id
    LEFT JOIN leads l ON l.chat_id = chats.chat_id
    ORDER BY chats.last_id DESC
  `);
  return rows.map(withTags);
}

export async function getStats() {
  if (!db) await initDB();
  return db.get(`
    SELECT
      (SELECT COUNT(*) FROM leads) AS leads,
      (SELECT COUNT(*) FROM messages) AS messages,
      (SELECT COUNT(DISTINCT chat_id) FROM messages) AS chats,
      (SELECT COUNT(*) FROM meetings WHERE status = 'confirmed') AS meetings,
      (SELECT COUNT(*) FROM meetings WHERE status IN ('pending', 'countered')) AS pending_meetings
  `);
}

export async function getMessageCount(chatId) {
  if (!db) await initDB();
  const row = await db.get('SELECT COUNT(*) AS count FROM messages WHERE chat_id = ?', [chatId.toString()]);
  return Number(row?.count) || 0;
}

export async function getChatSummary(chatId) {
  if (!db) await initDB();
  const row = await db.get('SELECT * FROM chat_summaries WHERE chat_id = ?', [chatId.toString()]);
  if (!row) return null;
  return { summary: JSON.parse(row.summary), message_count: row.message_count, updated_at: row.updated_at };
}

export async function saveChatSummary(chatId, summary, messageCount) {
  if (!db) await initDB();
  await db.run(
    `INSERT INTO chat_summaries (chat_id, summary, message_count, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(chat_id) DO UPDATE SET
       summary=excluded.summary,
       message_count=excluded.message_count,
       updated_at=CURRENT_TIMESTAMP`,
    [chatId.toString(), JSON.stringify(summary), messageCount]
  );
}
