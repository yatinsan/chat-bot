// Text-to-speech through the local VoiceStudio app (OpenAI-compatible /v1/audio/speech).
import { createHash } from 'crypto';

export const VOICESTUDIO_URL = (process.env.VOICESTUDIO_URL || 'http://localhost:3900').replace(/\/$/, '');
const VOICE = process.env.VOICESTUDIO_VOICE || 'garuda-narrator-in';
const MAX_CHARS = 1500;
const CACHE_LIMIT = 40;

const cache = new Map(); // text hash -> Buffer (small LRU so replays are instant)
const pending = new Map(); // text hash -> Promise<Buffer> (collapses double taps)

export async function synthesize(text) {
  const input = String(text || '').trim().slice(0, MAX_CHARS);
  if (!input) throw new Error('Nothing to speak.');
  const key = createHash('sha1').update(input).digest('hex');

  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  if (pending.has(key)) return pending.get(key);

  const job = (async () => {
    let response;
    try {
      response = await fetch(`${VOICESTUDIO_URL}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input, voice: VOICE, response_format: 'wav' }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new Error('VoiceStudio is not reachable. Is the app running?');
    }
    if (!response.ok) throw new Error(`VoiceStudio failed (${response.status}).`);
    const audio = Buffer.from(await response.arrayBuffer());
    cache.set(key, audio);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return audio;
  })().finally(() => pending.delete(key));

  pending.set(key, job);
  return job;
}
