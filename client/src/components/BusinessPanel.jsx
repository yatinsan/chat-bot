import { useEffect, useState } from 'react';
import { formatDateTime } from '../lib/format.js';

const DEFAULT_COMPANY_NAME = 'Pixbit Solutions';
const FIELDS = ['company_name', 'location', 'timezone', 'website', 'services', 'about', 'knowledge_mode', 'website_knowledge'];
const KNOWLEDGE_LIMITS = { prompt: 6000, rag: 60000 };
const DEFAULT_TIMEZONE = 'Asia/Dubai';

function timeZoneOptions() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [DEFAULT_TIMEZONE];
  }
}
const TIME_ZONES = timeZoneOptions();

function sameProfile(a, b) {
  return FIELDS.every((key) => (a?.[key] ?? '') === (b?.[key] ?? ''));
}

function Counter({ value, max }) {
  const length = value.length;
  return <small className={length > max * 0.9 ? 'char-count near' : 'char-count'}>{length.toLocaleString()} / {max.toLocaleString()}</small>;
}

const EMPTY = {
  company_name: DEFAULT_COMPANY_NAME,
  location: '',
  timezone: DEFAULT_TIMEZONE,
  website: '',
  services: '',
  about: '',
  knowledge_mode: 'prompt',
  website_knowledge: '',
};

function indexSummary(index) {
  if (!index || !index.chunks) return 'Not indexed yet. Save to build the index.';
  const kind = index.search === 'semantic' ? 'semantic search (embeddings)' : 'keyword search';
  return `${index.chunks} chunk${index.chunks === 1 ? '' : 's'} indexed, using ${kind}.`;
}

function KnowledgeSearch({ disabled }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function search() {
    if (!query.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/settings/knowledge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Search failed.');
      setResults(data.results || []);
    } catch (err) {
      setError(err.message);
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rag-search">
      <span className="field-label">Test retrieval</span>
      <div className="website-row">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } }}
          placeholder="Ask what a customer might ask, e.g. Do you build Shopify stores?"
          maxLength={500}
          disabled={disabled}
        />
        <button type="button" className="btn" onClick={search} disabled={disabled || busy || !query.trim()}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      {disabled && <small className="form-note">Save your changes first. Search uses the saved knowledge.</small>}
      {error && <small className="rag-error">{error}</small>}
      {results && (
        results.length ? (
          <ol className="rag-results">
            {results.map((result) => (
              <li key={result.position}>
                <small className="char-count">Match {Math.round(result.score * 100)}%</small>
                <p>{result.content}</p>
              </li>
            ))}
          </ol>
        ) : <small className="form-note">Nothing matched. The assistant would say the team will confirm.</small>
      )}
    </div>
  );
}

export default function BusinessPanel({ onSaved }) {
  const [profile, setProfile] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load business details.');
        return data;
      })
      .then((data) => {
        if (!cancelled) {
          setProfile({ ...EMPTY, ...data });
          setSaved({ ...EMPTY, ...data });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function setField(key, value) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function scrape() {
    const url = profile.website.trim();
    if (!url) {
      setError('Enter a website address first.');
      setNotice('');
      return;
    }
    setScraping(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/settings/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, mode: profile.knowledge_mode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not scrape that website.');
      setProfile((current) => {
        const next = { ...current, website_knowledge: data.knowledge || '' };
        const name = current.company_name.trim();
        const nameIsDefault = !name || name === DEFAULT_COMPANY_NAME;
        if (nameIsDefault && data.suggested_name) next.company_name = data.suggested_name;
        if (!current.about.trim() && data.suggested_about) next.about = data.suggested_about;
        return next;
      });
      const notes = ['Scraped the website. Review the details, then save.'];
      if (data.trimmed) notes.push(`The page text was shortened to ${(data.limit || 6000).toLocaleString()} characters.`);
      if (data.warning) notes.push(data.warning);
      setNotice(notes.join(' '));
    } catch (err) {
      setError(err.message);
    } finally {
      setScraping(false);
    }
  }

  async function uploadFile(event) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/settings/knowledge/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not read that file.');
      const limit = KNOWLEDGE_LIMITS[profile.knowledge_mode] || KNOWLEDGE_LIMITS.prompt;
      setProfile((current) => {
        const existing = current.website_knowledge.trim();
        const added = `${file.name}:\n${data.text}`;
        return { ...current, website_knowledge: existing ? `${existing}\n\n${added}` : added };
      });
      const total = profile.website_knowledge.trim().length + data.characters;
      setNotice(`Added ${data.characters.toLocaleString()} characters from ${file.name}. Review, then save.${
        total > limit ? ` It is over the ${limit.toLocaleString()} character limit, so the end will be cut off on save.` : ''}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save business details.');
      const shortened = profile.website_knowledge.length > (data.website_knowledge || '').length
        || profile.about.length > (data.about || '').length;
      setProfile({ ...EMPTY, ...data });
      setSaved({ ...EMPTY, ...data });
      onSaved?.(data);
      const notes = [shortened
        ? 'Saved. Longer text was shortened to fit the limit.'
        : 'Saved. The assistant uses these details on the next reply.'];
      if (data.knowledge_mode === 'rag') notes.push(indexSummary(data.knowledge_index));
      if (data.knowledge_index?.warning) notes.push(data.knowledge_index.warning);
      setNotice(notes.join(' '));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <section className="stack business-page">
        {error && <p className="banner">{error}</p>}
        {!error && (
          <article className="panel empty-panel">
            <h2>Loading business details</h2>
          </article>
        )}
      </section>
    );
  }

  const dirty = !sameProfile(profile, saved);
  const rag = profile.knowledge_mode === 'rag';
  const knowledgeLimit = KNOWLEDGE_LIMITS[profile.knowledge_mode] || KNOWLEDGE_LIMITS.prompt;
  const overLimit = profile.website_knowledge.length > knowledgeLimit;

  return (
    <section className="stack business-page">
      {error && <p className="banner">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}
      <article className="panel">
        <form className="business-form" onSubmit={save}>
          <p className="form-note">
            Chat style, the questions the assistant asks, pricing, and lead scoring stay fixed.
            These fields only change who you are and what the assistant knows about the business.
          </p>
          <label className="field">
            <span>Company name</span>
            <input
              value={profile.company_name}
              onChange={(event) => setField('company_name', event.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label className="field">
            <span>Location</span>
            <input
              value={profile.location}
              onChange={(event) => setField('location', event.target.value)}
              maxLength={120}
            />
          </label>
          <label className="field">
            <span>Time zone</span>
            <input
              value={profile.timezone}
              onChange={(event) => setField('timezone', event.target.value)}
              list="business-time-zones"
              placeholder={DEFAULT_TIMEZONE}
              maxLength={60}
            />
            <datalist id="business-time-zones">
              {TIME_ZONES.map((zone) => <option key={zone} value={zone} />)}
            </datalist>
            <small className="form-note">Used for meeting times and for working out dates like "next Friday".</small>
          </label>
          <label className="field">
            <span>Website</span>
            <div className="website-row">
              <input
                value={profile.website}
                onChange={(event) => setField('website', event.target.value)}
                placeholder="https://example.com"
                maxLength={300}
              />
              <button type="button" className="btn" onClick={scrape} disabled={scraping || saving}>
                {scraping ? 'Scraping…' : 'Scrape website'}
              </button>
            </div>
          </label>
          <label className="field">
            <span className="field-label">What you offer <Counter value={profile.services} max={2000} /></span>
            <textarea
              value={profile.services}
              onChange={(event) => setField('services', event.target.value)}
              maxLength={2000}
              rows={4}
            />
          </label>
          <label className="field">
            <span className="field-label">About <Counter value={profile.about} max={4000} /></span>
            <textarea
              placeholder="A few lines on who you are. Scrape website can fill this in."
              value={profile.about}
              onChange={(event) => setField('about', event.target.value)}
              maxLength={4000}
              rows={4}
            />
          </label>
          <fieldset className="field knowledge-mode">
            <legend>How the assistant uses the knowledge</legend>
            <div className="segmented" role="radiogroup">
              <label className={!rag ? 'active' : ''}>
                <input
                  type="radio"
                  name="knowledge_mode"
                  value="prompt"
                  checked={!rag}
                  onChange={() => setField('knowledge_mode', 'prompt')}
                />
                <strong>Full text</strong>
                <small>All of it goes in every prompt. Best for short knowledge, up to 6,000 characters.</small>
              </label>
              <label className={rag ? 'active' : ''}>
                <input
                  type="radio"
                  name="knowledge_mode"
                  value="rag"
                  checked={rag}
                  onChange={() => setField('knowledge_mode', 'rag')}
                />
                <strong>RAG (search)</strong>
                <small>Split into chunks and searched. Only the parts that match the customer's message are sent. Up to 60,000 characters.</small>
              </label>
            </div>
            {rag && <small className="form-note">{indexSummary(saved?.knowledge_mode === 'rag' ? saved.knowledge_index : null)}</small>}
          </fieldset>
          <div className="field upload-row">
            <label className={`btn${uploading ? ' disabled' : ''}`}>
              {uploading ? 'Reading file…' : 'Add file (PDF, TXT, MD, CSV)'}
              <input
                type="file"
                accept=".pdf,.txt,.md,.markdown,.csv,.json,.html,.htm,application/pdf,text/*"
                onChange={uploadFile}
                disabled={uploading || saving}
                hidden
              />
            </label>
            <small className="form-note">The file's text is added to the knowledge below. Up to 10 MB. Scanned PDFs need OCR and are not supported.</small>
          </div>
          <label className="field">
            <span className="field-label">
              {rag ? 'Knowledge base' : 'Website knowledge'} <Counter value={profile.website_knowledge} max={knowledgeLimit} />
            </span>
            <textarea
              className="tall"
              placeholder={rag
                ? 'Paste FAQs, service details, policies, and website text. Blank lines separate topics.'
                : 'Click Scrape website to pull text from your site, or paste facts here.'}
              value={profile.website_knowledge}
              onChange={(event) => setField('website_knowledge', event.target.value)}
              maxLength={KNOWLEDGE_LIMITS.rag}
              rows={rag ? 14 : 8}
            />
            {overLimit && (
              <small className="rag-error">
                Full text mode keeps the first {knowledgeLimit.toLocaleString()} characters. Switch to RAG to keep all of it.
              </small>
            )}
          </label>
          {rag && <KnowledgeSearch disabled={dirty || saved?.knowledge_mode !== 'rag'} />}
          <div className="form-actions sticky-actions">
            <button type="submit" className="btn primary" disabled={saving || scraping || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {dirty ? (
              <>
                <span className="dirty-note">Unsaved changes</span>
                <button type="button" className="btn ghost" disabled={saving} onClick={() => setProfile({ ...saved })}>
                  Discard
                </button>
              </>
            ) : (
              <span className="saved-note">
                {saved?.updated_at ? `Saved ${formatDateTime(saved.updated_at)}` : 'Using default details'}
              </span>
            )}
          </div>
        </form>
      </article>
    </section>
  );
}
