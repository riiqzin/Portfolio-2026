import { safeGet, safeUrl, crawlPolicy, AGENT } from './safe-network.mjs';

export async function capture(url, browser, { get = safeGet, policy = crawlPolicy, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const target = safeUrl(url), rules = await policy(target.href, get);
  if (!rules.allows(target.href)) throw new Error('robots_disallowed');
  const context = await browser.newContext({ javaScriptEnabled: true, serviceWorkers: 'block', acceptDownloads: false, userAgent: AGENT, reducedMotion: 'reduce', permissions: [] });
  // Browser navigation is always intercepted and fulfilled through safeGet;
  // never let a page make unrestricted browser-side network connections.
  if (typeof context.routeWebSocket === 'function') await context.routeWebSocket('**/*', socket => socket.close());
  const cache = new Map(), policies = new Map([[target.origin, Promise.resolve(rules)]]), chains = new Map();
  let count = 0, blocked = 0, blockedVisual = 0, bytes = 0, mainHtml = '', mainStatus = 0, mainFailure = '';
  const deadline = Date.now() + 110000;
  const timer = setTimeout(() => context.close().catch(() => {}), 110000);
  try {
    await context.route('**/*', async route => {
      const req = route.request();
      try {
        const u = safeUrl(req.url());
        const type = req.resourceType();
        const isDocument = type === 'document';
        const isVisual = ['document', 'stylesheet', 'image', 'font', 'script'].includes(type);
        const isData = ['xhr', 'fetch'].includes(type) && u.origin === target.origin;
        if (Date.now() > deadline || req.method() !== 'GET' || (!isVisual && !isData) || (isDocument && u.href !== target.href)) throw new Error('blocked_resource');
        if (!policies.has(u.origin)) {
          if (policies.size >= 12) throw new Error('blocked_resource');
          policies.set(u.origin, crawlPolicy(u.href, get));
        }
        const rule = await policies.get(u.origin);
        if (!rule.allows(u.href)) throw new Error('robots_disallowed');
        let response = cache.get(u.href);
        if (!response) {
          if (++count > 100 || bytes >= 24000000) throw new Error('request_limit');
          // Pace requests per origin, including third-party CDNs; never follow redirects.
          const chain = chains.get(u.origin) || Promise.resolve();
          const task = chain.then(async () => { if (Date.now() > deadline || bytes >= 24000000) throw new Error('capture_timeout'); await wait(rule.delay); return get(u.href, { maxBytes: Math.min(2000000, 24000000 - bytes) }); });
          chains.set(u.origin, task.catch(() => {})); response = await task;
          bytes += response.body.length;
          if (bytes > 24000000) throw new Error('byte_limit');
          if (response.status >= 300 && response.status < 400) throw new Error('redirect_blocked');
          if (response.status !== 200) throw new Error('site_http_error');
          if (isDocument) {
            if (!String(response.headers['content-type']).includes('text/html')) throw new Error('not_html');
            mainHtml = response.body.toString('utf8'); mainStatus = response.status;
          }
          cache.set(u.href, response);
        }
        await route.fulfill({ status: response.status, body: response.body, headers: { 'content-type': String(response.headers['content-type'] || 'application/octet-stream'), 'access-control-allow-origin': '*', 'content-security-policy': "default-src 'none'; script-src 'self' https: 'unsafe-inline' 'unsafe-eval'; style-src 'self' https: 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' https: data:; connect-src 'self'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" } });
      } catch (error) {
        // Keep a bounded, non-sensitive code for the top-level document failure.
        // Playwright otherwise reports only net::ERR_FAILED after the route abort.
        if (req.resourceType() === 'document' && !mainFailure) {
          const allowed = new Set(['blocked_resource', 'request_limit', 'capture_timeout', 'byte_limit', 'redirect_blocked', 'site_http_error', 'not_html', 'unsafe_url', 'unsafe_dns', 'dns_timeout', 'network_timeout', 'response_too_large', 'encoded_response']);
          mainFailure = allowed.has(error?.message) ? error.message : 'document_fetch_failed';
        }
        if (['document', 'stylesheet', 'image', 'font', 'script'].includes(req.resourceType())) blockedVisual++;
        blocked++; await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    const screenshots = [], views = [];
    for (const [name, width, height] of [['desktop', 1365, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      try { await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 65000 }); }
      catch (error) { if (mainFailure) throw new Error(mainFailure); throw error; }
      if (!mainStatus) throw new Error(mainFailure || 'capture_failed');
      // Give client-side rendering a short, bounded window; no networkidle requirement.
      await wait(3000);
      const checks = await page.evaluate(() => ({
        title: document.title.slice(0, 200), viewport: !!document.querySelector('meta[name="viewport"]'),
        overflow: document.documentElement.scrollWidth > innerWidth + 4,
        h1Count: document.querySelectorAll('h1').length,
        images: document.images.length, missingAlt: [...document.images].filter(i => !i.hasAttribute('alt')).length,
        unavailableResources: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).length + [...document.querySelectorAll('link[rel="stylesheet"]')].filter(link => !link.sheet).length,
        textLength: (document.body?.innerText || '').trim().length
      }));
      views.push({ name, width, height, ...checks });
      const buffer = await page.screenshot({ type: 'jpeg', quality: 55, fullPage: false, timeout: 8000 });
      if (buffer.length > 250000) throw new Error('screenshot_too_large');
      screenshots.push({ id: name, width, height, data: `data:image/jpeg;base64,${buffer.toString('base64')}` });
    }
    const platform = /nuvemshop|tiendanube|lojavirtualnuvem|myshopify|cdn\.shopify|wixstatic|lojaintegrada|vtexassets|woocommerce|traycdn/i.exec(mainHtml)?.[0] || null;
    const commerce = /adicionar.{0,30}carrinho|comprar|add.to.cart|"@type"\s*:\s*"Product"/i.test(mainHtml);
    return { url: target.href, capturedAt: new Date().toISOString(), statusCode: mainStatus, screenshots, views, platform, commerceEvidence: commerce, network: { requests: count, blocked, blockedVisual, bytes }, limitations: ['Captura renderizada com JavaScript em navegador isolado; scripts, APIs e recursos de terceiros podem estar incompletos por segurança.', 'Somente a primeira tela da página informada. Checkout, conversão e vendas não foram medidos.', ...(blockedVisual ? ['Recursos visuais bloqueados ou indisponíveis: não atribuir falhas de renderização ao site sem revisão humana.'] : [])] };
  } finally { clearTimeout(timer); await context.close().catch(() => {}); }
}
