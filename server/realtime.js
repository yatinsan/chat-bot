// WebSocket fan-out to every open dashboard and visitor chat.
import { WebSocketServer, WebSocket } from 'ws';

let wss = null;

export function attachRealtime(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  return wss;
}

export function broadcast(event) {
  if (!wss) return;
  const data = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

export function sendTo(socket, event) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}
