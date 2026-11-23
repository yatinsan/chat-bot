import { useEffect, useRef, useState } from 'react';

const BARS = 28;
let stopCurrent = null; // only one message speaks at a time

function formatSeconds(value) {
  const total = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Speaker button for a chat bubble. Tapping it asks the server for speech (VoiceStudio),
// shows a loading state while it generates, then plays it with a pulsing wave and a progress bar.
// state: idle | loading | playing | paused
export function useSpeech(text) {
  const [state, setState] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const audioRef = useRef(null);
  const urlRef = useRef('');
  const abortRef = useRef(null);

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    audioRef.current?.pause();
    setState('idle');
    setProgress(0);
  };

  useEffect(() => () => {
    abortRef.current?.abort();
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    if (stopCurrent === reset) stopCurrent = null;
  }, []);

  const attach = (audio) => {
    audio.onloadedmetadata = () => setDuration(audio.duration || 0);
    audio.ontimeupdate = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    audio.onended = () => { setState('idle'); setProgress(0); };
    audio.onpause = () => { if (!audio.ended && audio.currentTime > 0) setState((s) => (s === 'playing' ? 'paused' : s)); };
    audio.onplay = () => setState('playing');
  };

  const play = async () => {
    if (stopCurrent && stopCurrent !== reset) stopCurrent();
    stopCurrent = reset;
    const audio = audioRef.current;
    audio.currentTime = progress >= 1 ? 0 : audio.currentTime;
    await audio.play();
  };

  const toggle = async () => {
    setError('');
    if (state === 'loading') return reset();
    if (state === 'playing') return audioRef.current.pause();
    try {
      if (audioRef.current) return await play();
      setState('loading');
      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not generate voice.');
      }
      urlRef.current = URL.createObjectURL(await response.blob());
      audioRef.current = new Audio(urlRef.current);
      attach(audioRef.current);
      abortRef.current = null;
      await play();
    } catch (err) {
      if (err.name === 'AbortError') return;
      setState('idle');
      setError(err.message);
    }
  };

  const seek = (ratio) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    audio.currentTime = Math.min(1, Math.max(0, ratio)) * audio.duration;
    setProgress(ratio);
  };

  return { state, progress, duration, error, toggle, seek };
}

export function SpeakButton({ speech }) {
  const { state, toggle } = speech;
  const label = state === 'loading' ? 'Cancel voice' : state === 'playing' ? 'Pause voice' : 'Read aloud';
  return (
    <button type="button" className={`speak-btn ${state}`} onClick={toggle} aria-label={label} title={label}>
      {state === 'loading' ? (
        <span className="speak-spinner" />
      ) : state === 'playing' ? (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      )}
    </button>
  );
}

// Pulsing wave + progress bar shown under the message while it is generating or playing.
export function SpeechPlayer({ speech }) {
  const { state, progress, duration, error, seek } = speech;
  if (error) return <div className="speech-error" role="alert">{error}</div>;
  if (state === 'idle') return null;

  if (state === 'loading') {
    return (
      <div className="speech-player loading" role="status">
        <span className="speech-loading-text">Generating voice…</span>
        <span className="speech-shimmer" />
      </div>
    );
  }

  return (
    <div className={`speech-player ${state}`}>
      <div className="speech-wave" aria-hidden="true">
        {Array.from({ length: BARS }, (_, i) => (
          <i
            key={i}
            className={i / BARS <= progress ? 'done' : ''}
            style={{ '--h': `${30 + ((i * 37) % 60)}%`, '--d': `${(i % 7) * 0.09}s` }}
          />
        ))}
      </div>
      <div
        className="speech-progress"
        role="slider"
        aria-label="Voice progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          seek((event.clientX - rect.left) / rect.width);
        }}
      >
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="speech-time">{formatSeconds(progress * duration)} / {formatSeconds(duration)}</span>
    </div>
  );
}
