import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, normalizeResults, publicUrl } from '../../api/radar.js';

const env = { RADAR_DASHBOARD_KEY: 'test-key', BRAVE_SEARCH_API_KEY: 'provider-secret', UPSTASH_REDIS_REST_URL: 'https://fixture.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'budget-secret', RADAR_DAILY_LIMIT: '10', RADAR_MONTHLY_LIMIT: '30', RADAR_BUDGET_CENTS: '8000', RADAR_SEARCH_RESERVE_CENTS: '10', RADAR_AUDIT_RESERVE_CENTS: '100' };
const request = (body = { niche: 'Dentistas', region: 'Campinas, SP' }, options = {}) => new Request('https://crm.example.com/api/radar', { method: 'POST', headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json', ...options.headers }, body: JSON.stringify(body) });
function fixture({ config = env, budget = [1, 1, 1], providerStatus = 200, provider = { web: { results: [{ title: 'Clínica Exemplo', url: 'https://clinica.example.com', description: 'Atendimento em Campinas' }] } }, throws, budgetStatus = 200 } = {}) {
  const calls = [];
  const handler = createHandler({ env: config, now: () => new Date('2026-11-10T03:00:00Z'), fetcher: async (url, options) => {
    calls.push({ url: String(url), options });
    const redis = String(url).includes('upstash');
    if (throws === (redis ? 'budget' : 'provider')) throw new Error('secret exception');
    return Response.json(redis ? { result: JSON.parse(options.body)[2] === 1 && Array.isArray(budget) && budget[0] === 1 ? [1, 10] : budget } : provider, { status: redis ? budgetStatus : providerStatus });
  } });
  return { handler, calls };
}
test('rejects unauthorized and cross-origin requests before any external call', async () => {
  const f = fixture();
  assert.equal((await f.handler(request(undefined, { headers: { Authorization: 'Bearer wrong' } }))).status, 401);
  assert.equal((await f.handler(request(undefined, { headers: { Origin: 'https://other.com' } }))).status, 403);
  assert.equal(f.calls.length, 0);
});
test('missing credentials, invalid Redis URL or missing budget fail closed', async () => {
  for (const [key, value] of [['RADAR_DASHBOARD_KEY', ''], ['BRAVE_SEARCH_API_KEY', ''], ['UPSTASH_REDIS_REST_URL', 'http://localhost'], ['UPSTASH_REDIS_REST_TOKEN', ''], ['RADAR_DAILY_LIMIT', '0'], ['RADAR_MONTHLY_LIMIT', 'NaN']]) {
    const f = fixture({ config: { ...env, [key]: value } });
    assert.equal((await f.handler(request())).status, 503); assert.equal(f.calls.length, 0);
  }
});
test('status is authenticated and never consumes provider or budget calls', async () => {
  const f = fixture();
  const response = await f.handler(new Request('https://crm.example.com/api/radar', { headers: { Authorization: 'Bearer test-key' } }));
  assert.equal((await response.json()).ready, true); assert.equal(f.calls.length, 0);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('rejects malformed, oversized and operator-injected searches', async () => {
  const f = fixture();
  for (const body of [null, {}, { niche: 'x', region: 'SP' }, { niche: 'site:example.com', region: 'SP' }, { niche: 'a'.repeat(2200), region: 'SP' }]) assert.equal((await f.handler(request(body))).status, 400);
  assert.equal(f.calls.length, 0);
});
test('budget exhaustion, cooldown, failed and malformed counters never call search', async () => {
  for (const budget of [[0, 10, 20], [-1, 1, 1], null, [1, '1', 1], [2, 1, 1]]) {
    const f = fixture({ budget }); const r = await f.handler(request()); assert.ok([429, 503].includes(r.status)); assert.equal(f.calls.length, 1);
  }
  const f = fixture({ throws: 'budget' }); assert.equal((await f.handler(request())).status, 503); assert.equal(f.calls.length, 1);
});
test('one atomic reservation then one bounded Brave call with protected credentials', async () => {
  const f = fixture(), response = await f.handler(request()), data = await response.json();
  assert.equal(response.status, 200); assert.equal(f.calls.length, 3); assert.equal(data.results[0].name, 'Clínica Exemplo');
  const command = JSON.parse(f.calls[0].options.body);
  assert.equal(command[0], 'EVAL'); assert.equal(command[2], 3); assert.equal(command[3], 'radar:v1:day:2026-11-10');
  const url = new URL(f.calls[2].url); assert.equal(url.searchParams.get('count'), '20'); assert.equal(url.searchParams.get('search_lang'), 'pt-br');
  assert.equal(f.calls[2].options.headers['X-Subscription-Token'], 'provider-secret');
  assert.ok(!JSON.stringify(data).includes('secret')); assert.equal(data.results[0].platform, 'Não verificada');
});
test('provider denial, quota, timeouts and malformed results have no retries or secret leakage', async () => {
  for (const options of [{ providerStatus: 401 }, { providerStatus: 429 }, { throws: 'provider' }, { provider: { web: { results: {} } } }]) {
    const f = fixture(options), r = await f.handler(request()); assert.equal(r.status, 502); assert.equal(f.calls.length, 3); assert.ok(!(await r.text()).includes('secret'));
  }
});
test('genuine empty result remains empty', async () => {
  const f = fixture({ provider: {} }); const data = await (await f.handler(request())).json(); assert.deepEqual(data.results, []);
});
test('normalizes domains, removes tracking params, excludes platform evidence and directories', () => {
  const row = (url, description = 'Empresa local') => ({ url, title: '<b>Empresa</b>', description });
  const data = normalizeResults([row('https://www.example.com/a?utm_source=x#top'), row('http://example.com/b'), row('https://store.com', 'Loja feita na Nuvemshop'), row('https://foo.myshopify.com'), row('https://instagram.com/empresa'), row('javascript:alert(1)'), row('https://safe.com', 'Atendimento local')]);
  assert.equal(data.results.length, 2); assert.equal(data.results[0].url, 'https://www.example.com/a'); assert.equal(data.results[0].name, 'Empresa');
  assert.deepEqual(data.removed, { duplicates: 1, platforms: 2, other: 2 });
});
test('unsafe URLs and credentials are excluded', () => {
  for (const url of ['file:///tmp/x', 'https://user:pass@example.com', 'http://127.0.0.1', 'http://[::1]', 'https://localhost', 'https://example.com:123']) assert.equal(publicUrl(url), null);
});
test('provider cannot expand the 20-result bound and non-array snippets are safe', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ title: `Business ${i}`, url: `https://business${i}.com`, extra_snippets: 'unexpected' }));
  assert.equal(normalizeResults(rows).results.length, 20);
});
