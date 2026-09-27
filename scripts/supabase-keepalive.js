const https = require('node:https');

const KEEPALIVE_PATH = '/auth/v1/settings';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3;

function truncateResponseBody(body) {
  return String(body).slice(0, 300);
}

function requestKeepalive(url, headers, requestImpl = https.request) {
  return new Promise((resolve, reject) => {
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
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: responseBody
          });
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    request.on('error', reject);
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
        throw new Error(
          `Keepalive failed with status ${response.statusCode}: ${truncateResponseBody(response.body)}`
        );
      }

      return `Supabase keepalive succeeded at ${new Date().toISOString()}`;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `Keepalive request attempt ${attempt} failed: ${
            error instanceof Error ? error.message : String(error)
          }. Retrying...`
        );
      }
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
