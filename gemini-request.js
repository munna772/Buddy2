'use strict';

function responsePriority(response) {
  if (response.status === 429) return 0;
  if (response.status === 401 || response.status === 403) return 1;
  if (response.status >= 500) return 2;
  return 3;
}

async function fetchGeminiWithFallback(url, options = {}, config = {}) {
  const apiKeys = Array.isArray(config.apiKeys) ? config.apiKeys : [];
  const connectTimeoutMs = Number.isFinite(config.connectTimeoutMs)
    ? Math.max(1, config.connectTimeoutMs)
    : 30000;
  const staggerMs = Number.isFinite(config.staggerMs)
    ? Math.max(0, config.staggerMs)
    : 6000;
  const fetchImpl = config.fetchImpl || globalThis.fetch;
  const logger = config.logger || console;

  if (apiKeys.length === 0) {
    throw new Error('No Gemini API key is configured.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is not available for Gemini requests.');
  }

  return new Promise((resolve, reject) => {
    const attempts = [];
    const failedResponses = [];
    const failures = [];
    let started = 0;
    let completed = 0;
    let settled = false;
    let launchTimer = null;

    const clearLaunchTimer = () => {
      if (launchTimer) {
        clearTimeout(launchTimer);
        launchTimer = null;
      }
    };

    const clearAttemptTimers = () => {
      for (const attempt of attempts) {
        if (attempt.timer) {
          clearTimeout(attempt.timer);
          attempt.timer = null;
        }
      }
    };

    const cancelResponseBody = response => {
      if (response?.body && !response.bodyUsed) {
        void response.body.cancel().catch(() => {});
      }
    };

    const cleanup = keepIndex => {
      clearLaunchTimer();
      clearAttemptTimers();
      options.signal?.removeEventListener('abort', onParentAbort);

      for (const attempt of attempts) {
        if (attempt.index !== keepIndex && !attempt.controller.signal.aborted) {
          attempt.controller.abort();
        }
      }
    };

    const finishWithResponse = (response, winningIndex = null) => {
      if (settled) {
        cancelResponseBody(response);
        return;
      }
      settled = true;
      cleanup(winningIndex);

      for (const entry of failedResponses) {
        if (entry.response !== response) cancelResponseBody(entry.response);
      }

      resolve(response);
    };

    const finishWithError = error => {
      if (settled) return;
      settled = true;
      cleanup(null);
      for (const entry of failedResponses) cancelResponseBody(entry.response);
      reject(error);
    };

    function onParentAbort() {
      finishWithError(
        options.signal?.reason || new Error('Gemini request was cancelled.')
      );
    }

    const finishAllAttempts = () => {
      if (settled || started < apiKeys.length || completed < started) return;

      if (failedResponses.length) {
        const preferred = [...failedResponses].sort((a, b) =>
          responsePriority(a.response) - responsePriority(b.response) ||
          a.index - b.index
        )[0];

        logger.error?.(
          'All Gemini keys failed to return a successful response; final HTTP status: ' +
          preferred.response.status + '.'
        );
        finishWithResponse(preferred.response, null);
        return;
      }

      const detail = failures.length
        ? failures.map(item => item.message).join(' | ')
        : 'No Gemini key returned a response.';
      finishWithError(new Error('All configured Gemini API keys failed: ' + detail));
    };

    const startNextAttempt = () => {
      if (settled || started >= apiKeys.length) return;
      clearLaunchTimer();

      const index = started++;
      const configuredKey = apiKeys[index];
      const controller = new AbortController();
      const attempt = {
        index,
        label: configuredKey.label || 'key ' + (index + 1),
        controller,
        timer: null,
        timedOut: false
      };
      attempts.push(attempt);

      const headers = {
        ...(options.headers || {}),
        'x-goog-api-key': configuredKey.key
      };
      const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;

      attempt.timer = setTimeout(() => {
        attempt.timedOut = true;
        controller.abort();
      }, connectTimeoutMs);

      Promise.resolve()
        .then(() => fetchImpl(url, {
          ...options,
          headers,
          signal
        }))
        .then(response => {
          if (attempt.timer) {
            clearTimeout(attempt.timer);
            attempt.timer = null;
          }

          if (settled) {
            cancelResponseBody(response);
            return;
          }

          if (response.ok) {
            logger.info?.(
              'Gemini ' + attempt.label + ' key request succeeded (HTTP ' +
              response.status + ').'
            );
            finishWithResponse(response, index);
            return;
          }

          failedResponses.push({ index, response });
          logger.warn?.(
            'Gemini ' + attempt.label + ' key returned HTTP ' +
            response.status + '; checking the other configured keys.'
          );
          completed++;

          if (started < apiKeys.length) {
            startNextAttempt();
          } else {
            finishAllAttempts();
          }
        })
        .catch(error => {
          if (attempt.timer) {
            clearTimeout(attempt.timer);
            attempt.timer = null;
          }

          if (settled) return;

          if (options.signal?.aborted) {
            finishWithError(options.signal.reason || error);
            return;
          }

          const detail = attempt.timedOut
            ? 'did not return response headers within ' + connectTimeoutMs + 'ms'
            : 'request failed before response headers: ' + String(error?.message || error);

          failures.push({ index, message: attempt.label + ' ' + detail });
          logger.warn?.('Gemini ' + attempt.label + ' key ' + detail + '.');
          completed++;

          if (started < apiKeys.length) {
            startNextAttempt();
          } else {
            finishAllAttempts();
          }
        });

      // Hedge the next key after a short delay even when this one is still
      // pending. A quick error advances immediately instead of waiting here.
      if (started < apiKeys.length) {
        launchTimer = setTimeout(startNextAttempt, staggerMs);
      }
    };

    if (options.signal?.aborted) {
      finishWithError(options.signal.reason || new Error('Gemini request was cancelled.'));
      return;
    }

    options.signal?.addEventListener('abort', onParentAbort, { once: true });
    startNextAttempt();
  });
}

module.exports = { fetchGeminiWithFallback };
