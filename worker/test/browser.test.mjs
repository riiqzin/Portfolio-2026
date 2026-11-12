import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { capture } from '../capture.mjs';

test('real browser captures desktop/mobile with mocked network; private resources never fetched; public third-party assets may be retrieved', async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.CRM_BROWSER_CHANNEL || 'msedge' });
  const fetched = [];
  try {
    const result = await capture('https://shop.example.com/', browser, { wait: async () => {}, policy: async () => ({ allows: () => true, delay: 0 }), get: async url => {
      fetched.push(url);
      return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<!doctype html><title>Fixture Loja</title><meta name="viewport" content="width=device-width"><style>body{background:#202820;color:white}h1{width:900px}</style><h1>Fixture: comprar produtos</h1><p>Esta loja é uma fixture local para testar capturas; nenhum resultado é de uma empresa real.</p><img src="http://127.0.0.1/private"><img src="https://third.example.com/a.png"><script>fetch("https://shop.example.com/track")</script>') };
    } });
    assert.ok(fetched.includes('https://shop.example.com/'));
    assert.ok(fetched.includes('https://third.example.com/robots.txt'));
    assert.ok(fetched.includes('https://third.example.com/a.png'));
    assert.ok(!fetched.some(url => url.includes('127.0.0.1')));
    assert.ok(fetched.every(url => url.startsWith('https://')));
    assert.equal(result.screenshots.length, 2); assert.ok(result.screenshots.every(s => s.data.startsWith('data:image/jpeg;base64,')));
    assert.equal(result.views[1].overflow, true); assert.equal(result.commerceEvidence, true); assert.equal(result.views[1].unavailableResources, 2);
  } finally { await browser.close(); }
});
