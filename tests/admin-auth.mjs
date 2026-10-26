// Integration test for the admin-API authorization fix (security finding #1).
// Runs against the local dev server on http://localhost:3000.
//
//   node tests/admin-auth.mjs
//
// Proves that an authenticated AGENT token replayed in the admin cookie is
// rejected (403) by every admin/superadmin API, that an anonymous request is
// rejected (401), and that a real super-admin is allowed through a safe read.

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_COOKIE = 'next-admin-auth.session-token';
const AGENT_COOKIE = 'next-auth.session-token';

const AGENT = { identifier: 'AGT-00142', password: 'collo123' };
const ADMIN = { email: 'admin@vochusglobalservices.co.uk', password: 'Vc#Admin2026!' };

// Representative routes across the admin surface. Destructive routes are only
// checked for rejection (agent token / anonymous), never for a successful call.
const ROUTES = [
  { method: 'GET', path: '/api/admin/stats' },
  { method: 'GET', path: '/api/admin/customers' },
  { method: 'POST', path: '/api/admin/wallets/fund' },
  { method: 'POST', path: '/api/superadmin/agents/nonexistent/documents/approve' },
];

function cookiesFrom(res, jar = {}) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
}
const header = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function agentToken() {
  const jar = {};
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  cookiesFrom(csrfRes, jar);
  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({ csrfToken, ...AGENT, json: 'true' });
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: header(jar) },
    body,
    redirect: 'manual',
  });
  cookiesFrom(res, jar);
  if (!jar[AGENT_COOKIE]) throw new Error('agent login did not set a session token');
  return jar[AGENT_COOKIE];
}

async function adminToken() {
  const res = await fetch(`${BASE}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  const jar = cookiesFrom(res);
  if (!jar[ADMIN_COOKIE]) throw new Error('admin login did not set a session token');
  return jar[ADMIN_COOKIE];
}

async function status(route, cookie) {
  const res = await fetch(`${BASE}${route.path}`, {
    method: route.method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(route.method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(route.method === 'POST' ? { body: '{}' } : {}),
    redirect: 'manual',
  });
  return res.status;
}

const results = [];
function check(name, actual, expected) {
  const ok = actual === expected;
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} — got ${actual}, expected ${expected}`);
}

const agent = await agentToken();
const admin = await adminToken();

console.log('Admin API authorization:');
for (const route of ROUTES) {
  const label = `${route.method} ${route.path}`;
  check(`agent token rejected — ${label}`, await status(route, `${ADMIN_COOKIE}=${agent}`), 403);
  check(`anonymous rejected — ${label}`, await status(route, ''), 401);
}
// Safe read proves a real super-admin is still allowed through.
check('real super-admin allowed — GET /api/admin/stats', await status(ROUTES[0], `${ADMIN_COOKIE}=${admin}`), 200);

if (results.every(Boolean)) {
  console.log('ALL PASS');
  process.exit(0);
} else {
  console.log('FAILURES PRESENT');
  process.exit(1);
}
