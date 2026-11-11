import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { safeUrl, publicAddress, safeGet, crawlPolicy } from '../safe-network.mjs';
import { validateDiagnosis, visualDiagnosis, ranking } from '../diagnose.mjs';
import { processJob } from '../run.mjs';

test('blocks local, private, metadata, reserved and IPv6 destinations', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '::1', '::ffff:127.0.0.1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  for (const url of ['http://store.com', 'https://127.1', 'https://2130706433', 'https://[::1]', 'https://user:pass@store.com', 'https://store.com:123', 'file:///etc/passwd', 'https://foo.local', 'https://localhost']) assert.throws(() => safeUrl(url), undefined, url);
});
test('all DNS results must be public; no socket for mixed/private answers', async () => {
  let connected = false;
  await assert.rejects(safeGet('https://store.com', { resolve: async () => [{ address: '8.8.8.8' }, { address: '127.0.0.1' }], transport: () => { connected = true; } }));
  assert.equal(connected, false);
});
test('pins validated DNS address and never follows a redirect', async () => {
  let count = 0;
  const result = await safeGet('https://store.com', { resolve: async () => [{ address: '8.8.8.8' }], transport: (url, options, callback) => {
    count++; assert.equal(url.hostname, 'store.com'); assert.equal(options.agent, false);
    options.lookup('store.com', {}, (err, address, family) => { assert.equal(err, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
    const req = new EventEmitter(); req.end = () => queueMicrotask(() => {
      const res = new EventEmitter(); res.statusCode = 302; res.headers = { location: 'http://169.254.169.254/' }; callback(res); res.emit('end'); req.emit('close');
    }); return req;
  } });
  assert.equal(result.status, 302); assert.equal(count, 1);
});
test('robots policy respects exclusions and blocks unavailable policies', async () => {
  const rules = await crawlPolicy('https://store.com', async () => ({ status: 200, body: Buffer.from('User-agent: *\nDisallow: /private\nAllow: /\nCrawl-delay: 2') }));
  assert.equal(rules.allows('https://store.com/private/item'), false); assert.equal(rules.delay, 2000);
  assert.equal(rules.allows('https://store.com/catalog'), true);
  for (const status of [301, 401, 403, 429, 500]) await assert.rejects(crawlPolicy('https://store.com', async () => ({ status })));
});
const evidence = { screenshots: [{ id: 'desktop', width: 1365, height: 900, data: 'data:image/jpeg;base64,AAAA' }, { id: 'mobile', width: 390, height: 844, data: 'data:image/jpeg;base64,AAAA' }], views: [{ name: 'mobile', textLength: 200, width: 390 }], limitations: ['Static fixture'], commerceEvidence: true, network: { blocked: 0 }, platform: null };
const diagnosis = { summary: 'Fixture only', uncertainty: 'Manual review', findings: [{ observation: 'Fixture observation', recommendation: 'Check manually', severity: 'high', confidence: 'high', screenshot: 'mobile', box: { x: 0, y: 0, width: 0.5, height: 0.5 } }] };
test('AI is opt-in and uses bounded image input, strict schema, no tools or persistence', async () => {
  let called = 0;
  assert.equal((await visualDiagnosis(evidence, {}, () => called++)).status, 'disabled'); assert.equal(called, 0);
  const result = await visualDiagnosis(evidence, { RADAR_AI_ENABLED: 'true', OPENAI_API_KEY: 'test-secret', RADAR_AI_MODEL: 'fixture-model' }, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); const body = JSON.parse(options.body);
    assert.equal(body.store, false); assert.equal(body.tools, undefined); assert.equal(body.max_output_tokens, 2000); assert.equal(body.text.format.strict, true);
    assert.equal(body.input[0].content.filter(p => p.type === 'input_image').length, 2);
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(diagnosis) }] }] });
  });
  assert.equal(result.findings.length, 1);
  assert.throws(() => validateDiagnosis({ ...diagnosis, findings: [{ ...diagnosis.findings[0], box: { x: 1, y: 0, width: 1, height: 1 } }] }));
  assert.throws(() => validateDiagnosis({ ...diagnosis, findings: [{ ...diagnosis.findings[0], screenshot: 'invented' }] }));
});
test('refusals and incomplete model responses are not diagnoses', async () => {
  for (const response of [{ status: 'incomplete' }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }]) await assert.rejects(visualDiagnosis(evidence, { RADAR_AI_ENABLED: 'true', OPENAI_API_KEY: 'fixture', RADAR_AI_MODEL: 'fixture' }, async () => Response.json(response)));
});
test('ranking refuses incomplete, non-commerce, excluded and blocked captures', () => {
  assert.equal(ranking(evidence, { ...diagnosis, status: 'completed' }).score, 3);
  for (const patch of [{ platform: 'nuvemshop' }, { commerceEvidence: false }, { network: { blocked: 1 } }, { views: [{ textLength: 0 }] }]) assert.equal(ranking({ ...evidence, ...patch }, { ...diagnosis, status: 'completed' }).score, null);
});
test('worker preserves evidence on AI failure and skips AI for excluded platforms', async () => {
  const job = { url: 'https://store.com', reserveCents: 100, createdAt: new Date().toISOString() }, env = { RADAR_AUDIT_RESERVE_CENTS: '100' };
  const result = await processJob(job, { env, captureSite: async () => evidence, diagnose: async () => { throw new Error('secret'); } });
  assert.equal(result.visual.status, 'failed'); assert.equal(result.evidence, evidence); assert.equal(result.priority.score, null);
  let calls = 0;
  const excluded = await processJob(job, { env, captureSite: async () => ({ ...evidence, platform: 'nuvemshop' }), diagnose: async () => { calls++; } });
  assert.equal(calls, 0); assert.equal(excluded.visual.status, 'skipped');
  await assert.rejects(processJob({ ...job, reserveCents: 1 }, { env }));
});
