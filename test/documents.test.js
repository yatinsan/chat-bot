import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDocumentText } from '../server/documents.js';

test('reads plain text files', async () => {
  const text = await extractDocumentText(Buffer.from('Hello   world\r\n\r\n\r\n\r\nSecond'), 'faq.txt');
  assert.equal(text, 'Hello world\n\nSecond');
});

test('rejects unsupported and empty files', async () => {
  await assert.rejects(extractDocumentText(Buffer.from('x'), 'a.exe'), /Unsupported/);
  await assert.rejects(extractDocumentText(Buffer.alloc(0), 'a.txt'), /empty/);
});

test('extracts text from a PDF', async () => {
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    null, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  const stream = 'BT /F1 12 Tf 20 100 Td (Refund policy is 30 days) Tj ET';
  objs[3] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  assert.match(await extractDocumentText(Buffer.from(pdf), 'policy.pdf'), /Refund policy is 30 days/);
});
