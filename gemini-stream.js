'use strict';

function parseGeminiData(dataText) {
  const trimmed = String(dataText || '').trim();

  if (!trimmed || trimmed === '[DONE]') {
    return { text: '', finishReason: '', finishMessage: '', blockReason: '' };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Gemini returned invalid stream JSON: ${error.message}`);
  }

  if (parsed.error) {
    throw new Error(parsed.error.message || 'Gemini reported a streaming error.');
  }

  const candidate = parsed.candidates?.[0] || {};
  return {
    text: (candidate.content?.parts || [])
      .map(part => typeof part.text === 'string' ? part.text : '')
      .join(''),
    finishReason: candidate.finishReason || '',
    finishMessage: candidate.finishMessage || '',
    blockReason: parsed.promptFeedback?.blockReason || ''
  };
}

async function readGeminiStream(stream, onText, { idleTimeoutMs = 45000 } = {}) {
  if (!stream) {
    throw new Error('Gemini did not return a response stream.');
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines = [];
  let completeText = '';
  let finishReason = '';
  let finishMessage = '';
  let blockReason = '';

  async function dispatchEvent() {
    if (dataLines.length === 0) return;

    const parsed = parseGeminiData(dataLines.join('\n'));
    dataLines = [];

    if (parsed.finishReason) finishReason = parsed.finishReason;
    if (parsed.finishMessage) finishMessage = parsed.finishMessage;
    if (parsed.blockReason) blockReason = parsed.blockReason;

    if (parsed.text) {
      completeText += parsed.text;
      await onText(parsed.text);
    }
  }

  async function processLine(line) {
    if (line === '' || line === '\r') {
      await dispatchEvent();
      return;
    }
    if (line.startsWith(':')) return;

    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
  }

  try {
    while (true) {
      let idleTimer;
      let readResult;

      try {
        readResult = await Promise.race([
          reader.read(),
          new Promise((_, reject) => {
            idleTimer = setTimeout(() => {
              reject(new Error(`Gemini stream idle timeout: no data received for ${idleTimeoutMs}ms.`));
            }, idleTimeoutMs);
          })
        ]);
      } finally {
        clearTimeout(idleTimer);
      }

      const { value, done } = readResult;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const lineEnd = buffer.search(/[\r\n]/);
        if (lineEnd === -1) break;

        const terminator = buffer[lineEnd];
        if (terminator === '\r' && lineEnd === buffer.length - 1) break;

        const delimiterLength =
          terminator === '\r' && buffer[lineEnd + 1] === '\n' ? 2 : 1;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + delimiterLength);
        await processLine(line);
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) {
      const finalLine = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      await processLine(finalLine);
    }

    await dispatchEvent();

    return { text: completeText, finishReason, finishMessage, blockReason };
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The upstream stream may already be closed.
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may already have released its lock.
    }
  }
}

module.exports = { parseGeminiData, readGeminiStream };
