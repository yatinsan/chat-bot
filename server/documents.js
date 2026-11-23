// Pulls plain text out of an uploaded knowledge file (PDF or text).
import { extractText, getDocumentProxy } from 'unpdf';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm'];

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function extension(name) {
  const match = /\.[^./\\]+$/.exec(String(name || '').toLowerCase());
  return match ? match[0] : '';
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractDocumentText(buffer, filename) {
  if (!buffer?.length) throw fail('That file is empty.');
  const ext = extension(filename);
  const isPdf = ext === '.pdf' || buffer.subarray(0, 5).toString('latin1') === '%PDF-';

  let text;
  if (isPdf) {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      ({ text } = await extractText(pdf, { mergePages: true }));
    } catch {
      throw fail('Could not read that PDF. It may be damaged or password protected.');
    }
  } else if (TEXT_EXTENSIONS.includes(ext)) {
    text = buffer.toString('utf8');
    if (ext === '.html' || ext === '.htm') text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  } else {
    throw fail('Unsupported file type. Upload a PDF, TXT, MD, or CSV file.', 415);
  }

  text = cleanText(text);
  if (!text) throw fail('No text found in that file. Scanned PDFs (images) are not supported.');
  return text;
}
