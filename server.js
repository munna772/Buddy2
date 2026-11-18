'use strict';

require('dotenv').config();

const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { randomUUID, timingSafeEqual } = require('crypto');
const { stripFactPrefix, parseMemoryExtraction } = require('./memory-utils');
const { parseConversationRecord, serializeConversation, groupConversationRows } = require('./conversation-utils');
const { readGeminiStream } = require('./gemini-stream');
const { fetchGeminiWithFallback: requestGeminiWithFallback } = require('./gemini-request');

const app = express();

// =====================================
// CONFIGURATION
// =====================================

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const BACKUP_API_KEY = (process.env.BACKUP_GEMINI_API_KEY || process.env.Backup_Gemini_Api_Key || '').trim();
const BACKUP_API_KEY_2 = (process.env.BACKUP_GEMINI_API_KEY_2 || '').trim();
const GEMINI_API_KEYS = [
  { label: 'primary', key: API_KEY },
  { label: 'backup 1', key: BACKUP_API_KEY },
  { label: 'backup 2', key: BACKUP_API_KEY_2 }
].filter(item => item.key);
const MODEL = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_SECRET_KEY = (process.env.SUPABASE_SECRET_KEY || '').trim();
const ACCESS_TOKEN = (process.env.BUDDY_ACCESS_TOKEN || '').trim();

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 12;
const MEMORY_RECORD_LIMIT = 60;
const GEMINI_CONNECT_TIMEOUT_MS = 30000;
const GEMINI_FALLBACK_STAGGER_MS = 6000;
const GEMINI_STREAM_IDLE_TIMEOUT_MS = 45000;
const MAX_OUTPUT_TOKENS = 4096;
const MAX_RESPONSE_CONTINUATIONS = 2;
const SUPABASE_TIMEOUT_MS = 10000;
const MEMORY_ANALYSIS_TIMEOUT_MS = 12000;
const MEMORY_CACHE_TTL_MS = 60 * 1000;
let memoryCache = null;
let memoryCacheExpiresAt = 0;
let memoryRefreshPromise = null;

const DATABASE_CONFIGURED = Boolean(
  SUPABASE_URL && SUPABASE_SECRET_KEY
);

// Staggered failover lets a backup respond while a slow primary is still
// connecting. Only the first successful response is kept; losing requests
// are cancelled as soon as a winner is found.
function fetchGeminiWithFallback(url, options = {}) {
  return requestGeminiWithFallback(url, options, {
    apiKeys: GEMINI_API_KEYS,
    connectTimeoutMs: GEMINI_CONNECT_TIMEOUT_MS,
    staggerMs: GEMINI_FALLBACK_STAGGER_MS,
    logger: console
  });
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be a valid TCP port number.');
}

if (Buffer.byteLength(ACCESS_TOKEN, 'utf8') < 32) {
  throw new Error(
    'BUDDY_ACCESS_TOKEN must be configured and contain at least 32 bytes.'
  );
}

if (DATABASE_CONFIGURED) {
  try {
    const parsedSupabaseUrl = new URL(SUPABASE_URL);
    if (!['http:', 'https:'].includes(parsedSupabaseUrl.protocol)) {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTP or HTTPS URL.');
  }
}

// =====================================
// EXPRESS MIDDLEWARE
// =====================================

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Baseline browser security headers. Buddy serves only same-origin assets,
// so this restrictive policy does not require external script/style sources.
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",