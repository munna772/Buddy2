'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { createServer } = require('node:net');
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

test('serves the bundled voice-enabled client and voice controls', async () => {
  const response = await fetch(`${baseUrl}/app.bundle.js`);
  assert.equal(response.status, 200);
  const script = await response.text();
  assert.match(script, /Voice replies/);
  const shell = await (await fetch(baseUrl)).text();
  assert.match(shell, /id="voice-input"/);
  assert.match(shell, /id="voice-language"/);
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

test('valid access token reaches the protected route without requiring a live database', async () => {
  const response = await fetch(`${baseUrl}/api/history`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
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
