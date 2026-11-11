import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuditHandler } from '../../api/radar-audit.js';
import { ticket, readTicket, reserveSpend, spendingConfigured } from '../../lib/radar-control.mjs';
const now = new Date('2026-11-10T12:00:00Z');
const env = { RADAR_DASHBOARD_KEY: 'test-key', UPSTASH_REDIS_REST_URL: 'https://fixture.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'secret', RADAR_AUDIT_ENABLED: 'true', RADAR_AUDIT_DAILY_LIMIT: '10', RADAR_BUDGET_CENTS: '8000', RADAR_SEARCH_RESERVE_CENTS: '10', RADAR_AUDIT_RESERVE_CENTS: '100' };
const request = (body, method = 'POST', suffix = '', headers = {}) => new Request('https://crm.example.com/api/radar-audit' + suffix, { method, headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
const candidate = () => ({ ticket: ticket('https://shop.example.com/', env, now.getTime()) });
function fixture(result = [1, '11111111-1111-4111-8111-111111111111'], config = env) {
  const calls = [];
  const handler = createAuditHandler({ env: config, now: () => now, fetcher: async (_url, options) => { calls.push(JSON.parse(options.body)); return Response.json({ result }); } });
  return { handler, calls };
}
test('auth, origin, setup and forged/expired ticket fail before Redis', async () => {
  const f = fixture();
  assert.equal((await f.handler(request(candidate(), 'POST', '', { Authorization: 'Bearer bad' }))).status, 401);
  assert.equal((await f.handler(request(candidate(), 'POST', '', { Origin: 'https://attacker.com' }))).status, 401);
  for (const value of ['bad', ticket('https://shop.example.com/', env, now.getTime() - 7200000), ticket('http://shop.example.com/', env, now.getTime())]) assert.equal((await f.handler(request({ ticket: value }))).status, 400);
  assert.equal(f.calls.length, 0);
  assert.equal((await fixture(null, { ...env, RADAR_AUDIT_ENABLED: 'false' }).handler(request(candidate()))).status, 503);
});
test('one Lua transaction reserves quota/spend and deduplicates/enqueues atomically', async () => {
  const f = fixture(); assert.equal((await f.handler(request(candidate()))).status, 202);
  assert.equal(f.calls.length, 1); const c = f.calls[0];
  assert.equal(c[0], 'EVAL'); assert.equal(c[2], 6);
  assert.equal(c[5], 'radar:v2:reserved-cents'); assert.equal(c[8], 'radar:v2:worker');
  assert.match(c[1], /duplicate/); assert.match(c[1], /INCRBY/); assert.match(c[1], /ZADD/);
  assert.equal(c[13], 8000);
});
test('budget/offline/dedup/store failure responses remain explicit', async () => {
  for (const [result, status] of [[[0, ''], 429], [[-2, ''], 503], [[2, '11111111-1111-4111-8111-111111111111'], 202], [null, 503], [[7, ''], 503]]) assert.equal((await fixture(result).handler(request(candidate()))).status, status);
});
test('private status, expired result and interrupted worker require no provider calls', async () => {
  const online = await (await fixture(['online', '120']).handler(request(null, 'GET'))).json(); assert.equal(online.reservedCents, 120);
  const id = '?id=11111111-1111-4111-8111-111111111111';
  assert.equal((await fixture(null).handler(request(null, 'GET', id))).status, 404);
  const job = await (await fixture(JSON.stringify({ status: 'running', createdAt: '2026-11-10T11:00:00Z' })).handler(request(null, 'GET', id))).json();
  assert.equal(job.status, 'interrupted');
});
test('signed URLs cannot be changed and hard budget cannot exceed R$80', async () => {
  const signed = candidate().ticket; assert.equal(readTicket(signed + 'x', env, now.getTime()), null);
  assert.equal(spendingConfigured({ ...env, RADAR_BUDGET_CENTS: '8001' }), false);
  assert.equal(spendingConfigured({ ...env, RADAR_AUDIT_RESERVE_CENTS: '0' }), false);
  let calls = 0;
  const result = await reserveSpend(env, async command => { calls++; assert.equal(command[0], 'EVAL'); return [0, 8000]; }, 'search');
  assert.equal(result.allowed, false); assert.equal(calls, 1);
});
