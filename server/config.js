import dotenv from 'dotenv';

dotenv.config();

function readNonNegativeMs(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const PORT = process.env.PORT || 3000;
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
export const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
export const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

export const MESSAGE_DELAYS = {
  minMs: readNonNegativeMs('MESSAGE_DELAY_MIN_MS', 350),
  maxMs: readNonNegativeMs('MESSAGE_DELAY_MAX_MS', 1100),
  perCharMs: readNonNegativeMs('MESSAGE_DELAY_PER_CHAR_MS', 12),
  gapMs: 200,
};
