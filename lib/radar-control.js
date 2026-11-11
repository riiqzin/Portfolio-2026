import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const integer = value => /^\d+$/.test(String(value || '')) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
export const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function boundedText(request, maxBytes) {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new Error('body_too_large');
  if (!request.body) return '';
  const reader = request.body.getReader(); let size = 0; const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('body_too_large'); }
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts).toString('utf8');
  } finally { reader.releaseLock(); }
}
export function authorized(request, env) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return false;
  const key = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  const hash = s => createHash('sha256').update(s).digest();
  return !!env.RADAR_DASHBOARD_KEY && key.length > 0 && key.length <= 1024 && timingSafeEqual(hash(key), hash(env.RADAR_DASHBOARD_KEY));
}
export function configured(env) {
  return /^https:\/\/[\w-]+\.upstash\.io\/?$/.test(env.UPSTASH_REDIS_REST_URL || '') && !!env.UPSTASH_REDIS_REST_TOKEN;
}
export function spendingConfigured(env) {
  return integer(env.RADAR_BUDGET_CENTS) && Number(env.RADAR_BUDGET_CENTS) <= 8000 && integer(env.RADAR_SEARCH_RESERVE_CENTS) && integer(env.RADAR_AUDIT_RESERVE_CENTS);
}
export function redisClient(env, fetcher = fetch) {
  if (!configured(env)) throw new Error('redis_setup');
  return async command => {
    const r = await fetcher(env.UPSTASH_REDIS_REST_URL, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    if (!r.ok) throw new Error('redis_unavailable');
    const data = await r.json();
    if (data.error || !Object.hasOwn(data, 'result')) throw new Error('redis_unavailable');
    return data.result;
  };
}
// Non-expiring, shared SEARCH + AUDIT allowance. Reservations are never refunded:
// an interrupted provider request may already have been billed. Never delete this key.
export const SPEND_KEY = 'radar:v2:reserved-cents';
export const SPEND = `local spent = tonumber(redis.call('GET', KEYS[1]) or '0')
if spent + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return {0, spent} end
return {1, redis.call('INCRBY', KEYS[1], ARGV[1])}`;
export async function reserveSpend(env, redis, kind) {
  if (!spendingConfigured(env)) throw new Error('spend_setup');
  const result = await redis(['EVAL', SPEND, 1, SPEND_KEY, Number(env[kind === 'search' ? 'RADAR_SEARCH_RESERVE_CENTS' : 'RADAR_AUDIT_RESERVE_CENTS']), Number(env.RADAR_BUDGET_CENTS)]);
  if (!Array.isArray(result) || result.length !== 2 || !result.every(Number.isSafeInteger) || ![0, 1].includes(result[0])) throw new Error('budget_unavailable');
  return { allowed: result[0] === 1, reservedCents: result[1], limitCents: Number(env.RADAR_BUDGET_CENTS) };
}
export function ticket(url, env, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ url, expires: now + 3600000 })).toString('base64url');
  return `${payload}.${createHmac('sha256', env.RADAR_DASHBOARD_KEY).update(payload).digest('base64url')}`;
}
export function readTicket(value, env, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', env.RADAR_DASHBOARD_KEY).update(payload).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url')); return Number.isFinite(data.expires) && data.expires > now && typeof data.url === 'string' ? data.url : null; } catch { return null; }
}
