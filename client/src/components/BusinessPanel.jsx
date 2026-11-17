import { useEffect, useState } from 'react';

const DEFAULT_COMPANY_NAME = 'Pixbit Solutions';

const EMPTY = {
  company_name: DEFAULT_COMPANY_NAME,
  location: '',
  website: '',
  services: '',
  about: '',
  website_knowledge: '',
};

export default function BusinessPanel({ onSaved }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [scraping, setScraping] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load business details.');
        return data;
      })
      .then((data) => {
        if (!cancelled) setProfile({ ...EMPTY, ...data });
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
        body: JSON.stringify({ url }),
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
      if (data.trimmed) notes.push('The page text was shortened to 6,000 characters.');
      if (data.warning) notes.push(data.warning);
      setNotice(notes.join(' '));
    } catch (err) {
      setError(err.message);
    } finally {
      setScraping(false);
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
      onSaved?.(data);
      setNotice(shortened
        ? 'Saved. Longer text was shortened so it fits in the assistant prompt.'
        : 'Saved. The assistant uses these details on the next reply.');
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
            <span>What you offer</span>
            <textarea
              value={profile.services}
              onChange={(event) => setField('services', event.target.value)}
              maxLength={2000}
              rows={4}
            />
          </label>
          <label className="field">
            <span>About</span>
            <textarea
              value={profile.about}
              onChange={(event) => setField('about', event.target.value)}
              maxLength={4000}
              rows={4}
            />
          </label>
          <label className="field">
            <span>Website knowledge</span>
            <textarea
              className="tall"
              value={profile.website_knowledge}
              onChange={(event) => setField('website_knowledge', event.target.value)}
              maxLength={6000}
              rows={8}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={saving || scraping}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}
