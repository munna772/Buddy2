'use strict';

const PREFIX_V1 = 'CHAT_V1:';
const PREFIX_V2 = 'CHAT_V2:';
const LEGACY_SEPARATOR = '\n\nBuddy: ';

function parseConversationRecord(content) {
  if (typeof content !== 'string') return null;

  if (content.startsWith(PREFIX_V2) || content.startsWith(PREFIX_V1)) {
    const isV2 = content.startsWith(PREFIX_V2);
    const prefix = isV2 ? PREFIX_V2 : PREFIX_V1;
    try {
      const record = JSON.parse(content.slice(prefix.length));
      if (
        record &&
        record.version === (isV2 ? 2 : 1) &&
        typeof record.user === 'string' &&
        typeof record.assistant === 'string' &&
        record.user.trim() &&
        record.assistant.trim()
      ) {
        return {
          user: record.user,
          assistant: record.assistant,
          conversationId: isV2 && typeof record.conversationId === 'string'
            ? record.conversationId
            : null
        };
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
  return user && assistant ? { user, assistant, conversationId: null } : null;
}

function serializeConversation(user, assistant, conversationId = null) {
  if (
    typeof user !== 'string' ||
    typeof assistant !== 'string' ||
    !user.trim() ||
    !assistant.trim()
  ) {
    throw new TypeError('A conversation needs non-empty user and assistant text.');
  }

  if (
    typeof conversationId === 'string' &&
    /^[a-zA-Z0-9_-]{8,80}$/.test(conversationId)
  ) {
    return PREFIX_V2 + JSON.stringify({
      version: 2,
      conversationId,
      user,
      assistant
    });
  }

  return PREFIX_V1 + JSON.stringify({
    version: 1,
    user,
    assistant
  });
}

function formatConversationRecord(content) {
  const record = parseConversationRecord(content);
  return record
    ? `User: ${record.user}\\n\\nBuddy: ${record.assistant}`
    : String(content || '');
}

function groupConversationRows(rows) {
  const groups = new Map();

  for (const row of Array.isArray(rows) ? rows.slice().reverse() : []) {
    if (!row || typeof row.content !== 'string') continue;
    const parsed = parseConversationRecord(row.content);
    if (!parsed) continue;

    const conversationId = parsed.conversationId || 'legacy-history';
    let group = groups.get(conversationId);
    if (!group) {
      group = {
        id: conversationId,
        title: conversationId === 'legacy-history' ? 'Earlier conversations' : '',
        created_at: row.created_at || null,
        updated_at: row.created_at || null,
        messages: []
      };
      groups.set(conversationId, group);
    }

    group.messages.push({
      userText: parsed.user,
      buddyText: parsed.assistant,
      created_at: row.created_at || null
    });
    if (!group.title && conversationId !== 'legacy-history') {
      group.title = parsed.user.replace(/\\s+/g, ' ').trim().slice(0, 64) || 'New chat';
    }
    if (row.created_at && (!group.updated_at || row.created_at > group.updated_at)) {
      group.updated_at = row.created_at;
    }
    if (row.created_at && (!group.created_at || row.created_at < group.created_at)) {
      group.created_at = row.created_at;
    }
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      title: group.title || 'New chat'
    }))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

module.exports = {
  PREFIX_V1,
  PREFIX_V2,
  parseConversationRecord,
  serializeConversation,
  formatConversationRecord,
  groupConversationRows
};
