import { useEffect, useRef, useState } from 'react';

export function useWebSocket(onEvent) {
  const [status, setStatus] = useState('connecting');
  const socketRef = useRef(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let stopped = false;
    let retry;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => setStatus('online');
      socket.onclose = () => {
        if (socketRef.current === socket) setStatus('offline');
        if (!stopped) retry = setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (event) => {
        try {
          onEventRef.current(JSON.parse(event.data));
        } catch {
          // Ignore malformed frames.
        }
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socketRef.current?.close();
    };
  }, []);

  function send(payload) {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  return { status, send };
}
