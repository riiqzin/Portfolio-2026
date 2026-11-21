import { createHandler as createLabHandler } from '../lib/ai-lab-handler.js';
import { randomBytes, createHash } from 'node:crypto';
import { authorized, json, configured, redisClient, boundedText } from '../lib/radar-control.js';

const INDEX='ricky:onboarding:index:v1';
const key=id=>'ricky:onboarding:v1:'+id;
const hash=token=>createHash('sha256').update(token).digest('hex');
const clean=(v,n=200)=>typeof v==='string'?v.trim().slice(0,n):'';
const validToken=t=>typeof t==='string'&&/^[a-f0-9]{48}$/.test(t);
const okUrl=s=>!s||(/^https:\/\//i.test(s)&&s.length<=500);
const knownSegment=s=>/barbear|sal[aã]o|cabel|est[eé]tica|tatu|personal|loja|restaur|lanch|caf[eé]|cl[ií]nica/i.test(s);
const businessProfile=(segment)=>/barbear|sal[aã]o|cabel|est[eé]tica|tatu|personal|cl[ií]nica/i.test(segment)?'servicos':'geral';
async function readBody(req){try{return JSON.parse(await boundedText(req,18000))}catch{return null}}
const deny=(m,code=400)=>json({message:m},code);
export function createHandler({env=process.env,clock=()=>Date.now(),fetcher=fetch}={}){
 const labHandler=createLabHandler({env,clock:()=>new Date(clock()),fetcher});
 return async request=>{
  const url=new URL(request.url),token=url.searchParams.get('token');
  if(url.searchParams.get('lab')==='1')return labHandler(request);
  const admin=authorized(request,env);
  if(!configured(env))return deny('Armazenamento de formulários indisponível.',503);
  const redis=redisClient(env,fetcher);
  try{
   if(request.method==='GET'&&token){
    if(!validToken(token))return deny('Link inválido.',404);
    const raw=await redis(['GET',key(hash(token))]);if(!raw)return deny('Link expirado ou não encontrado.',404);
    const d=JSON.parse(raw);
    return json({company:d.company,segment:d.segment,profile:d.profile,status:d.status,expiresAt:d.expiresAt});
   }
   if(!admin&&!token)return deny('Acesso não autorizado.',401);
   if(admin&&request.method==='GET'){
    const ids=await redis(['ZREVRANGE',INDEX,0,149]);
    const raw=Array.isArray(ids)&&ids.length?await redis(['MGET',...ids.map(key)]):[];
    return json({items:(Array.isArray(raw)?raw:[]).filter(Boolean).map(s=>{const x=JSON.parse(s);return {id:x.id,company:x.company,segment:x.segment,profile:x.profile,status:x.status,createdAt:x.createdAt,submittedAt:x.submittedAt||null,answers:x.answers||null,expiresAt:x.expiresAt}})});
   }
   if(request.method!=='POST')return deny('Método não permitido.',405);
   const body=await readBody(request);if(!body||typeof body!=='object')return deny('Confira os dados enviados.');
   if(admin&&!token){
    if(body.action==='clear-answers'||body.action==='delete'){
     const id=clean(body.id,64);
     if(!/^[a-f0-9]{64}$/.test(id))return deny('Formulário inválido.');
     const existing=await redis(['GET',key(id)]);
     if(!existing)return deny('Formulário não encontrado.',404);
     if(body.action==='delete'){
      await redis(['DEL',key(id)]);
      await redis(['ZREM',INDEX,id]);
      return json({ok:true,deleted:true});
     }
     const form=JSON.parse(existing);
     delete form.answers;delete form.submittedAt;
     form.status='pendente';
     const remaining=Math.max(1,Math.ceil((Date.parse(form.expiresAt)-clock())/1000)+86400);
     await redis(['SET',key(id),JSON.stringify(form),'EX',remaining]);
     return json({ok:true,cleared:true});
    }
    if(body.action!=='create')return deny('Ação inválida.');
    const company=clean(body.company,120),segment=clean(body.segment,100);
    if(company.length<2||segment.length<2)return deny('Informe empresa e segmento.');
    const rawToken=randomBytes(24).toString('hex'),id=hash(rawToken),createdAt=new Date(clock()).toISOString();
    const expiresAt=new Date(clock()+30*86400000).toISOString();
    const data={id,company,segment,profile:businessProfile(segment),status:'pendente',createdAt,expiresAt};
    await redis(['SET',key(id),JSON.stringify(data),'EX',31*86400]);
    await redis(['ZADD',INDEX,clock(),id]);
    await redis(['ZREMRANGEBYRANK',INDEX,0,-201]);
    return json({ok:true,token:rawToken,createdAt,expiresAt},201);
   }
   if(!validToken(token))return deny('Link inválido.',404);
   // Limit attempts per shared link. Token is unguessable and never stored in plaintext.
   const attempts=await redis(['INCR','ricky:onboarding:attempts:'+hash(token)]);
   if(attempts===1)await redis(['EXPIRE','ricky:onboarding:attempts:'+hash(token),3600]);
   if(attempts>15)return deny('Muitas tentativas. Tente mais tarde.',429);
   const raw=await redis(['GET',key(hash(token))]);if(!raw)return deny('Link expirado ou não encontrado.',404);
   const data=JSON.parse(raw);
   if(data.status==='recebido')return deny('Este formulário já foi enviado.',409);
   if(Date.parse(data.expiresAt)<clock())return deny('Link expirado.',410);
   const answers=body.answers||{},hours=clean(answers.hours,300),payments=Array.isArray(answers.payments)?answers.payments.filter(v=>['Pix','Cartão','Dinheiro','Boleto','Outro'].includes(v)).slice(0,5):[];
   const services=clean(answers.services,4500),policy=clean(answers.policy,1600),address=clean(answers.address,300),link=clean(answers.link,500),notes=clean(answers.notes,1600);
   if(hours.length<3||services.length<8||payments.length<1)return deny('Informe horários, serviços com preços e formas de pagamento.');
   if(!okUrl(link))return deny('O link deve começar com https://');
   if(!/\d/.test(services))return deny('Inclua os valores dos serviços ou produtos, ou informe claramente que o preço é sob consulta.');
   if(!/R\$|reais|\d+[,.]\d{2}|sob consulta|a combinar/i.test(services))return deny('Inclua preços (ex.: Corte — R$ 35) ou indique “sob consulta”.');
   const now=new Date(clock()).toISOString();
   data.status='recebido';data.submittedAt=now;data.answers={hours,payments,services,policy,address,link,notes};
   // One-time claim avoids double submits from two devices.
   const lock=await redis(['SET','ricky:onboarding:lock:'+data.id,'1','NX','EX',90]);
   if(lock!=='OK')return deny('Formulário já está sendo enviado.',409);
   await redis(['SET',key(data.id),JSON.stringify(data),'EX',31*86400]);
   return json({ok:true,receivedAt:now});
  }catch{return deny('Não foi possível concluir. Tente novamente.',503)}
 };
}
export default {fetch:createHandler()};
