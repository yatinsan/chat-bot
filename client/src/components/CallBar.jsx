const LABELS = { listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' };

// Replaces the message box while a live voice call is on. The chat stays visible above it.
export default function CallBar({ call }) {
  const { phase, voicing, transcript, muted, toggleMute, end } = call;
  const label = muted ? 'Muted' : voicing ? 'Preparing voice…' : LABELS[phase];
  const mode = muted ? 'muted' : voicing ? 'thinking' : phase;
  return (
    <div className={`call-bar ${mode}`} role="status">
      <div className="call-wave" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => <i key={i} style={{ '--d': `${i * 0.12}s` }} />)}
      </div>
      <div className="call-text">
        <strong>{label}</strong>
        <span>{transcript || (phase === 'listening' && !muted ? 'Say something' : 'In call')}</span>
      </div>
      <button type="button" className="call-btn" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          {muted && <path d="M3 3l18 18" />}
        </svg>
      </button>
      <button type="button" className="call-btn end" onClick={end} aria-label="End call" title="End call">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 9c-3 0-5.6.9-7.6 2.4-.6.5-.7 1.4-.2 2l1.3 1.6c.4.5 1.1.6 1.7.3l2-1c.4-.2.7-.6.7-1.1v-1.4c1.2-.4 2.8-.4 4 0v1.4c0 .5.3.9.7 1.1l2 1c.6.3 1.3.2 1.7-.3l1.3-1.6c.5-.6.4-1.5-.2-2C17.6 9.9 15 9 12 9z" /></svg>
      </button>
    </div>
  );
}
