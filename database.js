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
    `INSERT INTO leads (chat_id, name, contact, insights, service, meeting_time, updated_at) 
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(chat_id) DO UPDATE SET 
      name=excluded.name, 
      contact=excluded.contact, 
      insights=excluded.insights, 
      service=excluded.service, 
      meeting_time=excluded.meeting_time,
      updated_at=CURRENT_TIMESTAMP`,
    [chatId.toString(), name, contact, insights, service, meeting_time]
  );
}

export async function getEnquiries() {
  if (!db) await initDB();
  return await db.all('SELECT * FROM leads ORDER BY updated_at DESC');
}

export async function saveMessage(chatId, role, content) {
  if (!db) await initDB();
  await db.run(
    'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
    [chatId.toString(), role, content]
  );
}

export async function getChatHistory(chatId) {
  if (!db) await initDB();
  return await db.all('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC', [chatId.toString()]);
}
