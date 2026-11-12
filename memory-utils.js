'use strict';

function stripFactPrefix(value) {
  return String(value || '').replace(/^FACT:\s*/i, '');
}

module.exports = { stripFactPrefix };
