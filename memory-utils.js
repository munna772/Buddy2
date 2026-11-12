'use strict';

const { jsonrepair } = require('jsonrepair');

function stripFactPrefix(value) {
  return String(value || '').replace(/^FACT:\s*/i, '');
}

function parseMemoryExtraction(value) {
  const raw = String(value || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start < 0 || end < start) {
    throw new Error('Gemini memory analysis did not return a JSON object.');
  }

  return JSON.parse(jsonrepair(raw.slice(start, end + 1)));
}

module.exports = { stripFactPrefix, parseMemoryExtraction };
