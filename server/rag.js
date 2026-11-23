// RAG for the business knowledge: split it into chunks, embed them, and pull
// back only the chunks that match what the customer is asking about.
// Without embeddings (no API key, or the embedding call fails) it falls back
// to keyword scoring, so retrieval still works offline.
import { createHash } from 'node:crypto';
import { getKnowledgeChunks, replaceKnowledgeChunks } from '../database.js';

export const CHUNK_SIZE = 900;
export const CHUNK_OVERLAP = 150;
export const TOP_K = 4;
const MIN_SCORE = 0.05;

const STOP_WORDS = new Set(('a an and are as at be but by can do does for from has have how i if in is it its me '
  + 'my of on or our so that the their them there they this to was we what when where which who why will with '
  + 'you your hi hello hey please thanks ok okay').split(' '));

export function knowledgeHash(text) {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

function splitLong(text, size) {
  // Break at sentence ends, then at spaces, so a chunk never cuts a word.
  const pieces = text.match(/[^.!?\n]+[.!?]*\s*/g) || [text];
  const out = [];
  for (const piece of pieces) {
    if (piece.length <= size) { out.push(piece); continue; }
    let rest = piece;
    while (rest.length > size) {
      let cut = rest.lastIndexOf(' ', size);
      if (cut < size / 2) cut = size;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest) out.push(rest);
  }
  return out;
}

// Splits text into chunks of about `size` characters that overlap a little,
// keeping paragraphs together where they fit.
export function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const clean = String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  const units = clean.split(/\n{2,}|\n(?=[-*•]|\d+\.)/).flatMap((para) => splitLong(`${para.trim()}\n`, size));
  const chunks = [];
  let current = '';
  for (const unit of units) {
    if (current && current.length + unit.length > size) {
      chunks.push(current.trim());
      const tail = current.slice(-overlap);
      const space = tail.indexOf(' ');
      current = space >= 0 ? tail.slice(space + 1) : '';
    }
    current += unit;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map((word) => (word.length > 4 ? word.replace(/(ing|es|s)$/, '') : word));
}

// BM25 score of each chunk for the query, scaled to 0..1.
export function keywordScores(query, chunks) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !chunks.length) return chunks.map(() => 0);
  const docs = chunks.map((chunk) => tokenize(chunk.content));
  const avg = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1;
  const df = new Map(terms.map((term) => [term, docs.filter((doc) => doc.includes(term)).length]));
  const raw = docs.map((doc) => {
    let score = 0;
    for (const term of terms) {
      const tf = doc.filter((word) => word === term).length;
      if (!tf) continue;
      const idf = Math.log(1 + (docs.length - df.get(term) + 0.5) / (df.get(term) + 0.5));
      score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (doc.length / avg))));
    }
    return score;
  });
  const max = Math.max(...raw);
  return raw.map((score) => (max > 0 ? score / max : 0));
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Ranks chunks for the query. With a query vector, meaning (cosine) leads and
// keywords break ties; without one, keywords alone decide.
export function rankChunks(query, chunks, queryVector = null, k = TOP_K) {
  const keywords = keywordScores(query, chunks);
  const scored = chunks.map((chunk, i) => {
    const semantic = queryVector && chunk.embedding ? cosine(queryVector, chunk.embedding) : null;
    const score = semantic == null ? keywords[i] : 0.75 * semantic + 0.25 * keywords[i];
    return { ...chunk, score };
  });
  return scored
    .filter((chunk) => chunk.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .sort((a, b) => a.position - b.position);
}

/**
 * embed(texts, signal) -> number[][]  (optional; omit to use keywords only)
 */
export function createKnowledgeBase({ embed } = {}) {
  let indexing = null;

  // Rebuilds the index when the knowledge text changed (or embeddings are missing and can be made now).
  async function reindex(profile, { force = false } = {}) {
    const text = profile?.knowledge_mode === 'rag' ? String(profile.website_knowledge || '') : '';
    const hash = knowledgeHash(text);
    const existing = await getKnowledgeChunks();
    const sameText = existing.length ? existing[0].source_hash === hash : !text.trim();
    const fullyEmbedded = existing.every((chunk) => chunk.embedding);
    if (!force && sameText && (fullyEmbedded || !embed)) return status(existing);

    const pieces = chunkText(text);
    let vectors = [];
    let warning = '';
    if (embed && pieces.length) {
      try {
        vectors = await embed(pieces);
      } catch (error) {
        warning = `Embeddings failed (${error.message}). Using keyword search for now.`;
        console.error('[RAG]', warning);
      }
    }
    await replaceKnowledgeChunks(hash, pieces.map((content, i) => ({ content, embedding: vectors[i] || null })));
    const result = status(await getKnowledgeChunks());
    if (warning) result.warning = warning;
    console.log(`[RAG] Indexed ${pieces.length} knowledge chunks (${result.search} search).`);
    return result;
  }

  function status(chunks) {
    const embedded = chunks.filter((chunk) => chunk.embedding).length;
    return {
      chunks: chunks.length,
      embedded,
      search: chunks.length && embedded === chunks.length ? 'semantic' : 'keyword',
    };
  }

  // Serialises reindexing so two saves in a row cannot interleave.
  function reindexQueued(profile, options) {
    const run = (indexing || Promise.resolve()).catch(() => {}).then(() => reindex(profile, options));
    indexing = run;
    return run;
  }

  async function retrieve(query, { k = TOP_K, signal } = {}) {
    const text = String(query || '').trim();
    if (!text) return [];
    const chunks = await getKnowledgeChunks();
    if (!chunks.length) return [];
    let queryVector = null;
    if (embed && chunks.some((chunk) => chunk.embedding)) {
      try {
        [queryVector] = await embed([text], signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        console.error('[RAG] Query embedding failed, using keywords:', error.message);
      }
    }
    return rankChunks(text, chunks, queryVector, k).map(({ content, score, position }) => ({ content, score, position }));
  }

  async function getStatus() {
    return status(await getKnowledgeChunks());
  }

  return { reindex: reindexQueued, retrieve, status: getStatus };
}
