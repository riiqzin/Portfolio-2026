import { createHash, timingSafeEqual } from 'node:crypto';

const PLATFORMS = /\b(nuvemshop|lojavirtualnuvem|tiendanube|shopify|myshopify|wixsite|wix|lojaintegrada|loja integrada|tray commerce|vtex|woocommerce|squarespace|bigcommerce)\b/i;
const DIRECTORIES = ['instagram.com', 'facebook.com', 'linkedin.com', 'youtube.com', 'google.com', 'google.com.br', 'mercadolivre.com.br', 'shopee.com.br', 'yelp.com', 'tripadvisor.com.br', 'econodata.com.br', 'solutudo.com.br'];
const text = (value, max = 600) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim().slice(0, max) : '';
const digest = value => createHash('sha256').update(value).digest();
const positive = value => /^\d+$/.test(value || '') && Number(value) > 0 && Number.isSafeInteger(Number(value));
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (code, message, status) => json({ error: code, message }, status);

export function publicUrl(value) {
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /\.(local|localhost|internal|test|invalid)$/.test(host)) return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
    return { url: u.href, domain: host };
  } catch { return null; }
}

export function normalizeResults(rows) {
  const seen = new Set(), results = [], removed = { duplicates: 0, platforms: 0, other: 0 };
  for (const row of rows.slice(0, 20)) {
    const site = publicUrl(row?.url);
    if (!site || !text(row.title) || DIRECTORIES.some(h => site.domain === h || site.domain.endsWith('.' + h))) { removed.other++; continue; }
    if (PLATFORMS.test(`${site.domain} ${text(row.title)} ${text(row.description)} ${(Array.isArray(row.extra_snippets) ? row.extra_snippets : []).filter(s => typeof s === 'string').join(' ')}`)) { removed.platforms++; continue; }
    if (seen.has(site.domain)) { removed.duplicates++; continue; }
    seen.add(site.domain);
    results.push({ ...site, name: text(row.title, 160), description: text(row.description), platform: 'Não verificada', source: 'Brave Search' });
  }
  return { results, removed };
}

// One atomic reservation shared by every serverless instance. Failed/timeout searches
// keep their reservation because the provider may already have charged the request.
const RESERVE = `
local day = tonumber(redis.call('GET', KEYS[1]) or '0')
local month = tonumber(redis.call('GET', KEYS[2]) or '0')
if day >= tonumber(ARGV[1]) or month >= tonumber(ARGV[2]) then return {0, day, month} end
if redis.call('EXISTS', KEYS[3]) == 1 then return {-1, day, month} end
redis.call('SET', KEYS[3], '1', 'EX', 5)
redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 172800)
redis.call('INCR', KEYS[2]); redis.call('EXPIRE', KEYS[2], 5356800)
return {1, day + 1, month + 1}`;

export function createHandler({ env = process.env, fetcher = fetch, now = () => new Date() } = {}) {
  return async request => {
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return fail('origin', 'Origem não permitida.', 403);
    if (!env.RADAR_DASHBOARD_KEY) return fail('setup_required', 'Radar aguardando configuração segura no servidor. Consulte o guia de ativação.', 503);
    const key = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
    if (!key || key.length > 1024 || !timingSafeEqual(digest(key), digest(env.RADAR_DASHBOARD_KEY))) return fail('unauthorized', 'A chave do Radar precisa corresponder à chave do painel. Entre novamente ou revise a configuração no servidor.', 401);
    const ready = env.BRAVE_SEARCH_API_KEY && /^https:\/\/[\w-]+\.upstash\.io\/?$/.test(env.UPSTASH_REDIS_REST_URL || '') && env.UPSTASH_REDIS_REST_TOKEN && positive(env.RADAR_DAILY_LIMIT) && positive(env.RADAR_MONTHLY_LIMIT);
    if (!ready) return fail('setup_required', 'Configure Brave Search, o controle de uso e os limites diário e mensal no servidor. Nenhuma busca foi cobrada.', 503);
    const limits = { daily: Number(env.RADAR_DAILY_LIMIT), monthly: Number(env.RADAR_MONTHLY_LIMIT) };
    if (request.method === 'GET') return json({ ready: true, provider: 'Brave Search', limits });
    if (!request.headers.get('content-type')?.startsWith('application/json')) return fail('invalid_request', 'Envie uma busca válida.', 400);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 2048) return fail('invalid_request', 'Busca muito longa.', 400);
      body = JSON.parse(raw);
    } catch { return fail('invalid_request', 'Busca inválida.', 400); }
    const valid = s => typeof s === 'string' && s.trim().length >= 2 && s.length <= 80 && /^[\p{L}\p{N}\s,.'’&()/-]+$/u.test(s);
    if (!valid(body?.niche) || !valid(body?.region)) return fail('invalid_request', 'Informe nicho e região com 2 a 80 caracteres, sem operadores de busca.', 400);
    const query = `${body.niche.trim()} ${body.region.trim()} site oficial -nuvemshop -shopify -wix -lojaintegrada -tiendanube`;
    let usage;
    try {
      const date = now().toISOString();
      const response = await fetcher(env.UPSTASH_REDIS_REST_URL, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(['EVAL', RESERVE, 3, `radar:v1:day:${date.slice(0, 10)}`, `radar:v1:month:${date.slice(0, 7)}`, 'radar:v1:cooldown', limits.daily, limits.monthly]) });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.result) || data.result.length !== 3 || !data.result.every(Number.isInteger)) throw new Error('budget');
      const [allowed, daily, monthly] = data.result;
      if (allowed === 0) return fail('budget_exhausted', 'Limite diário ou mensal atingido. Aguarde a renovação do período (UTC) ou revise o orçamento.', 429);
      if (allowed === -1) return fail('rate_limited', 'Aguarde 5 segundos entre buscas.', 429);
      if (allowed !== 1) throw new Error('budget');
      usage = { daily, monthly, limits };
    } catch { return fail('budget_unavailable', 'Não foi possível verificar o limite de uso. A busca foi bloqueada para proteger o orçamento.', 503); }
    try {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      Object.entries({ q: query, count: '20', country: 'BR', search_lang: 'pt-br', text_decorations: 'false', extra_snippets: 'true' }).forEach(([k, v]) => url.searchParams.set(k, v));
      const response = await fetcher(url, { redirect: 'error', headers: { Accept: 'application/json', 'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) return fail(response.status === 429 ? 'provider_limit' : 'provider_error', response.status === 429 ? 'O provedor atingiu seu limite. Tente mais tarde; não há repetição automática.' : 'O provedor recusou a busca. Verifique a chave e o plano do Brave Search no servidor.', 502);
      const data = await response.json();
      if (data.web?.results !== undefined && !Array.isArray(data.web.results)) throw new Error('invalid_response');
      return json({ ...normalizeResults(data.web?.results || []), query, searchedAt: now().toISOString(), usage });
    } catch { return fail('provider_unavailable', 'A busca não foi concluída. Verifique a conexão e tente novamente. Esta tentativa pode ter consumido uma consulta.', 502); }
  };
}

export default { fetch: createHandler() };
