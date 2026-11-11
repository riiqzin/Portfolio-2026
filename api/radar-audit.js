import { createHash, randomUUID } from 'node:crypto';
import { authorized, boundedText, configured, integer, json, readTicket, redisClient, spendingConfigured, SPEND_KEY } from '../lib/radar-control.js';
import { publicUrl } from './radar.js';

export const ENQUEUE = `
local duplicate = redis.call('GET', KEYS[1])
if duplicate then return {2, duplicate} end
if redis.call('EXISTS', KEYS[6]) == 0 then return {-2, ''} end
local used = tonumber(redis.call('GET', KEYS[2]) or '0')
local spent = tonumber(redis.call('GET', KEYS[3]) or '0')
if used >= tonumber(ARGV[3]) or spent + tonumber(ARGV[4]) > tonumber(ARGV[5]) then return {0, ''} end
redis.call('INCR', KEYS[2]); redis.call('EXPIRE', KEYS[2], 172800)
redis.call('INCRBY', KEYS[3], ARGV[4])
redis.call('SET', KEYS[1], ARGV[1], 'EX', 86400)
redis.call('SET', KEYS[4], ARGV[2], 'EX', 86400)
redis.call('ZADD', KEYS[5], ARGV[6], ARGV[1]); redis.call('EXPIRE', KEYS[5], 86400)
return {1, ARGV[1]}`;

export function createAuditHandler({ env = process.env, fetcher = fetch, now = () => new Date() } = {}) {
  return async request => {
    if (!['GET', 'POST'].includes(request.method)) return json({ message: 'Método não permitido.' }, 405);
    if (!authorized(request, env)) return json({ message: 'Entre no CRM com a chave do painel.' }, 401);
    if (!configured(env) || !spendingConfigured(env) || !integer(env.RADAR_AUDIT_DAILY_LIMIT) || Number(env.RADAR_AUDIT_DAILY_LIMIT) > 30 || env.RADAR_AUDIT_ENABLED !== 'true') return json({ message: 'Auditoria desativada. Configure o orçamento e o executor Windows seguindo o guia.' }, 503);
    const redis = redisClient(env, fetcher);
    try {
      if (request.method === 'GET') {
        const id = new URL(request.url).searchParams.get('id');
        if (!id) {
          const values = await redis(['MGET', 'radar:v2:worker', SPEND_KEY]);
          if (!Array.isArray(values) || values.length !== 2) throw new Error();
          return json({ workerOnline: !!values[0], reservedCents: Number(values[1] || 0), budgetCents: Number(env.RADAR_BUDGET_CENTS), auditReserveCents: Number(env.RADAR_AUDIT_RESERVE_CENTS), dailyLimit: Number(env.RADAR_AUDIT_DAILY_LIMIT) });
        }
        if (!/^[a-f0-9-]{36}$/.test(id)) return json({ message: 'Auditoria inválida.' }, 400);
        const raw = await redis(['GET', `radar:v2:job:${id}`]);
        if (!raw) return json({ message: 'Auditoria expirada ou não encontrada (retenção: 24 horas).' }, 404);
        const job = JSON.parse(raw);
        if (['queued', 'running'].includes(job.status) && now().getTime() - Date.parse(job.startedAt || job.createdAt) > 300000) {
          job.status = 'interrupted'; job.message = 'Executor interrompido ou fila expirada. Sem repetição automática; reserva mantida.';
        }
        return json(job);
      }
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ message: 'Requisição inválida.' }, 400);
      let raw; try { raw = await boundedText(request, 4500); } catch { return json({ message: 'Requisição muito grande ou inválida.' }, 413); }
      if (raw.length > 4500) return json({ message: 'Requisição muito grande.' }, 413);
      let body; try { body = JSON.parse(raw); } catch { return json({ message: 'Requisição inválida.' }, 400); }
      const url = readTicket(body?.ticket, env, now().getTime());
      const site = url && publicUrl(url);
      if (!site || !url.startsWith('https://')) return json({ message: 'Atualize a busca: candidato inválido, sem HTTPS ou autorização expirada.' }, 400);
      const id = randomUUID(), date = now().toISOString();
      const job = { id, url, domain: site.domain, status: 'queued', createdAt: date, reserveCents: Number(env.RADAR_AUDIT_RESERVE_CENTS) };
      const dedup = createHash('sha256').update(site.domain).digest('hex');
      const result = await redis(['EVAL', ENQUEUE, 6, `radar:v2:dedup:${dedup}`, `radar:v2:audits:${date.slice(0, 10)}`, SPEND_KEY, `radar:v2:job:${id}`, 'radar:v2:queue', 'radar:v2:worker', id, JSON.stringify(job), Number(env.RADAR_AUDIT_DAILY_LIMIT), job.reserveCents, Number(env.RADAR_BUDGET_CENTS), now().getTime()]);
      if (!Array.isArray(result) || result.length !== 2) throw new Error();
      if (result[0] === -2) return json({ message: 'Executor Windows desconectado. Inicie o executor antes de auditar.' }, 503);
      if (result[0] === 0) return json({ message: 'Limite diário de auditorias ou orçamento total atingido.' }, 429);
      if (![1, 2].includes(result[0]) || typeof result[1] !== 'string') throw new Error();
      return json({ id: result[1], reused: result[0] === 2 }, 202);
    } catch { return json({ message: 'Não foi possível confirmar a fila. Consulte o estado antes de tentar novamente; uma reserva pode ter sido registrada.' }, 503); }
  };
}
export default { fetch: createAuditHandler() };
