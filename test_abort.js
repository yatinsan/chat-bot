import { Ollama } from 'ollama';
const ollama = new Ollama();

async function run() {
  const controller = new AbortController();
  
  setTimeout(() => {
    console.log('Aborting...');
    controller.abort();
  }, 100);

  try {
    const stream = await ollama.chat({
      model: 'gemma4:12b',
      messages: [{ role: 'user', content: 'Write a very long essay about space.' }],
      stream: true
    }, { signal: controller.signal }); // Not sure if this is the right syntax

    for await (const chunk of stream) {
      process.stdout.write(chunk.message.content);
    }
  } catch (e) {
    console.log('\nCaught error:', e.message);
  }
}

run();
