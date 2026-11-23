// Live voice calls: which chats currently have a visitor on a call. A call belongs to the
// visitor's socket, so it ends by itself when they close the page or lose connection.
import { broadcast } from './realtime.js';

const calls = new Map(); // chatId -> socket

export const isInCall = (chatId) => calls.has(String(chatId));

export function setCall(chatId, socket, active) {
  const id = String(chatId);
  if (active) calls.set(id, socket);
  else if (calls.get(id) === socket) calls.delete(id);
  else return;
  broadcast({ type: 'call', chatId: id, active: Boolean(active) });
}

export function endCallsFor(socket) {
  for (const [id, owner] of calls) {
    if (owner === socket) setCall(id, socket, false);
  }
}
