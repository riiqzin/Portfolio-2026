import https from 'node:https';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import robotsParser from 'robots-parser';

export const AGENT = 'RickyRadar/1.0';
export function safeUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !u.hostname.includes('.') || ipaddr.isValid(u.hostname.replace(/[\[\]]/g, '')) || /\.(local|localhost|internal|test|invalid|onion)$/i.test(u.hostname) || u.href.length > 2048) throw new Error('unsafe_url');
  u.hash = ''; return u;
}
export function publicAddress(address) {
  try { const ip = ipaddr.parse(address); return ip.kind() === 'ipv4' && ip.range() === 'unicast'; } catch { return false; }
}
// Every socket uses the validated address directly through lookup, while preserving
// hostname/SNI/certificate checks. The browser itself never connects to the site.
export async function safeGet(value, { resolve = lookup, transport = https.request, maxBytes = 2000000 } = {}) {
  const u = safeUrl(value);
  let dnsTimer;
  const addresses = await Promise.race([
    resolve(u.hostname, { all: true, family: 4 }),
    new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new Error('dns_timeout')), 5000); })
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('unsafe_dns');
  const address = addresses[0].address;
  return new Promise((resolveResult, reject) => {
    const request = transport(u, { method: 'GET', agent: false, lookup: (_host, options, cb) => options?.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4), headers: { 'User-Agent': AGENT, Accept: '*/*', 'Accept-Encoding': 'identity' } }, response => {
      let size = 0; const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); request.destroy(new Error('response_too_large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { reject(new Error('encoded_response')); return; }
        resolveResult({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) });
      });
    });
    const timeout = setTimeout(() => request.destroy(new Error('network_timeout')), 8000);
    request.on('close', () => clearTimeout(timeout));
    request.on('error', reject); request.end();
  });
}
export async function crawlPolicy(url, get = safeGet) {
  const u = safeUrl(url), robotsUrl = `${u.origin}/robots.txt`;
  const r = await get(robotsUrl, { maxBytes: 256000 });
  // RFC 9309 §2.3.1.3: 4xx means robots.txt is unavailable; crawlers MAY access resources.
  // Network failures and 5xx remain fail-closed. Keep pacing and safeGet checks.
  if (r.status >= 400 && r.status <= 499) return { allows: () => true, delay: 1000 };
  if (r.status !== 200) throw new Error('robots_unavailable');
  const robots = robotsParser(robotsUrl, r.body.toString('utf8'));
  const delay = Math.max(1000, Number(robots.getCrawlDelay(AGENT) || 0) * 1000);
  if (delay > 5000) throw new Error('robots_crawl_delay');
  return { allows: value => robots.isAllowed(value, AGENT) !== false, delay };
}
