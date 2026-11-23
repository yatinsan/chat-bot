import { useCallback, useEffect, useRef, useState } from 'react';

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const callSupported = Boolean(Recognition);

// Live voice call on the same chat: the visitor talks (speech recognition), the words are sent
// as normal chat messages, and every reply is read out with VoiceStudio. Then it listens again.
// phase: listening | thinking | speaking
export function useCall({ messages, typing, online, sendContent, ensureChatId, wsSend }) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState('listening');
  const [voicing, setVoicing] = useState(false); // true while a reply's voice is still being generated
  const [transcript, setTranscript] = useState('');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');

  const s = useRef({
    active: false, muted: false, chatId: '', typing: false, speaking: false, gotReply: false,
    seen: new Set(), queue: [], rec: null, audio: null, urls: [], settle: null, restart: null,
  });
  const latest = useRef({});
  latest.current = { sendContent, ensureChatId, wsSend };

  const listen = useCallback(() => {
    const st = s.current;
    if (!st.active || st.muted || st.speaking || st.rec || st.queue.length || st.waiting) return;
    const rec = new Recognition();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    st.rec = rec;
    setPhase('listening');
    setTranscript('');
    let finalText = '';
    rec.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i += 1) {
        text += event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText = text;
      }
      setTranscript(text);
    };
    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone access is blocked. Allow it to use calls.');
        end();
      }
    };
    rec.onend = () => {
      st.rec = null;
      if (!st.active) return;
      const said = finalText.trim();
      if (said) {
        st.waiting = true;
        st.gotReply = false;
        setPhase('thinking');
        setTranscript('');
        latest.current.sendContent(said);
        armSettle(30000); // give up waiting if no reply ever comes
      } else {
        clearTimeout(st.restart);
        st.restart = setTimeout(listen, 250);
      }
    };
    try { rec.start(); } catch { st.rec = null; }
    // eslint-disable-next-line no-use-before-define
  }, []);

  // After a quiet moment with nothing to say and nothing coming, go back to listening.
  function armSettle(delay) {
    const st = s.current;
    clearTimeout(st.settle);
    st.settle = setTimeout(() => {
      if (!st.active || st.speaking || st.queue.length || st.typing) return;
      st.waiting = false;
      listen();
    }, delay);
  }

  function fetchVoice(text) {
    return fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then(async (response) => {
      if (!response.ok) throw new Error('voice failed');
      const url = URL.createObjectURL(await response.blob());
      s.current.urls.push(url);
      return url;
    });
  }

  const pump = useCallback(async () => {
    const st = s.current;
    if (st.speaking || !st.active || st.queue.length === 0) return;
    st.speaking = true;
    st.rec?.abort();
    st.rec = null;
    setPhase('speaking');
    setVoicing(true);
    const item = st.queue.shift();
    try {
      const url = await item;
      if (!st.active) return;
      setVoicing(false);
      const audio = new Audio(url);
      st.audio = audio;
      await new Promise((resolve) => {
        audio.onended = resolve;
        audio.onerror = resolve;
        audio.play().catch(resolve);
      });
    } catch {
      setVoicing(false);
    }
    st.audio = null;
    st.speaking = false;
    if (!st.active) return;
    if (st.queue.length) pump();
    else armSettle(st.typing ? 30000 : 1200);
  }, []);

  const end = useCallback(() => {
    const st = s.current;
    if (!st.active) return;
    st.active = false;
    clearTimeout(st.settle);
    clearTimeout(st.restart);
    st.rec?.abort();
    st.rec = null;
    st.audio?.pause();
    st.audio = null;
    st.queue = [];
    st.speaking = false;
    st.urls.forEach((url) => URL.revokeObjectURL(url));
    st.urls = [];
    if (st.chatId) latest.current.wsSend({ type: 'call', chatId: st.chatId, active: false });
    setActive(false);
    setVoicing(false);
    setTranscript('');
  }, []);

  const start = useCallback(() => {
    const st = s.current;
    if (st.active || !callSupported) return;
    setError('');
    st.chatId = latest.current.ensureChatId();
    st.active = true;
    st.muted = false;
    st.waiting = false;
    st.gotReply = false;
    st.typing = false;
    st.seen = new Set(messagesRef.current.map((m) => m.id)); // only speak what arrives after the call starts
    latest.current.wsSend({ type: 'call', chatId: st.chatId, active: true });
    setMuted(false);
    setActive(true);
    listen();
  }, [listen]);

  const toggleMute = useCallback(() => {
    const st = s.current;
    st.muted = !st.muted;
    setMuted(st.muted);
    if (st.muted) {
      st.rec?.abort();
      st.rec = null;
      setTranscript('');
    } else {
      listen();
    }
  }, [listen]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // New replies during a call are queued (their voice starts generating straight away).
  useEffect(() => {
    const st = s.current;
    if (!st.active) return;
    for (const message of messages) {
      if (st.seen.has(message.id)) continue;
      st.seen.add(message.id);
      if (message.role === 'user') continue;
      st.gotReply = true;
      const voice = fetchVoice(message.content);
      voice.catch(() => {});
      st.queue.push(voice);
    }
    pump();
  }, [messages, pump]);

  useEffect(() => {
    const st = s.current;
    st.typing = typing;
    if (active && !typing && st.waiting && st.gotReply && !st.speaking && !st.queue.length) armSettle(1200);
  }, [typing, active]);

  // Tell the server again if the connection dropped and came back mid-call.
  useEffect(() => {
    if (active && online) latest.current.wsSend({ type: 'call', chatId: s.current.chatId, active: true });
  }, [online, active]);

  useEffect(() => end, [end]);

  return { active, phase, voicing, transcript, muted, error, start, end, toggleMute };
}
