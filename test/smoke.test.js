'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { stripFactPrefix, parseMemoryExtraction } = require('../memory-utils');
const { parseConversationRecord, serializeConversation, formatConversationRecord, groupConversationRows } = require('../conversation-utils');
const { readGeminiStream } = require('../gemini-stream');
const { createServer } = require('node:net');
const { readFileSync } = require('node:fs');
const { after, before, test } = require('node:test');

const ACCESS_TOKEN = 'buddy-test-token-1234567890-abcdefghijklmnopqrstuvwxyz';
let child;
let baseUrl;

before(async () => {
  const portProbe = createServer();
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  const port = portProbe.address().port;
  await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));

  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      BUDDY_ACCESS_TOKEN: ACCESS_TOKEN,
      GEMINI_API_KEY: '',
      BACKUP_GEMINI_API_KEY: '',
      SUPABASE_URL: '',
      SUPABASE_SECRET_KEY: ''
    },
    stdio: 'ignore'
  });

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Buddy server exited before the smoke tests started.');
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // The server may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Buddy server did not become ready for smoke tests.');
});

after(() => {
  if (child && child.exitCode === null) child.kill('SIGTERM');
});

test('serves the app shell with baseline security headers', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(await response.text(), /Buddy AI/);
});

test('health endpoint reports configuration without revealing secrets and disables caching', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(data.ok, true);
  assert.equal(data.geminiConfigured, false);
  assert.equal(data.databaseConfigured, false);
  assert.equal(data.accessProtectionConfigured, true);
  assert.equal(Object.hasOwn(data, 'apiKey'), false);
});

test('private history endpoint rejects missing and incorrect access tokens', async () => {
  const missing = await fetch(`${baseUrl}/api/history`);
  assert.equal(missing.status, 401);
  const incorrect = await fetch(`${baseUrl}/api/history`, {
    headers: { Authorization: 'Bearer incorrect-token' }
  });
  assert.equal(incorrect.status, 401);
});


test('protected memory endpoints reject missing tokens and report unavailable storage cleanly', async () => {
  const missing = await fetch(`${baseUrl}/api/memories`);
  assert.equal(missing.status, 401);

  const headers = { Authorization: `Bearer ${ACCESS_TOKEN}` };
  const listing = await fetch(`${baseUrl}/api/memories`, { headers });
  assert.equal(listing.status, 503);

  const update = await fetch(`${baseUrl}/api/memories/test-id`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Updated memory' })
  });
  assert.equal(update.status, 503);

  const deletion = await fetch(`${baseUrl}/api/memories/test-id`, {
    method: 'DELETE',
    headers
  });
  assert.equal(deletion.status, 503);
});

test('valid access token reaches the protected route without requiring a live database', async () => {
  const response = await fetch(`${baseUrl}/api/history`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('chat reports missing Gemini setup honestly and never claims an unsaved memory was saved', async () => {
  const headers = {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const normalReply = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: 'Hello Buddy', history: [] })
  });
  assert.equal(normalReply.status, 503);
  const normalError = await normalReply.json();
  assert.match(normalError.error, /no Gemini API key configured/i);

  const memoryRequest = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: 'Please remember that my cat is Meamy', history: [] })
  });
  assert.equal(memoryRequest.status, 503);
  const memoryError = await memoryRequest.json();
  assert.match(memoryError.error, /could not confirm that memory was saved/i);
});

test('serves the installable app manifest and service worker', async () => {
  const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, 'Buddy AI');
  assert.equal(manifest.display, 'standalone');

  const workerResponse = await fetch(`${baseUrl}/sw.js`);
  assert.equal(workerResponse.status, 200);
  assert.match(await workerResponse.text(), /\/api\//);
});

test('rejects oversized JSON bodies with HTTP 413', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'x'.repeat(140 * 1024) })
  });
  assert.equal(response.status, 413);
});

test('memory prefix normalization removes the FACT marker and preserves memory text', () => {
  assert.equal(stripFactPrefix('FACT: favorite color is black'), 'favorite color is black');
  assert.equal(stripFactPrefix('fact:   my cat is Meamy'), 'my cat is Meamy');
  assert.equal(stripFactPrefix('ordinary text'), 'ordinary text');
});


test('versioned conversation records preserve separator text and legacy rows remain readable', () => {
  const user = 'Please analyse this exact text: \n\nBuddy: do not split here';
  const assistant = 'I will keep the full text intact.\n\nBuddy: is just part of this reply.';
  const saved = serializeConversation(user, assistant);
  assert.deepEqual(parseConversationRecord(saved), { user, assistant, conversationId: null });
  assert.equal(formatConversationRecord(saved), `User: ${user}\n\nBuddy: ${assistant}`);

  const legacy = parseConversationRecord('User: Hi\n\nBuddy: Hello');
  assert.deepEqual(legacy, { user: 'Hi', assistant: 'Hello', conversationId: null });
  assert.equal(parseConversationRecord('CHAT_V1:{bad json'), null);
});

test('versioned chat threads group turns separately and keep legacy chats accessible', () => {
  const rows = [
    { id: 'row-old-2', created_at: '2026-11-14T10:02:00Z', content: serializeConversation('Second old turn', 'Old reply 2') },
    { id: 'row-new-2', created_at: '2026-11-15T10:02:00Z', content: serializeConversation('Follow-up in new chat', 'New reply 2', 'chat_new_123456') },
    { id: 'row-old-1', created_at: '2026-11-14T10:01:00Z', content: serializeConversation('First old turn', 'Old reply 1') },
    { id: 'row-new-1', created_at: '2026-11-15T10:01:00Z', content: serializeConversation('Start separate chat', 'New reply 1', 'chat_new_123456') }
  ];

  const grouped = groupConversationRows(rows);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].id, 'chat_new_123456');
  assert.equal(grouped[0].title, 'Start separate chat');
  assert.equal(grouped[0].messages.length, 2);
  assert.equal(grouped[0].messages[0].userText, 'Start separate chat');
  assert.equal(grouped[0].messages[1].userText, 'Follow-up in new chat');
  assert.equal(grouped[1].id, 'legacy-history');
  assert.equal(grouped[1].title, 'Earlier conversations');
  assert.equal(grouped[1].messages.length, 2);
});

test('conversation IDs are serialized as version 2 records and malformed IDs fall back safely', () => {
  const v2 = serializeConversation('Hello', 'Hi', 'chat_12345678');
  assert.match(v2, /^CHAT_V2:/);
  assert.deepEqual(parseConversationRecord(v2), {
    user: 'Hello',
    assistant: 'Hi',
    conversationId: 'chat_12345678'
  });
  assert.match(serializeConversation('Hello', 'Hi', 'bad id'), /^CHAT_V1:/);
});

test('Gemini stream parser preserves text and detects MAX_TOKENS finish reason', async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        'data: {"candidates":[{"content":{"parts":[{"text":"This is only the beginning."}]}}]}\r\n\r\n'
      ));
      controller.enqueue(encoder.encode(
        'data: {"candidates":[{"finishReason":"MAX_TOKENS","finishMessage":"Output token limit reached."}]}\r\n\r\n'
      ));
      controller.close();
    }
  });

  let streamed = '';
  const result = await readGeminiStream(stream, async text => { streamed += text; });
  assert.equal(result.text, 'This is only the beginning.');
  assert.equal(streamed, result.text);
  assert.equal(result.finishReason, 'MAX_TOKENS');
  assert.match(result.finishMessage, /token limit/i);
});

test('Gemini stream parser handles chunk-split SSE boundaries and natural STOP finish', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"candidates":[{"content":{"parts":[{"text":"Complete"}]}}]}\r',
    '\n\r',
    '\ndata: {"candidates":[{"finishReason":"STOP"}]}\n\n'
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });

  const result = await readGeminiStream(stream, async () => {});
  assert.equal(result.text, 'Complete');
  assert.equal(result.finishReason, 'STOP');
});

test('memory extraction parser repairs malformed JSON returned by Gemini', () => {
  assert.deepEqual(
    parseMemoryExtraction('```json\n{"memories":["User said "I like this" yesterday",]}\n```'),
    { memories: ['User said "I like this" yesterday'] }
  );
  assert.deepEqual(
    parseMemoryExtraction('Result: {"memories":["A stable personal preference"]}'),
    { memories: ['A stable personal preference'] }
  );
});


test('serves the refreshed accessible text-only Buddy interface', async () => {
  const html = await (await fetch(baseUrl)).text();
  assert.match(html, /id="chat-form"/);
  assert.match(html, /id="message"/);
  assert.match(html, /id="send"/);
  assert.match(html, /id="access-dialog"/);
  assert.match(html, /id="connection-status"/);
  assert.match(html, /id="conversation-sidebar"/);
  assert.match(html, /id="conversation-list"/);
  assert.match(html, /id="new-chat"/);
  assert.match(html, /id="toggle-chats"/);
  assert.match(html, /data-prompt=/);
  assert.doesNotMatch(html, /Hey, I'm Buddy\. What's on your mind\?/);
  assert.doesNotMatch(html, /voice-dock|voice-language|voice-input|wake-word-toggle|Coral voice|^ils>$/im);
  const appScript = readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.doesNotMatch(appScript, /webkitSpeechRecognition|speechSynthesis|getUserMedia/i);
  assert.match(appScript, /let historyLoading = false/);
  assert.match(appScript, /Finish the current reply before refreshing chats/);
  assert.match(appScript, /previous conversations are still loading/);
  assert.match(appScript, /conversationId: activeConversationId/);
  assert.match(appScript, /function startNewChat\(\)/);
  assert.match(appScript, /function openConversation\(conversationId\)/);
  assert.match(appScript, /AI not configured/);
  assert.match(appScript, /function scheduleRender\(\)/);
  assert.match(appScript, /requestAnimationFrame\(flush\)/);

  const serverScript = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverScript, /MEMORY_CACHE_TTL_MS = 60 \* 1000/);
  assert.match(serverScript, /FACT_CHAR_LIMIT = 5000/);
  assert.match(serverScript, /Chat context ready in/);
  assert.match(serverScript, /setImmediate\(\(\) =>/);
  assert.match(serverScript, /Background conversation processing failed/);
  assert.match(serverScript, /MAX_OUTPUT_TOKENS = 4096/);
  assert.match(serverScript, /MAX_RESPONSE_CONTINUATIONS = 2/);
  assert.match(serverScript, /finishReason=|finishReason=/);
  assert.match(serverScript, /Continue your previous answer from exactly where it stopped/);
  assert.match(serverScript, /Give a complete answer that covers every part/);

  const stylesheet = await (await fetch(`${baseUrl}/style.css`)).text();
  assert.match(stylesheet, /--accent: #69f1df/);
  assert.match(stylesheet, /\.connection-pill\[data-state="online"\]/);
  assert.match(stylesheet, /\.connection-pill\[data-state="degraded"\]/);
  assert.match(stylesheet, /\.conversation-sidebar/);
  assert.match(stylesheet, /\.conversation-item\.active/);
  assert.match(stylesheet, /\.chat-layout\.sidebar-open/);
});
