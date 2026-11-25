import { evaluateRequest, sandboxExecute, policy } from './policy.js';

// Replaced with the complete HTML document by scripts/build.mjs.
const page = '__AGENTGUARD_UI__';
const headers = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'",
};
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8', ...extra } });
}
function apiFail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function rowToRequest(row) {
  return { id: row.id, tool: row.tool, arguments: JSON.parse(row.arguments_json), decision: row.decision, reason: row.reason, status: row.status, created_at: row.created_at, updated_at: row.updated_at, result: row.result_json ? JSON.parse(row.result_json) : null };
}
async function bodyJSON(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) apiFail('Send a JSON request.', 415);
  let size = 0;
  const parts = [];
  for await (const chunk of request.body || []) {
    size += chunk.byteLength;
    if (size > 16384) apiFail('Request is too large. Use less than 16 KB.', 413);
    parts.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { apiFail('Enter valid JSON.'); }
}
async function eventsFor(env, owner) {
  const rows = await env.DB.prepare('SELECT id, request_id, action, status, created_at FROM audit_events WHERE owner_id = ? ORDER BY created_at DESC LIMIT 500').bind(owner).all();
  return rows.results || [];
}
async function requestsFor(env, owner) {
  const rows = await env.DB.prepare('SELECT * FROM requests WHERE owner_id = ? ORDER BY created_at DESC LIMIT 250').bind(owner).all();
  return (rows.results || []).map(rowToRequest);
}
async function api(request, env, url) {
  const owner = request.headers.get('oai-authenticated-user-id') || (env.LOCAL_DEV === 'true' ? 'local-preview' : null);
  if (!owner) return json({ error: 'Sign in to your private AgentGuard site to use the policy lab.' }, 401);
  if (!env.DB) return json({ error: 'The audit database is unavailable. Requests are not being executed.' }, 503);
  if (request.method !== 'GET') {
    if (request.headers.get('origin') !== url.origin) apiFail('This action must come from the AgentGuard site.', 403);
  }
  if (request.method === 'GET' && url.pathname === '/api/state') {
    return json({ mode: 'sandbox', storage: 'D1', policy, requests: await requestsFor(env, owner) });
  }
  if (request.method === 'GET' && url.pathname === '/api/export') {
    return json({ application: 'AgentGuard', mode: 'sandbox', exported_at: new Date().toISOString(), requests: await requestsFor(env, owner), events: await eventsFor(env, owner), limits: { requests: 250, events: 500 } }, 200, { 'content-disposition': 'attachment; filename="agentguard-audit.json"' });
  }
  if (request.method === 'POST' && url.pathname === '/api/evaluate') {
    const input = await bodyJSON(request);
    const evaluation = evaluateRequest(input);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const status = { ALLOW: 'READY', BLOCK: 'BLOCKED', REQUIRE_APPROVAL: 'PENDING_APPROVAL' }[evaluation.decision];
    const payloadDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ tool: input.tool, arguments: input.arguments }))))).map(n => n.toString(16).padStart(2, '0')).join('');
    const row = { id, ...evaluation, status, created_at: now, updated_at: now, result: null };
    await env.DB.batch([
      env.DB.prepare('INSERT INTO requests (id, owner_id, tool, arguments_json, payload_digest, decision, reason, status, created_at, updated_at, transition_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, owner, row.tool, JSON.stringify(row.arguments), payloadDigest, row.decision, row.reason, status, now, now, id),
      env.DB.prepare('INSERT INTO audit_events (id, request_id, owner_id, action, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, owner, 'EVALUATED', status, now),
    ]);
    return json({ request: row }, 201);
  }
  const match = /^\/api\/requests\/([0-9a-f-]{36})\/(approve|reject|execute)$/.exec(url.pathname);
  if (request.method === 'POST' && match) {
    const body = await bodyJSON(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) apiFail('This action does not accept changes to the original request.');
    const [, id, action] = match;
    const existing = await env.DB.prepare('SELECT * FROM requests WHERE id = ? AND owner_id = ?').bind(id, owner).first();
    if (!existing) apiFail('Request not found.', 404);
    const required = action === 'execute' ? ['READY', 'APPROVED'] : ['PENDING_APPROVAL'];
    if (!required.includes(existing.status)) apiFail('This request is no longer eligible for that action. Refresh and try again.', 409);
    if (action === 'execute' && (existing.decision === 'BLOCK' || (existing.decision === 'REQUIRE_APPROVAL' && existing.status !== 'APPROVED'))) apiFail('The policy does not permit execution.', 403);
    const status = { approve: 'APPROVED', reject: 'REJECTED', execute: 'EXECUTED' }[action];
    const result = action === 'execute' ? sandboxExecute(rowToRequest(existing)) : null;
    const now = new Date().toISOString();
    const transition = crypto.randomUUID();
    const changed = await env.DB.batch([
      env.DB.prepare('UPDATE requests SET status = ?, result_json = ?, updated_at = ?, transition_id = ? WHERE id = ? AND owner_id = ? AND status = ? RETURNING *').bind(status, result ? JSON.stringify(result) : null, now, transition, id, owner, existing.status),
      env.DB.prepare('INSERT INTO audit_events (id, request_id, owner_id, action, status, created_at) SELECT ?, id, owner_id, ?, status, ? FROM requests WHERE id = ? AND owner_id = ? AND transition_id = ?').bind(crypto.randomUUID(), action.toUpperCase(), now, id, owner, transition),
    ]);
    const updated = changed[0].results?.[0];
    if (!updated) apiFail('Another action updated this request. Refresh and try again.', 409);
    return json({ request: rowToRequest(updated) });
  }
  return json({ error: 'Endpoint not found.' }, 404);
}
export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
      if (url.pathname === '/health' && request.method === 'GET') return json({ application: 'AgentGuard', mode: 'sandbox', status: 'ok' });
      if (url.pathname === '/' && request.method === 'GET') return new Response(page, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
      return new Response('Not found', { status: 404, headers });
    } catch (error) {
      const known = Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
      return json({ error: known ? error.message : 'The request could not be saved. No tool action was performed. Try again shortly.' }, known ? error.status : 503);
    }
  },
};

