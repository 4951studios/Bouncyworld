const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  KEEPALIVE_PATH,
  MAX_ATTEMPTS,
  requestKeepalive,
  runKeepalive
} = require('./supabase-keepalive');

function createRequestStub(plans, calls = []) {
  return (url, options, onResponse) => {
    const plan = plans.shift();
    calls.push({ url: String(url), options });

    const request = new EventEmitter();
    request.end = () => {
      process.nextTick(() => {
        if (plan.error) {
          request.emit('error', plan.error);
          return;
        }

        const response = new EventEmitter();
        response.statusCode = plan.statusCode ?? 200;
        response.setEncoding = () => {};

        onResponse(response);

        if (plan.body) {
          response.emit('data', plan.body);
        }

        if (plan.responseError) {
          response.emit('error', plan.responseError);
          return;
        }

        response.emit('end');
      });
    };
    request.destroy = (error) => {
      if (error) {
        request.emit('error', error);
      }
    };

    return request;
  };
}

test('requestKeepalive uses an IPv4 GET request', async () => {
  const calls = [];
  const requestImpl = createRequestStub([{ statusCode: 200, body: '{}' }], calls);

  const response = await requestKeepalive(
    new URL('https://example.supabase.co/auth/v1/settings'),
    { apikey: 'anon-key' },
    requestImpl
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, '{}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.family, 4);
});



test('requestKeepalive rejects when the response stream errors', async () => {
  const requestImpl = createRequestStub([
    { statusCode: 200, responseError: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }) }
  ]);

  await assert.rejects(
    requestKeepalive(
      new URL('https://example.supabase.co/auth/v1/settings'),
      { apikey: 'anon-key' },
      requestImpl
    ),
    /socket closed/
  );
});

test('runKeepalive retries transient request failures and preserves the keepalive path', async () => {
  const calls = [];
  const requestImpl = createRequestStub(
    [
      { error: Object.assign(new Error('fetch failed'), { code: 'ETIMEDOUT' }) },
      { statusCode: 200, body: '{}' }
    ],
    calls
  );

  const message = await runKeepalive({
    supabaseUrl: 'https://example.supabase.co/',
    supabaseAnonKey: 'anon-key',
    requestImpl
  });

  assert.match(message, /^Supabase keepalive succeeded at /);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://example.supabase.co${KEEPALIVE_PATH}`);
  assert.ok(calls[1].options.headers.Authorization);
});



test('runKeepalive does not retry deterministic client failures', async () => {
  const calls = [];
  const requestImpl = createRequestStub([{ statusCode: 401, body: 'unauthorized' }], calls);

  await assert.rejects(
    runKeepalive({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      requestImpl
    }),
    /Keepalive failed with status 401: unauthorized/
  );

  assert.equal(calls.length, 1);
});

test('runKeepalive fails after the final unsuccessful attempt', async () => {
  const requestImpl = createRequestStub(
    Array.from({ length: MAX_ATTEMPTS }, () => ({ statusCode: 503, body: 'service unavailable' }))
  );

  await assert.rejects(
    runKeepalive({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      requestImpl
    }),
    /Keepalive failed with status 503: service unavailable/
  );
});
