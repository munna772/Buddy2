'use strict';

const PREFIX = 'CHAT_V1:';
const LEGACY_SEPARATOR = '\n\nBuddy: ';

function parseConversationRecord(content) {
  if (typeof content !== 'string') return null;

  if (content.startsWith(PREFIX)) {
    try {
      const record = JSON.parse(content.slice(PREFIX.length));
      if (
        record &&
        record.version === 1 &&
        typeof record.user === 'string' &&
        typeof record.assistant === 'string' &&
        record.user.trim() &&
        record.assistant.trim()
      ) {
        return { user: record.user, assistant: record.assistant };
      }
    } catch {
      return null;
    }
    return null;
  }

  if (!content.startsWith('User: ')) return null;
  const separatorIndex = content.indexOf(LEGACY_SEPARATOR);
  if (separatorIndex < 0) return null;

  const user = content.slice(6, separatorIndex).trim();
  const assistant = content.slice(separatorIndex + LEGACY_SEPARATOR.length).trim();
  return user && assistant ? { user, assistant } : null;
}

function serializeConversation(user, assistant) {
  if (
    typeof user !== 'string' ||
    typeof assistant !== 'string' ||
    !user.trim() ||
    !assistant.trim()
  ) {
    throw new TypeError('A conversation needs non-empty user and assistant text.');
  }

  return PREFIX + JSON.stringify({
    version: 1,
    user,
    assistant
  });
}

function formatConversationRecord(content) {
  const record = parseConversationRecord(content);
  return record
    ? `User: ${record.user}\n\nBuddy: ${record.assistant}`
    : String(content || '');
}

module.exports = {
  PREFIX,
  parseConversationRecord,
  serializeConversation,
  formatConversationRecord
};
