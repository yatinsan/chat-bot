import { useState } from 'react';

async function setAiPaused(chatId, paused) {
  const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/ai`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not change who handles this chat.');
  return data;
}

// Shows who is answering this chat and lets the team take it over or hand it back.
export default function AiControl({ chatId, paused, onChanged, onError }) {
  const [busy, setBusy] = useState(false);
  if (!chatId) return null;

  async function toggle() {
    setBusy(true);
    try {
      const data = await setAiPaused(chatId, !paused);
      onChanged?.(data.ai_paused);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={paused ? 'ai-control paused' : 'ai-control'}>
      <span className="ai-state">
        <span className="ai-dot" aria-hidden="true" />
        {paused ? 'You are handling this chat' : 'AI is replying'}
      </span>
      <button type="button" className={paused ? 'btn primary' : 'btn'} onClick={toggle} disabled={busy}>
        {busy ? 'Saving…' : paused ? 'Turn AI back on' : 'Take over chat'}
      </button>
    </div>
  );
}
