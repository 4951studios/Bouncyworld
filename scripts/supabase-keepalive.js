const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_URL environment variable.');
  process.exit(1);
}

if (!SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_ANON_KEY environment variable.');
  process.exit(1);
}

async function main() {
  const baseUrl = SUPABASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/auth/v1/settings`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
      'User-Agent': 'bouncy-world-supabase-keepalive'
    }
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `Keepalive failed with status ${response.status}: ${responseBody.slice(0, 300)}`
    );
  }

  console.log(`Supabase keepalive succeeded at ${new Date().toISOString()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});