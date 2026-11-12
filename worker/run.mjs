import { chromium } from 'playwright';
import { redisClient, spendingConfigured, integer } from '../lib/radar-control.mjs';
import { capture } from './capture.mjs';
import { visualDiagnosis, technicalFindings, ranking } from './diagnose.mjs';

export const CLAIM = `
local ids = redis.call('ZRANGE', KEYS[1], 0, 0)
if #ids == 0 then return nil end
redis.call('ZREM', KEYS[1], ids[1])
local key = 'radar:v2:job:' .. ids[1]
local raw = redis.call('GET', key)
if not raw then return nil end
local job = cjson.decode(raw)
if job.status ~= 'queued' then return nil end
job.status = 'running'; job.startedAt = ARGV[1]
redis.call('SET', key, cjson.encode(job), 'EX', 86400)
return cjson.encode(job)`;

export async function processJob(job, { browser, env, captureSite = capture, diagnose = visualDiagnosis }) {
  if (!Number.isSafeInteger(job.reserveCents) || job.reserveCents < Number(env.RADAR_AUDIT_RESERVE_CENTS)) throw new Error('reservation_mismatch');
  if (Date.now() - Date.parse(job.createdAt) > 300000) throw new Error('queue_expired');
  const evidence = await captureSite(job.url, browser);
  let visual;
  if (evidence.platform || !evidence.commerceEvidence) visual = { status: 'skipped', message: 'IA não chamada: plataforma excluída ou loja não confirmada.' };
  else {
    try { visual = await diagnose(evidence, env); }
    catch { visual = { status: 'failed', message: 'IA não concluiu um diagnóstico válido. Sem repetição automática; reserva mantida.' }; }
  }
  return { ...job, status: 'completed', completedAt: new Date().toISOString(), evidence, technical: technicalFindings(evidence), visual, priority: ranking(evidence, visual), pagespeed: { status: 'not_run', message: 'PageSpeed não consultado nesta versão; nenhuma nota de desempenho inferida.' } };
}

async function main() {
  const env = process.env;
  if (env.RADAR_AUDIT_ENABLED !== 'true' || !spendingConfigured(env) || !integer(env.RADAR_AUDIT_DAILY_LIMIT) || Number(env.RADAR_AUDIT_DAILY_LIMIT) > 30 || env.RADAR_CRAWL_TERMS_ACCEPTED !== 'true' || (env.RADAR_AI_ENABLED === 'true' && (!env.OPENAI_API_KEY || !env.RADAR_AI_MODEL))) throw new Error('setup_required');
  const redis = redisClient(env);
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(env.RADAR_BROWSER_CHANNEL ? { channel: env.RADAR_BROWSER_CHANNEL } : {}) });
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
  const heartbeat = () => redis(['SET', 'radar:v2:worker', 'online', 'EX', 45]);
  let beat;
  try {
    await heartbeat();
    beat = setInterval(() => heartbeat().catch(() => { stopping = true; }), 15000);
    console.log('Executor conectado. Sessão limitada a 30 minutos; Ctrl+C encerra após a auditoria atual.');
    const end = Date.now() + 30 * 60000;
    while (!stopping && Date.now() < end) {
      const raw = await redis(['EVAL', CLAIM, 1, 'radar:v2:queue', new Date().toISOString(), Date.now()]);
      if (!raw) { await new Promise(r => setTimeout(r, 10000)); continue; }
      const job = JSON.parse(raw); let result;
      try { result = await processJob(job, { browser, env }); }
      catch (error) {
        // Only publish allowlisted diagnostics: never expose arbitrary network errors,
        // site content, environment variables, or private credentials to CRM clients.
        const known = new Set(['reservation_mismatch', 'queue_expired', 'robots_disallowed', 'robots_unavailable', 'robots_crawl_delay', 'unsafe_url', 'unsafe_dns', 'dns_timeout', 'network_timeout', 'response_too_large', 'encoded_response', 'blocked_resource', 'request_limit', 'capture_timeout', 'byte_limit', 'redirect_blocked', 'site_http_error', 'not_html', 'document_fetch_failed', 'capture_failed', 'screenshot_too_large']);
        const raw = error instanceof Error ? error.message : '';
        const code = known.has(raw) ? raw : error?.name === 'TimeoutError' ? 'playwright_timeout' : 'playwright_navigation_failed';
        result = { ...job, status: 'failed', errorCode: code, message: 'Auditoria não concluída (' + code + '). Sem repetição automática. Informe este código para diagnóstico.', completedAt: new Date().toISOString() };
        console.error('Auditoria falhou. Código:', code);
      }
      await redis(['SET', `radar:v2:job:${job.id}`, JSON.stringify(result), 'EX', 86400]);
      console.log(`Auditoria ${result.status}.`);
    }
  } finally { clearInterval(beat); await browser.close(); }
}
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Executor interrompido. Confira configuração, conexão e guia. Segredos não foram registrados.'); process.exitCode = 1; });
