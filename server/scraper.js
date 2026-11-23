// Reads public websites: the Business profile scraper and the chat's website tool.
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { load as loadHtml } from 'cheerio';
import { BUSINESS_LIMITS, KNOWLEDGE_LIMITS } from '../database.js';

const SCRAPE_TIMEOUT_MS = 12000;
const SCRAPE_MAX_BYTES = 1_500_000;
const SCRAPE_MIN_TEXT = 400;

export function extractPage(html, limit) {
  const $ = loadHtml(html);
  const siteName = String($('meta[property="og:site_name"]').attr('content') || '').replace(/\s+/g, ' ').trim();
  const title = $('title').first().text().replace(/\s+/g, ' ').trim();
  const description = String(
    $('meta[name="description"]').attr('content')
    || $('meta[property="og:description"]').attr('content')
    || ''
  ).replace(/\s+/g, ' ').trim();
  const headings = [];
  $('h1, h2').each((_, el) => {
    const heading = $(el).text().replace(/\s+/g, ' ').trim();
    if (heading && !headings.includes(heading)) headings.push(heading);
  });
  $('script, style, noscript, svg').remove();
  $('p, div, h1, h2, h3, h4, li, tr, br, section, article').append(' ');
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, limit);
  return { title, description, siteName, headings: headings.slice(0, 12), text };
}

export function visiblePageText(html) {
  return extractPage(html, 1500).text;
}

function cleanCompanyName(value) {
  const piece = String(value || '').replace(/\s+/g, ' ').trim();
  if (piece.length < 2 || /^(home|welcome|index|untitled)$/i.test(piece)) return '';
  return piece.slice(0, BUSINESS_LIMITS.company_name);
}

function companyFromTitle(title) {
  const parts = String(title || '')
    .split(/\s+\|\s+|\s+[-–—]\s+/)
    .map((part) => cleanCompanyName(part))
    .filter(Boolean);
  if (!parts.length) return '';
  const compact = parts.find((part) => part.length <= 40 && part.split(/\s+/).length <= 4);
  return compact || parts[0];
}

function suggestCompanyName(extracted) {
  return cleanCompanyName(extracted.siteName) || companyFromTitle(extracted.title);
}

export function isPrivateIp(ip) {
  const normalized = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized.startsWith('::ffff:')) return isPrivateIp(normalized.slice(7));
  if (normalized.includes(':')) {
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fe80:')) return true;
    return normalized.startsWith('fc') || normalized.startsWith('fd');
  }
  const parts = normalized.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export async function assertPublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    const error = new Error('Enter a valid http or https website.');
    error.statusCode = 400;
    throw error;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const error = new Error('Only http and https websites can be scraped.');
    error.statusCode = 400;
    throw error;
  }
  if (url.username || url.password) {
    const error = new Error('Website addresses cannot include a username or password.');
    error.statusCode = 400;
    throw error;
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    const error = new Error('That website address is not allowed.');
    error.statusCode = 400;
    throw error;
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) {
      const error = new Error('That website address is not allowed.');
      error.statusCode = 400;
      throw error;
    }
  } else {
    let records = [];
    try {
      records = await lookup(host, { all: true, verbatim: true });
    } catch {
      const error = new Error('Could not find that website.');
      error.statusCode = 400;
      throw error;
    }
    if (!records.length || records.some((record) => isPrivateIp(record.address))) {
      const error = new Error('That website address is not allowed.');
      error.statusCode = 400;
      throw error;
    }
  }
  return url;
}

async function readLimitedText(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    return text.slice(0, SCRAPE_MAX_BYTES);
  }
  const chunks = [];
  let received = 0;
  while (received < SCRAPE_MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    chunks.push(Buffer.from(value));
  }
  try { await reader.cancel(); } catch { /* The extra bytes are discarded. */ }
  return Buffer.concat(chunks).subarray(0, SCRAPE_MAX_BYTES).toString('utf8');
}

async function fetchPageHtml(startUrl, outerSignal) {
  let current = startUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
    const signal = outerSignal ? AbortSignal.any([controller.signal, outerSignal]) : controller.signal;
    try {
      const response = await fetch(current, {
        redirect: 'manual',
        signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BusinessProfileBot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel?.().catch(() => {});
        if (!location) throw new Error('The website redirected without a destination.');
        current = await assertPublicHttpUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new Error(`The website returned ${response.status}.`);
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > SCRAPE_MAX_BYTES) {
        throw new Error('That page is too large to scrape.');
      }
      return await readLimitedText(response);
    } catch (error) {
      if (outerSignal?.aborted) throw error;
      if (error.name === 'AbortError') throw new Error('The website took too long to respond.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('That website redirected too many times.');
}

async function launchBrowser(puppeteer) {
  try {
    return await puppeteer.launch({ headless: true, channel: 'chrome' });
  } catch {
    return puppeteer.launch({ headless: true });
  }
}

async function renderPageHtml(target) {
  const loaded = await import('puppeteer');
  const puppeteer = loaded.default || loaded;
  const browser = await launchBrowser(puppeteer);
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      try {
        const reqUrl = request.url();
        if (request.isNavigationRequest() && (reqUrl.startsWith('http://') || reqUrl.startsWith('https://'))) {
          await assertPublicHttpUrl(reqUrl);
        }
        await request.continue();
      } catch {
        await request.abort().catch(() => {});
      }
    });
    await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 15000 });
    await assertPublicHttpUrl(page.url());
    return await page.content();
  } finally {
    await browser.close();
  }
}

function knowledgeFromPage(extracted, limit) {
  const parts = [];
  if (extracted.title) parts.push(`Title: ${extracted.title}`);
  if (extracted.description) parts.push(`Description: ${extracted.description}`);
  if (extracted.headings.length) parts.push(`Headings: ${extracted.headings.join(' | ')}`);
  if (extracted.text) parts.push(extracted.text);
  let knowledge = parts.join('\n').trim();
  let trimmed = false;
  if (knowledge.length > limit) {
    knowledge = knowledge.slice(0, limit).trim();
    trimmed = true;
  }
  return { knowledge, trimmed };
}

export async function scrapeWebsite(rawUrl, { mode } = {}) {
  const limit = KNOWLEDGE_LIMITS[mode] || KNOWLEDGE_LIMITS.prompt;
  let value = String(rawUrl || '').trim();
  if (!value) {
    const error = new Error('Enter a website address.');
    error.statusCode = 400;
    throw error;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  const url = await assertPublicHttpUrl(value);

  let warning = '';
  let html = '';
  let fetchError = null;
  try {
    html = await fetchPageHtml(url);
  } catch (error) {
    fetchError = error;
  }

  let extracted = html
    ? extractPage(html, limit)
    : { title: '', siteName: '', description: '', headings: [], text: '' };

  if (extracted.text.length < SCRAPE_MIN_TEXT) {
    try {
      const rendered = extractPage(await renderPageHtml(url), limit);
      if (rendered.text.length > extracted.text.length) extracted = rendered;
    } catch (error) {
      if (!extracted.text && !extracted.title && !extracted.description) {
        throw fetchError || error;
      }
      warning = 'Only part of the page could be read.';
    }
  }

  const { knowledge, trimmed } = knowledgeFromPage(extracted, limit);
  if (!knowledge) {
    const error = new Error(fetchError?.message || 'No readable text was found on that page.');
    error.statusCode = 400;
    throw error;
  }

  return {
    title: extracted.title,
    description: extracted.description,
    knowledge,
    trimmed,
    limit,
    warning,
    suggested_name: suggestCompanyName(extracted),
    suggested_about: extracted.description.slice(0, BUSINESS_LIMITS.about),
  };
}

// Page text for the chat's fetchWebsiteContent tool. Uses the same public-address
// checks as the Business scraper, so the assistant cannot be pointed at this server.
export async function fetchPageText(rawUrl, signal) {
  let value = String(rawUrl || '').trim();
  if (value && !/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  const url = await assertPublicHttpUrl(value);
  return visiblePageText(await fetchPageHtml(url, signal));
}
