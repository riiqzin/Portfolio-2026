import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { authorized, boundedText, configured, json, readTicket, redisClient } from '../lib/radar-control.js';
import { publicUrl } from './radar.js';
import { evaluateOpportunity } from '../lib/opportunity-score.js';

const LIMITED='ricky:contact:v1:day:';
const blocked=/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i;
function publicIp(address) {
  if(isIP(address)===4){
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===192&&b===0&&c===0||a===192&&b===0&&c===2||a===198&&b===51&&c===100||a===203&&b===0&&c===113||a===198&&b>=18&&b<=19);
  }
  if(isIP(address)===6){
    const lower=address.toLowerCase();
    return !(lower==='::'||lower==='::1'||lower.startsWith('fe')||lower.startsWith('fc')||lower.startsWith('fd')||lower.startsWith('2001:db8:')||lower.startsWith('::ffff:'));
  }
  return false;
}
async function externalHost(host) {
  if(!host||blocked.test(host)||isIP(host)||!host.includes('.')) return false;
  try {const addresses=await lookup(host,{all:true});return addresses.length>0&&addresses.every(a=>publicIp(a.address))}
  catch{return false}
}
function safeUrl(url,host) {
  try{const u=new URL(url);return u.protocol==='https:'&&(u.hostname===host||u.hostname==='www.'+host)&&!u.username&&!u.password&&!u.port}catch{return false}
}
function decodeEntities(html) {
  const cp=n=>{const value=Number(n);return Number.isInteger(value)&&value>0&&value<=0x10ffff?String.fromCodePoint(value):''};
  return html.replace(/&#x([0-9a-f]+);/gi,(_,n)=>cp(parseInt(n,16)))
    .replace(/&#(\d+);/g,(_,n)=>cp(n))
    .replace(/&commat;/gi,'@').replace(/&period;/gi,'.').replace(/&amp;/gi,'&');
}
const emailRe=/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const disposable=/(example\.com|example\.org|email\.com|wixpress\.com|shopify\.com|sentry\.io|domain\.com)$/i;
function extractEmails(html,domain){
 const source=decodeEntities(html||'');
 const found=new Set();
 const add=(value)=>{
   const email=String(value||'').replace(/^mailto:/i,'').split('?')[0].trim().toLowerCase();
   if(email.length>120||!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email))return;
   if(/\.(png|jpg|jpeg|gif|webp|svg|js|css)$/i.test(email)||disposable.test(email.split('@')[1])||/^(no.?reply|donotreply|bounce|abuse|postmaster|webmaster|suporte\.tecnico)@/.test(email))return;
   found.add(email);
 };
 for(const match of source.matchAll(/href\s*=\s*["']\s*mailto:([^"'\s>]+)/gi)) add(match[1]);
 for(const match of source.matchAll(emailRe))add(match[0]);
 return [...found].sort((a,b)=>rank(b,domain)-rank(a,domain)).slice(0,8);
}
function rank(email,domain){
 const [local,host]=email.split('@');
 return (host===domain||host.endsWith('.'+domain)?35:0)+(/^(contato|comercial|vendas|atendimento|hello|oi|info|sales|contact|marketing|parcerias)$/i.test(local)?50:0)+(/^(sac|suporte|support)$/i.test(local)?10:0);
}
function platform(html){
 const text=html.toLowerCase().slice(0,250000);
 if(/nuvemshop|tiendanube|lojavirtualnuvem|cdn\.nuvemshop/i.test(text))return 'Nuvemshop (indício técnico)';
 if(/cdn\.shopify\.com|shopify\.theme|myshopify\.com/i.test(text))return 'Shopify (indício técnico)';
 if(/woocommerce|wp-content\/plugins\/woocommerce/i.test(text))return 'WooCommerce (indício técnico)';
 if(/wix\.com|wixstatic\.com/i.test(text))return 'Wix (indício técnico)';
 if(/tray\.com\.br|traycdn|tray-commerce/i.test(text))return 'Tray (indício técnico)';
 return 'Não identificada';
}
function contactLinks(html,origin,host) {
 const collected=[];
 for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)){
   const href=decodeEntities(m[1]);let u;
   try{u=new URL(href,origin)}catch{continue}
   if(!safeUrl(u.href,host)||!/(contato|contact|fale.conosco|atendimento|sobre|about)/i.test(u.pathname))continue;
   if(!collected.includes(u.pathname))collected.push(u.pathname);
   if(collected.length===2)break;
 }
 return collected;
}
async function fetchPage(url,host,fetcher=fetch,depth=0){
 if(!safeUrl(url,host))return null;
 const target=new URL(url);
 if(!await externalHost(target.hostname))return null;
 const response=await fetcher(url,{redirect:'manual',headers:{Accept:'text/html,application/xhtml+xml;q=0.9','User-Agent':'RickyCRM-ContactDiscovery/1.0 (public business contact only)'},signal:AbortSignal.timeout(7500)});
 if([301,302,303,307,308].includes(response.status)&&depth<2){
   const location=response.headers.get('location');if(!location)return null;
   const next=new URL(location,url).href;
   if(!safeUrl(next,host))return null;
   return fetchPage(next,host,fetcher,depth+1);
 }
 if(!response.ok||!String(response.headers.get('content-type')||'').toLowerCase().includes('text/html'))return null;
 // Large e-commerce pages are common: collect a bounded prefix rather than rejecting them.
 if(Number(response.headers.get('content-length'))>5000000)return null;
 if(!response.body)return null;
 const reader=response.body.getReader();const chunks=[];let bytes=0;
 try {
   while(true){
     const {value,done}=await reader.read();if(done)break;
     bytes+=value.byteLength;
     if(bytes>900000){await reader.cancel();break}
     chunks.push(Buffer.from(value));
   }
 } finally{reader.releaseLock()}
 return Buffer.concat(chunks).toString('utf8');
}
export async function inspectContact(site,fetcher=fetch) {
 const target=publicUrl(site);
 if(!target)return {status:'invalid',emails:[],score:0};
 const host=target.domain;
 const base='https://'+host;
 let html;
 try{html=await fetchPage(base+'/',host,fetcher)}catch{}
 if(!html){try{html=await fetchPage('https://www.'+host+'/',host,fetcher)}catch{}}
 if(!html)return {status:'unavailable',emails:[],score:null,opportunity:evaluateOpportunity({domain:host}),reason:'Acesso automatizado bloqueado ou site indisponível. Você pode informar o e-mail manualmente.'};
 const result={status:'scanned',domain:host,emails:[],platform:platform(html),pagesChecked:[base+'/'],signals:[]};
 const emailSet=new Set(extractEmails(html,host));
 const paths=[...new Set([...contactLinks(html,base,host),'/atendimento','/contato','/fale-conosco','/contact','/faq'])].slice(0,4);
 const pageResults=await Promise.allSettled(paths.map(async path=>({path,html:await fetchPage(base+path,host,fetcher)})));
 const pages=[];
 for(const outcome of pageResults){
   const record=outcome.status==='fulfilled'&&outcome.value;
   if(record?.html){pages.push(record.html);result.pagesChecked.push(base+record.path);for(const email of extractEmails(record.html,host))emailSet.add(email)}
 }
 result.emails=[...emailSet].sort((a,b)=>rank(b,host)-rank(a,host)).slice(0,6);
 const own=result.emails.some(email=>email.split('@')[1]===host);
 const platformBlocked=/Nuvemshop/i.test(result.platform);
 result.signals.push('Site acessível');
 if(result.emails.length)result.signals.push('Contato público encontrado');
 if(own)result.signals.push('E-mail do domínio');
 if(platformBlocked)result.signals.push('Plataforma a evitar: Nuvemshop');
 result.opportunity=evaluateOpportunity({domain:host,html,pages,emails:result.emails,platform:result.platform});
 result.score=result.opportunity.score;
 result.priority=platformBlocked?'Evitar':result.opportunity.score===null?'Não avaliado':result.opportunity.technical?.length&&result.opportunity.score>=65?'Alta oportunidade':result.opportunity.technical?.length?'Melhoria técnica confirmada':'Sem melhoria técnica confirmada';
 result.checkedAt=new Date().toISOString();
 return result;
}

export function createHandler({env=process.env,fetcher=fetch,inspector=inspectContact}={}){
 return async request=>{
  if(request.method!=='POST')return json({message:'Método não permitido.'},405);
  if(!authorized(request,env))return json({message:'Acesso não autorizado.'},401);
  if(!configured(env))return json({message:'Radar indisponível.'},503);
  let body;
  try{body=JSON.parse(await boundedText(request,6000))}catch{return json({message:'Dados inválidos.'},400)}
  const original=readTicket(body?.ticket,env);
  const site=original&&publicUrl(original);
  if(!site||!body?.domain||body.domain!==site.domain)return json({message:'Resultado sem comprovante de busca válido. Refaça a busca no Radar.'},400);
  const redis=redisClient(env,fetcher);
  const cacheKey='ricky:contact:v2:site:'+createHash('sha256').update(site.domain).digest('hex');
  try {
   const cached=!body.refresh?await redis(['GET',cacheKey]):null;if(cached)return json({...JSON.parse(cached),cached:true});
   const date=new Date().toISOString().slice(0,10),count=await redis(['INCR',LIMITED+date]);
   if(count===1)await redis(['EXPIRE',LIMITED+date,172800]);
   if(count>100)return json({message:'Limite de 100 verificações diárias atingido. Evitamos consultas excessivas a lojas.'},429);
   const result=await inspector(site.url,fetcher);
   const data={...result,source:'Páginas públicas da própria loja'};
   await redis(['SET',cacheKey,JSON.stringify(data),'EX',data.status==='scanned'&&data.emails?.length?172800:3600]);
   return json(data);
  }catch{return json({message:'Não foi possível consultar este domínio agora.'},503)}
 };
}
export default {fetch:createHandler()};
