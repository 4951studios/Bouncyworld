const https = require('node:https');

const KEEPALIVE_PATH = '/auth/v1/settings';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ERR_SOCKET_CONNECTION_TIMEOUT'
]);

function truncateResponseBody(body) {
  return String(body).slice(0, 300);
}

function isRetryableStatus(statusCode) {
  return statusCode === 429 || statusCode >= 500;
}

function markRetryableError(error) {
  if (error instanceof Error && RETRYABLE_ERROR_CODES.has(error.code)) {
    error.retryable = true;
  }

  return error;
}

function requestKeepalive(url, headers, requestImpl = https.request) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let requestTimeout;
    const settle = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(requestTimeout);
      callback(value);
    };

    const request = requestImpl(
      url,
      {
        method: 'GET',
        headers,
        family: 4,
        timeout: REQUEST_TIMEOUT_MS
      },
      (response) => {
        let responseBody = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('error', (error) => {
          settle(reject, markRetryableError(error));
        });
        response.on('end', () => {
          settle(resolve, {
            statusCode: response.statusCode ?? 0,
            body: responseBody
          });
        });
      }
    );

    requestTimeout = setTimeout(() => {
      const error = new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      error.retryable = true;
      request.destroy(error);
    }, REQUEST_TIMEOUT_MS);

    request.on('timeout', () => {
      const error = new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      error.retryable = true;
      request.destroy(error);
    });
    request.on('error', (error) => {
      settle(reject, markRetryableError(error));
    });
    request.end();
  });
}

async function runKeepalive({
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseAnonKey = process.env.SUPABASE_ANON_KEY,
  requestImpl = https.request
} = {}) {
  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable.');
  }

  if (!supabaseAnonKey) {
    throw new Error('Missing SUPABASE_ANON_KEY environment variable.');
  }

  const keepaliveUrl = new URL(`${supabaseUrl.replace(/\/$/, '')}${KEEPALIVE_PATH}`);
  const headers = {
    apikey: supabaseAnonKey,
    Authorization: 'Bearer ' + supabaseAnonKey,
    Accept: 'application/json',
    'User-Agent': 'bouncy-world-supabase-keepalive'
  };

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await requestKeepalive(keepaliveUrl, headers, requestImpl);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        const error = new Error(
          `Keepalive failed with status ${response.statusCode}: ${truncateResponseBody(response.body)}`
        );

        error.retryable = isRetryableStatus(response.statusCode);
        throw error;
      }

      return `Supabase keepalive succeeded at ${new Date().toISOString()}`;
    } catch (error) {
      lastError = error;

      const shouldRetry = attempt < MAX_ATTEMPTS && error instanceof Error && error.retryable === true;

      if (!shouldRetry) {
        throw error;
      }

      console.warn(
        `Keepalive request attempt ${attempt} failed: ${
          error instanceof Error ? error.message : String(error)
        }. Retrying...`
      );
    }
  }

  throw lastError;
}

async function main() {
  const message = await runKeepalive();
  console.log(message);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  KEEPALIVE_PATH,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  requestKeepalive,
  runKeepalive
};
