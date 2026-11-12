import { randomUUID } from 'node:crypto';
import { authorized,boundedText,json,redisClient } from '../lib/radar-control.js';
import { ready,seal,unseal,access,STORE,RESULTS,ADDRESS } from '../lib/gmail.js';
const DB='ricky:outreach:v1:data', DAY='ricky:outreach:v1:day:',LOCK='ricky:outreach:v1:lock:',LIMIT=10;
const DEFAULTS=[
{id:'initial',name:'Primeiro contato · direto',subject:'Uma ideia para a {{empresa}}',body:'Oi! Tudo bem?\n\nEncontrei a {{empresa}} pesquisando lojas de {{segmento}}. Trabalho com criação e reformulação de sites para lojas virtuais e gostaria de conversar sobre uma possível melhoria na apresentação da marca e dos produtos.\n\nFaz sentido conversarmos rapidamente? Obrigado!'},
{id:'visual',name:'Primeiro contato · reformulação',subject:'Reformulação para a {{empresa}}',body:'Olá! Tudo bem?\n\nConheci a {{empresa}} e gostei do segmento de {{segmento}}. Trabalho com modernização de lojas virtuais e gostaria de apresentar algumas ideias para a experiência de compra da marca, sem compromisso.\n\nPodemos conversar?'},
{id:'followup',name:'Retorno · sem resposta',subject:'Retomando meu contato com a {{empresa}}',body:'Oi! Tudo bem?\n\nPassando só para retomar a mensagem anterior sobre uma possível melhoria no site da {{empresa}}.\n\nSe não for prioridade no momento, sem problemas. Obrigado!'}
];
const trim=(s,n)=>String(s||'').trim().slice(0,n);
const validEmail=s=>/^[^\s@,;<>]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)&&s.length<180&&s.toLowerCase()!==ADDRESS;
const initial=()=>({templates:DEFAULTS,queue:[],sent:[],dismissed:[]});
async function load(redis,env){const raw=await redis(['GET',DB]);return raw?unseal(raw,env):initial()}
async function save(redis,env,data){await redis(['SET',DB,seal(data,env)])}
const draftOf=(o)=>{const company=trim(o.company,130),email=trim(o.email,180).toLowerCase(),subject=trim(o.subject,180),text=trim(o.text,5500);if(!company||!validEmail(email)||!subject||!text||/[\r\n]/.test(subject))return null;return {id:randomUUID(),company,email,subject,text,leadId:trim(o.leadId,50),type:o.type==='followup'?'followup':'initial',createdAt:new Date().toISOString()};};
function htmlEscape(value){
 return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function htmlBody(message){
 const pattern=/https?:\/\/[^\s<>"']+/gi;
 let html='',last=0;
 for(const match of message.matchAll(pattern)){
   const start=match.index;
   html+=htmlEscape(message.slice(last,start));
   const raw=match[0],url=raw.replace(/[.,;!?)]+$/,'');
   html+='<a href="'+htmlEscape(url)+'" rel="noopener noreferrer">'+htmlEscape(url)+'</a>'+htmlEscape(raw.slice(url.length));
   last=start+raw.length;
 }
 return '<!doctype html><html><body><div style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.6">'+html+htmlEscape(message.slice(last))+'</div></body></html>';
}
function mime(item){
 const plain=item.text+'\n\nSe preferirem não receber mais contatos, é só avisar.';
 const boundary='ricky_'+randomUUID().replace(/-/g,'');
 const subject='=?UTF-8?B?'+Buffer.from(item.subject,'utf8').toString('base64')+'?=';
 const lines=[
  'From: Ricky CRM <'+ADDRESS+'>',
  'To: <'+item.email+'>',
  'Subject: '+subject,
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="'+boundary+'"',
  '',
  '--'+boundary,
  'Content-Type: text/plain; charset="UTF-8"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from(plain,'utf8').toString('base64'),
  '--'+boundary,
  'Content-Type: text/html; charset="UTF-8"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from(htmlBody(plain),'utf8').toString('base64'),
  '--'+boundary+'--',
  ''
 ];
 return Buffer.from(lines.join('\r\n'),'utf8').toString('base64url');
}
export async function sendGmail(token,item,fetcher=fetch){
 const response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({raw:mime(item)}),signal:AbortSignal.timeout(16000)});
 if(!response.ok)throw Error('send_'+response.status);
 const data=await response.json();if(!data.id)throw Error('send_unconfirmed');return data;
}
export function createHandler({env=process.env,send=sendGmail}={}){
 return async request=>{
  if(!['GET','POST'].includes(request.method))return json({message:'Método não permitido.'},405);
  if(!authorized(request,env))return json({message:'Acesso não autorizado.'},401);
  if(!ready(env))return json({message:'CRM aguardando configuração.'},503);
  const redis=redisClient(env);
  try{
   if(request.method==='GET'){
    const data=await load(redis,env),raw=await redis(['GET',STORE]),stored=raw?unseal(raw,env):null;
    const inboxRaw=await redis(['GET',RESULTS]),inbox=inboxRaw?unseal(inboxRaw,env):[];
    const followups=data.sent.filter(item=>item.type==='initial'&&Date.now()-Date.parse(item.sentAt)>5*86400000&&!data.dismissed.includes(item.id)&&!data.sent.some(x=>x.type==='followup'&&x.email===item.email)&&!inbox.some(x=>x.email===item.email&&Date.parse(x.receivedAt)>Date.parse(item.sentAt))&&!inbox.some(x=>x.email===item.email&&x.label==='Sem interesse'));
    return json({templates:data.templates,queue:data.queue,sent:data.sent.slice(0,150),followups:followups.slice(0,80),connected:stored?.email===ADDRESS,canSend:stored?.email===ADDRESS&&String(stored.scopes||'').includes('gmail.send'),dailyLimit:LIMIT});
   }
   let body;try{body=JSON.parse(await boundedText(request,12000))}catch{return json({message:'Dados inválidos.'},400)}
   const data=await load(redis,env),action=body.action;
   if(action==='send-due')return json({ok:true,...await sendDue({env})});
   if(action==='template-save'){
    const name=trim(body.name,70),subject=trim(body.subject,180),text=trim(body.text,5000);
    if(!name||!subject||!text||/[\r\n]/.test(subject))return json({message:'Preencha modelo, assunto e texto válidos.'},400);
    const id=trim(body.id,55)||randomUUID(),index=data.templates.findIndex(x=>x.id===id);
    if(index<0&&data.templates.length>=25)return json({message:'Limite de 25 modelos.'},429);
    const template={id,name,subject,body:text};
    if(index<0)data.templates.push(template);else data.templates[index]=template;
    await save(redis,env,data);return json({ok:true});
   }
   if(action==='template-delete'){data.templates=data.templates.filter(x=>x.id!==body.id);await save(redis,env,data);return json({ok:true})}
   if(action==='queue-add'){
    const item=draftOf(body);if(!item)return json({message:'Confira empresa, e-mail, assunto e texto.'},400);
    if(data.queue.length>=150)return json({message:'Fila cheia.'},429);
    if(data.queue.some(x=>x.email===item.email&&x.type===item.type))return json({message:'Esse endereço já está na fila.'},409);
    if(item.type==='initial'&&data.sent.some(x=>x.email===item.email))return json({message:'Esse endereço já recebeu contato. Evite uma segunda abordagem inicial.'},409);
    data.queue.unshift(item);await save(redis,env,data);return json({ok:true,item});
   }
   if(action==='queue-update'){
    const item=data.queue.find(x=>x.id===body.id);if(!item)return json({message:'Mensagem não encontrada.'},404);
    const fresh=draftOf({...item,subject:body.subject,text:body.text});if(!fresh)return json({message:'Assunto ou texto inválido.'},400);
    if(item.subject!==fresh.subject||item.text!==fresh.text){item.approvedAt=null;item.scheduledAt=null;}
    item.subject=fresh.subject;item.text=fresh.text;await save(redis,env,data);return json({ok:true});
   }
   if(action==='schedule'){
     if(body.approved!==true)return json({message:'Agendamento exige confirmação explícita.'},400);
     const item=data.queue.find(x=>x.id===body.id);
     if(!item)return json({message:'Mensagem não encontrada.'},404);
     const at=Date.parse(body.scheduledAt);
     if(!Number.isFinite(at)||at<Date.now()+120000||at>Date.now()+90*86400000)return json({message:'Escolha data futura entre 2 minutos e 90 dias.'},400);
     const raw=await redis(['GET',STORE]),stored=raw?unseal(raw,env):null;
     if(stored?.email!==ADDRESS||!String(stored.scopes||'').includes('gmail.send'))return json({message:'Autorize a permissão de envio do Gmail antes de agendar.',needsReconnect:true},409);
     item.scheduledAt=new Date(at).toISOString();item.approvedAt=new Date().toISOString();item.needsReview=false;
     await save(redis,env,data);return json({ok:true,scheduledAt:item.scheduledAt});
   }
   if(action==='unschedule'){
     const item=data.queue.find(x=>x.id===body.id);
     if(!item)return json({message:'Mensagem não encontrada.'},404);
     item.scheduledAt=null;item.approvedAt=null;await save(redis,env,data);return json({ok:true});
   }
   if(action==='queue-remove'){data.queue=data.queue.filter(x=>x.id!==body.id);await save(redis,env,data);return json({ok:true})}
   if(action==='followup-dismiss'){if(!data.dismissed.includes(body.id))data.dismissed.push(trim(body.id,50));await save(redis,env,data);return json({ok:true})}
   if(action==='send'){
    if(body.approved!==true)return json({message:'O envio exige aprovação explícita.'},400);
    const item=data.queue.find(x=>x.id===body.id);if(!item)return json({message:'Mensagem inexistente ou já enviada.'},409);
    const raw=await redis(['GET',STORE]),stored=raw?unseal(raw,env):null;
    if(stored?.email!==ADDRESS)return json({message:'Conecte seu Gmail de prospecção.'},409);
    if(!String(stored.scopes||'').includes('gmail.send'))return json({message:'Reconecte o Gmail para autorizar também o envio.',needsReconnect:true},409);
    const inboxRaw=await redis(['GET',RESULTS]),inbox=inboxRaw?unseal(inboxRaw,env):[];
    if(inbox.some(x=>x.email===item.email&&['Sem interesse','Automático'].includes(x.label)))return json({message:'Resposta de recusa ou automática identificada. Envio bloqueado.'},409);
    if(item.type==='initial'&&data.sent.some(x=>x.email===item.email))return json({message:'Contato já abordado.'},409);
    if(item.type==='followup'&&data.sent.some(x=>x.email===item.email&&x.type==='followup'))return json({message:'Um follow-up já foi enviado. Sem insistência adicional.'},409);
    const day=new Date().toISOString().slice(0,10);
    const lua='local c=tonumber(redis.call("GET",KEYS[1]) or "0");if c>=tonumber(ARGV[1]) then return 0 end;redis.call("INCR",KEYS[1]);redis.call("EXPIRE",KEYS[1],172800);return 1';
    const limit=await redis(['EVAL',lua,1,DAY+day,LIMIT]);if(limit!==1)return json({message:'Limite de '+LIMIT+' envios por dia atingido.'},429);
    const locked=await redis(['SET',LOCK+item.id,'1','NX','EX',86400]);if(locked!=='OK')return json({message:'Envio já processado ou em andamento.'},409);
    let result;
    try{const token=await access(env,redis);result=await send(token,item)}
    catch(e){
      const latest=await load(redis,env);const failed=latest.queue.find(x=>x.id===item.id);
      if(failed?.approvedAt){failed.approvedAt=null;failed.scheduledAt=null;failed.needsReview=true;await save(redis,env,latest)}
      return json({message:e.message==='send_403'?'Permissão de envio recusada. Reconecte o Gmail.':'Envio não confirmado. Confira a pasta Enviados antes de tentar novamente.',needsReconnect:e.message==='send_403'},502)}
    const latest=await load(redis,env),sent={...item,googleId:result.id,threadId:result.threadId,sentAt:new Date().toISOString()};
    latest.queue=latest.queue.filter(x=>x.id!==item.id);latest.sent.unshift(sent);latest.sent=latest.sent.slice(0,600);
    await save(redis,env,latest);return json({ok:true,sent});
   }
   return json({message:'Ação não reconhecida.'},400);
  }catch{return json({message:'Serviço temporariamente indisponível.'},503)}
 };
}

// Invoked only by the authenticated server-side Cron. Every email must have
// already been explicitly scheduled/approved by the user while in the CRM.
export async function sendDue({env=process.env}={}){
 if(!ready(env))return {sent:0,skipped:0};
 const redis=redisClient(env),data=await load(redis,env);
 const due=data.queue.filter(x=>x.approvedAt&&x.scheduledAt&&Date.parse(x.scheduledAt)<=Date.now()).slice(0,3);
 let sent=0,skipped=0;
 for(const item of due){
  const request=new Request('https://portfolio-ricky-mangini.vercel.app/api/outreach',{
   method:'POST',headers:{Authorization:'Bearer '+env.RADAR_DASHBOARD_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({action:'send',id:item.id,approved:true})
  });
  try{const result=await createHandler({env})(request);if(result.ok)sent++;else skipped++}catch{skipped++}
 }
 return {sent,skipped};
}

export default {fetch:createHandler()};
