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

  console.log('📦 Database initialized (Iterative Leads & Chat History).');
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

export async function getEnquiries() {
  if (!db) await initDB();
  return await db.all('SELECT * FROM leads ORDER BY updated_at DESC');
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
  return db.all(`
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
}

export async function getStats() {
  if (!db) await initDB();
  return db.get(`
    SELECT
      (SELECT COUNT(*) FROM leads) AS leads,
      (SELECT COUNT(*) FROM messages) AS messages,
      (SELECT COUNT(DISTINCT chat_id) FROM messages) AS chats,
      (SELECT COUNT(*) FROM leads WHERE meeting_time IS NOT NULL AND TRIM(meeting_time) != '') AS meetings
  `);
}
