'use strict';

const DATABASE_NAME = 'buddy-offline-chat-cache';
const DATABASE_VERSION = 1;
const STORE_NAME = 'conversations';
const FALLBACK_STORAGE_KEY = 'buddy_offline_conversations_v1';
const MAX_FALLBACK_CHARS = 1500000;

function normalizeConversationList(conversations) {
  if (!Array.isArray(conversations)) return [];

  return conversations
    .filter(item => item && typeof item.id === 'string' && item.id.trim())
    .map(item => ({
      id: item.id,
      title: typeof item.title === 'string' && item.title.trim() ? item.title : 'New chat',
      created_at: item.created_at || null,
      updated_at: item.updated_at || item.created_at || null,
      messages: (Array.isArray(item.messages) ? item.messages : [])
        .filter(message =>
          message &&
          typeof message.userText === 'string' &&
          typeof message.buddyText === 'string'
        )
        .map(message => ({
          userText: message.userText,
          buddyText: message.buddyText,
          ...(message.created_at ? { created_at: message.created_at } : {})
        }))
    }))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

function mergeConversationLists(remoteConversations, cachedConversations) {
  const merged = new Map();

  for (const conversation of normalizeConversationList(cachedConversations)) {
    merged.set(conversation.id, conversation);
  }

  for (const remote of normalizeConversationList(remoteConversations)) {
    const cached = merged.get(remote.id);
    if (!cached) {
      merged.set(remote.id, remote);
      continue;
    }

    const remoteCount = remote.messages.length;
    const cachedCount = cached.messages.length;
    const useRemote = remoteCount > cachedCount ||
      (remoteCount === cachedCount &&
        String(remote.updated_at || '').localeCompare(String(cached.updated_at || '')) >= 0);

    merged.set(remote.id, useRemote ? remote : cached);
  }

  return normalizeConversationList(Array.from(merged.values()));
}

function createConversationCache({
  getIndexedDB = () => globalThis.indexedDB,
  getLocalStorage = () => globalThis.localStorage
} = {}) {
  let databasePromise = null;

  function openDatabase() {
    const indexedDB = getIndexedDB();
    if (!indexedDB) return Promise.reject(new Error('IndexedDB is unavailable.'));
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error('Could not open offline chat storage.'));
      request.onblocked = () => reject(new Error('Offline chat storage upgrade is blocked.'));
    }).catch(error => {
      databasePromise = null;
      throw error;
    });

    return databasePromise;
  }

  function readFallback() {
    try {
      const storage = getLocalStorage();
      const value = storage?.getItem(FALLBACK_STORAGE_KEY);
      if (!value) return [];
      const parsed = JSON.parse(value);
      return normalizeConversationList(parsed);
    } catch {
      return [];
    }
  }

  function writeFallback(conversations) {
    try {
      const storage = getLocalStorage();
      if (!storage) return false;

      const trimmed = normalizeConversationList(conversations);
      let serialized = JSON.stringify(trimmed);

      // localStorage is only a fallback for browsers without IndexedDB.
      // Retain the newest threads if the browser has a small storage quota.
      while (serialized.length > MAX_FALLBACK_CHARS && trimmed.length > 1) {
        trimmed.pop();
        serialized = JSON.stringify(trimmed);
      }

      if (serialized.length > MAX_FALLBACK_CHARS) return false;
      storage.setItem(FALLBACK_STORAGE_KEY, serialized);
      return true;
    } catch {
      return false;
    }
  }

  async function readIndexedDB() {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();

    const records = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Could not read offline chats.'));
      transaction.onabort = () => reject(transaction.error || new Error('Offline chat read was aborted.'));
    });

    return normalizeConversationList(records);
  }

  async function writeIndexedDB(conversations) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const done = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not save offline chats.'));
      transaction.onabort = () => reject(transaction.error || new Error('Offline chat save was aborted.'));
    });

    store.clear();
    for (const conversation of conversations) {
      store.put(conversation);
    }

    await done;
  }

  async function load() {
    try {
      const indexed = await readIndexedDB();
      if (indexed.length) return indexed;

      const fallback = readFallback();
      if (fallback.length) {
        try {
          await writeIndexedDB(fallback);
        } catch {
          // Keep the localStorage copy available when IndexedDB cannot be written.
        }
      }
      return fallback;
    } catch {
      return readFallback();
    }
  }

  async function save(conversations) {
    const normalized = normalizeConversationList(conversations);
    let indexedDBSaved = false;

    try {
      await writeIndexedDB(normalized);
      indexedDBSaved = true;
    } catch {
      // Some WebViews disable IndexedDB. Use the smaller localStorage fallback.
    }

    const fallbackSaved = writeFallback(normalized);
    return indexedDBSaved || fallbackSaved;
  }

  return { load, save };
}

const defaultCache = createConversationCache();

async function loadCachedConversations() {
  return defaultCache.load();
}

async function saveCachedConversations(conversations) {
  return defaultCache.save(conversations);
}

module.exports = {
  normalizeConversationList,
  mergeConversationLists,
  createConversationCache,
  loadCachedConversations,
  saveCachedConversations
};
