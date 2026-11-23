import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeDB, initDB } from '../database.js';

// Opens a fresh SQLite file for one test file. Returns a cleanup function.
export async function useTempDatabase() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ai-chat-test-'));
  const originalLog = console.log;
  console.log = () => {};
  await initDB(path.join(dir, 'test.sqlite'));
  console.log = originalLog;
  return async () => {
    await closeDB();
    rmSync(dir, { recursive: true, force: true });
  };
}

// Silences the engine's progress logging while a test runs.
export function quietConsole(t) {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  t.after(() => {
    console.log = log;
    console.error = error;
  });
}

export function toolCall(name, args, id = `${name}-${Math.random().toString(36).slice(2, 8)}`) {
  return { id, type: 'function', function: { name, arguments: args } };
}

export function reply({ content = '', tools = [] } = {}) {
  return { message: { role: 'assistant', content, tool_calls: tools } };
}
