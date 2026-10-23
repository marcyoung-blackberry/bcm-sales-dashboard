const { createHmac } = require('node:crypto');

exports.handler = async function(event) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const fail = (statusCode, error) => ({ statusCode, headers, body: JSON.stringify({ error }) });
  if (event.httpMethod !== 'GET') return fail(405, 'Method not allowed');
  // Never accept caller-supplied URLs or expose an open proxy.
  const endpoint = process.env.BCM_SHEETS_BRIDGE_URL;
  const secret = process.env.BCM_SHEETS_BRIDGE_SECRET;
  if (!endpoint || !secret) return fail(503, 'Google Sheets connection is not configured');
  try {
    const target = new URL(endpoint);
    if (target.protocol !== 'https:' || target.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(target.pathname)) {
      return fail(503, 'Google Sheets connection is not configured');
    }
    const timestamp = String(Date.now());
    target.searchParams.set('timestamp', timestamp);
    target.searchParams.set('signature', createHmac('sha256', secret).update(timestamp).digest('hex'));
    const response = await fetch(target, { signal: AbortSignal.timeout(25000), redirect: 'follow' });
    if (!response.ok) return fail(502, 'Google Sheets is temporarily unavailable');
    const payload = await response.json();
    if (payload.schemaVersion !== 1 || typeof payload.csv !== 'string' || !payload.csv.startsWith('"Date",') || !Number.isFinite(Date.parse(payload.updatedAt))) {
      return fail(502, 'Google Sheets returned an invalid response');
    }
    return { statusCode: 200, headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' }, body: payload.csv };
  } catch {
    return fail(502, 'Google Sheets is temporarily unavailable');
  }
};
