import { createHandler as createLabHandler } from '../lib/ai-lab-handler.js';
import { randomBytes, createHash } from 'node:crypto';
import { authorized, json, configured, redisClient, boundedText } from '../lib/radar-control.js';

const INDEX='ricky:onboarding:index:v1';
const key=id=>'ricky:onboarding:v1:'+id;
const promptKey=id=>'ricky:onboarding:prompt:v1:'+id;
const mediaKey=id=>'ricky:onboarding:media:v1:'+id;
const fingerprint=form=>hash(JSON.stringify([form.company,form.segment,form.submittedAt,form.answers]));
const normalizePrompt=(value)=>{
 let output=value.trim().replace(/\r\n?/g,'\n');
 // Formatting escapes sometimes appear when copying ChatGPT output.
 output=output.replace(/(^|\n)[ \t]*\\+(<\/?(?:regras_fixas|dados_empresa|modulo_atendimento_humano|modulo_agendamento|contexto_da_conversa)>)[ \t]*\\*[ \t]*(?=\n|$)/g,'$1$2');
 output=output.replace(/(^|\n)[ \t]*(<\/?(?:regras_fixas|dados_empresa|modulo_atendimento_humano|modulo_agendamento|contexto_da_conversa)>)[ \t]*\\+[ \t]*(?=\n|$)/g,'$1$2');
 return output;
};
const tagCount=(value,tag)=>{
 const lines=value.split('\n').map(line=>line.trim());
 return lines.filter(line=>line==='<'+tag+'>').length===1&&lines.filter(line=>line==='</'+tag+'>').length===1;
};
const requiredTags=['regras_fixas','dados_empresa','modulo_atendimento_humano','modulo_agendamento','contexto_da_conversa'];
const validId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
const hash=token=>createHash('sha256').update(token).digest('hex');
const clean=(v,n=200)=>typeof v==='string'?v.trim().slice(0,n):'';
const validToken=t=>typeof t==='string'&&/^[a-f0-9]{48}$/.test(t);
const okUrl=s=>!s||(/^https:\/\//i.test(s)&&s.length<=500);
const knownSegment=s=>/barbear|sal[aã]o|cabel|est[eé]tica|tatu|personal|loja|restaur|lanch|caf[eé]|cl[ií]nica/i.test(s);
const businessProfile=(segment)=>/barbear|sal[aã]o|cabel|est[eé]tica|tatu|personal|cl[ií]nica/i.test(segment)?'servicos':'geral';
const BARBER_FEATURES=['corteInfantil','barba','sobrancelha','degrade','maquina','tesoura','lavagem','coloracao','tratamentos','domicilio','acessibilidade','comAgendamento','semAgendamento','escolhaProfissional','atendeFeriados','aceitaAtraso','cancelamento','sinal','cartaoCredito','cartaoDebito','parcelamento','promocoes','petFriendly'];
const BARBER_DETAILS=['idadeInfantil','profissionais','duracoes','regrasAgendamento','regrasAtraso','regrasSinal','formasAtendimento','servicosEspeciais'];
function normalizeKnowledge(input){
 if(input==null)return null;
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Dados adicionais da barbearia inválidos.');
 const rawFeatures=input.features,rawDetails=input.details;
 if(!rawFeatures||typeof rawFeatures!=='object'||Array.isArray(rawFeatures)||!rawDetails||typeof rawDetails!=='object'||Array.isArray(rawDetails))throw Error('Informações da barbearia incompletas.');
 const features={};for(const name of BARBER_FEATURES){const value=rawFeatures[name]??'desconhecido';if(!['sim','nao','desconhecido'].includes(value))throw Error('Confirme as respostas de Sim, Não ou Não sei.');features[name]=value}
 const details={};for(const name of BARBER_DETAILS){const value=rawDetails[name];if(value!==undefined&&typeof value!=='string')throw Error('Informação adicional inválida.');const cleanValue=clean(value||'',300);if(cleanValue)details[name]=cleanValue}
 return {features,details};
}
function validServices(v){return v.length>=8&&/\d/.test(v)&&/R\$|reais|\d+[,.]\d{2}|sob consulta|a combinar/i.test(v)}
function pricePhotos(v){
 if(v==null)return [];if(!Array.isArray(v)||v.length>3)throw Error('Envie até 3 fotos.');
 return v.map(img=>{
  if(typeof img!=='string'||img.length>148000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(img))throw Error('Imagem inválida.');
  const bytes=Buffer.from(img.slice(23),'base64');
  if(bytes.length>110000||bytes.length<100||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('Imagem inválida.');
  return img;
 });
}
async function readBody(req){try{return JSON.parse(await boundedText(req,520000))}catch{return null}}
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
    if(Date.parse(d.expiresAt)<clock())return deny('Link expirado.',410);
    return json({company:d.company,segment:d.segment,profile:d.profile,status:d.status,expiresAt:d.expiresAt});
   }
   if(!admin&&!token)return deny('Acesso não autorizado.',401);
   const mediaId=url.searchParams.get('media');
   if(admin&&request.method==='GET'&&mediaId){
    if(!validId(mediaId))return deny('Empresa inválida.');
    if(!await redis(['GET',key(mediaId)]))return deny('Formulário não encontrado.',404);
    const raw=await redis(['GET',mediaKey(mediaId)]);return json({images:raw?JSON.parse(raw):[]});
   }
   const promptId=url.searchParams.get('prompt');
   if(admin&&request.method==='GET'&&promptId){
    if(!validId(promptId))return deny('Empresa inválida.');
    const [formRaw,promptRaw]=await Promise.all([redis(['GET',key(promptId)]),redis(['GET',promptKey(promptId)])]);
    if(!formRaw)return deny('Formulário não encontrado.',404);
    const form=JSON.parse(formRaw),saved=promptRaw?JSON.parse(promptRaw):null;
    const current=!!saved&&saved.fingerprint===fingerprint(form)&&form.status==='recebido'&&form.answers?.priceReview!==false;
    return json({prompt:saved?.text||'',savedAt:saved?.savedAt||null,version:saved?.version||0,current,reason:saved&&!current?'As respostas do formulário foram alteradas. Revise e salve novamente.':null});
   }

   if(admin&&request.method==='GET'){
    const ids=await redis(['ZREVRANGE',INDEX,0,149]);
    const raw=Array.isArray(ids)&&ids.length?await redis(['MGET',...ids.map(key)]):[];
    return json({items:(Array.isArray(raw)?raw:[]).filter(Boolean).map(s=>{const x=JSON.parse(s);return {id:x.id,company:x.company,segment:x.segment,profile:x.profile,status:x.status,createdAt:x.createdAt,submittedAt:x.submittedAt||null,answersUpdatedAt:x.answersUpdatedAt||null,answers:x.answers||null,expiresAt:x.expiresAt}})});
   }
   if(request.method!=='POST')return deny('Método não permitido.',405);
   const body=await readBody(request);if(!body||typeof body!=='object')return deny('Confira os dados enviados.');
   if(admin&&!token){
    if(body.action==='confirm-prices'){
      const id=clean(body.id,64);if(!validId(id))return deny('Empresa inválida.');
      const raw=await redis(['GET',key(id)]);if(!raw)return deny('Formulário não encontrado.',404);
      const form=JSON.parse(raw);if(form.status!=='recebido'||!form.answers)return deny('Formulário incompleto.',409);
      const revision=form.answersUpdatedAt||form.submittedAt||'';
      if(body.expectedRevision!==revision)return deny('O formulário foi alterado. Atualize antes de aprovar.',409);
      const services=clean(body.services,4500);if(!validServices(services))return deny('Informe os serviços e os preços confirmados ou sob consulta.');
      form.answers.services=services;form.answers.priceReview=true;form.answersUpdatedAt=new Date(clock()).toISOString();
      await redis(['SET',key(id),JSON.stringify(form)]);return json({ok:true,revision:form.answersUpdatedAt});
     }
     if(body.action==='edit-answers'){
     const id=clean(body.id,64);
     if(!validId(id))return deny('Empresa inválida.');
     const formRaw=await redis(['GET',key(id)]);
     if(!formRaw)return deny('Formulário não encontrado.',404);
     const form=JSON.parse(formRaw);
     if(form.status!=='recebido'||!form.answers)return deny('O cliente ainda não respondeu ao formulário.',409);
     const revision=form.answersUpdatedAt||form.submittedAt||'';
     if(body.expectedRevision!==revision)return deny('As respostas mudaram desde que você abriu o editor. Atualize a página antes de salvar.',409);
     const a=body.answers;
     if(!a||typeof a!=='object'||Array.isArray(a))return deny('Respostas inválidas.');
     const hours=clean(a.hours,300),services=clean(a.services,4500);
     const payments=Array.isArray(a.payments)?[...new Set(a.payments.filter(v=>['Pix','Cartão','Dinheiro','Boleto','Outro'].includes(v)))].slice(0,5):[];
     const policy=clean(a.policy,1600),address=clean(a.address,300),humanContact=clean(a.humanContact,220),link=clean(a.link,500),notes=clean(a.notes,1600);
     if(hours.length<3||payments.length<1)return deny('Informe horários e forma de pagamento.');
     if(services&&!validServices(services))return deny('Confira os preços.');
     if(!services&&!form.answers.priceLink&&!form.answers.pricePhotoCount)return deny('Informe os serviços.');

     if(!okUrl(link))return deny('O link deve começar com https://');
     const knowledge= a.knowledge===undefined ? (form.answers.knowledge||null) : normalizeKnowledge(a.knowledge);
     const updated={...form.answers,hours,services,payments,policy,address,humanContact,link,notes,...(knowledge?{knowledge}:{})};
     if(services!==form.answers.services)updated.priceReview=false;
     if(JSON.stringify(updated)===JSON.stringify({...form.answers}))return json({ok:true,unchanged:true,revision,promptOutdated:false});
     form.answers=updated;
     form.answersUpdatedAt=new Date(clock()).toISOString();
     // Keep the saved prompt for review/history; fingerprint mismatch disables old prompt in the lab.
     await redis(['SET',key(id),JSON.stringify(form)]);
     return json({ok:true,revision:form.answersUpdatedAt,promptOutdated:true});
    }
    if(body.action==='save-prompt'){
     const id=clean(body.id,64),prompt=typeof body.prompt==='string'?normalizePrompt(body.prompt):'';
     if(!validId(id))return deny('Empresa inválida.');
     if(prompt.length<350||prompt.length>16000)return deny('O prompt revisado deve ter de 350 a 16.000 caracteres.');
     const missing=requiredTags.filter(tag=>!tagCount(prompt,tag));
     if(missing.length)return deny('Verifique as tags de seção (uma por linha, abertura e fechamento): '+missing.map(tag=>'<'+tag+'>').join(', ')+'.');
     if(!prompt.includes('{{DATA_HORA_ATUAL}}')||!prompt.includes('{{FUSO}}'))return deny('Mantenha os marcadores de data, hora e fuso sem preencher.');
     const lines=prompt.split('\n').map(line=>line.trim());
     const opens=requiredTags.map(tag=>lines.indexOf('<'+tag+'>'));
     const closes=requiredTags.map(tag=>lines.indexOf('</'+tag+'>'));
     if(opens.some((position,i)=>position<0||closes[i]<=position||i>0&&position<=closes[i-1]))return deny('Mantenha as cinco seções completas na ordem correta, sem sobreposição.');
     // O título interno é opcional; a identidade do assistente está nas regras fixas.
     const formRaw=await redis(['GET',key(id)]);
     if(!formRaw)return deny('Formulário não encontrado.',404);
     const form=JSON.parse(formRaw);
     if(form.status!=='recebido'||!form.answers)return deny('A empresa precisa responder ao formulário.');
     if(form.answers.priceReview===false||!validServices(clean(form.answers.services,4500)))return deny('Confira e aprove os serviços e preços antes de salvar o prompt.',409);
     const previous=await redis(['GET',promptKey(id)]),version=previous?(JSON.parse(previous).version||0)+1:1;
     const savedAt=new Date(clock()).toISOString();
     await redis(['SET',promptKey(id),JSON.stringify({text:prompt,fingerprint:fingerprint(form),savedAt,version})]);
     return json({ok:true,savedAt,version,current:true,prompt});
    }
    if(body.action==='delete-prompt'){
     const id=clean(body.id,64);
     if(!validId(id))return deny('Empresa inválida.');
     await redis(['DEL',promptKey(id)]);
     return json({ok:true});
    }
    if(body.action==='clear-answers'||body.action==='delete'){
     const id=clean(body.id,64);
     if(!/^[a-f0-9]{64}$/.test(id))return deny('Formulário inválido.');
     const existing=await redis(['GET',key(id)]);
     if(!existing)return deny('Formulário não encontrado.',404);
     if(body.action==='delete'){
      await redis(['DEL',key(id)]);
      await redis(['DEL',promptKey(id)]);
      await redis(['DEL',mediaKey(id)]);
      await redis(['ZREM',INDEX,id]);
      return json({ok:true,deleted:true});
     }
     const form=JSON.parse(existing);
     delete form.answers;delete form.submittedAt;
     await redis(['DEL',promptKey(id)]);
     await redis(['DEL',mediaKey(id)]);
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
   const priceLink=clean(answers.priceLink,500);if(!okUrl(priceLink))return deny('O link deve começar com https://');
   const photos=pricePhotos(answers.photos);
   const services=clean(answers.services,4500),policy=clean(answers.policy,1600),address=clean(answers.address,300),humanContact=clean(answers.humanContact,220),link=clean(answers.link,500),notes=clean(answers.notes,1600);
   if(hours.length<3||payments.length<1)return deny('Informe horários e forma de pagamento.');
   if(!services&&!priceLink&&!photos.length)return deny('Digite preços, envie fotos ou informe um link.');
   if(!okUrl(link))return deny('O link deve começar com https://');


   const now=new Date(clock()).toISOString();
   const knowledge=normalizeKnowledge(answers.knowledge);
   if(/barbear/i.test(data.segment||'')&&!knowledge)return deny('Preencha as perguntas da secretária virtual antes de enviar.');
   if(services&&!validServices(services))return deny('Confira os preços informados.');
   data.status='recebido';data.submittedAt=now;data.answers={hours,payments,services,policy,address,humanContact,link,notes,priceLink,pricePhotoCount:photos.length,priceReview:false,...(knowledge?{knowledge}:{})};
   // One-time claim avoids double submits from two devices.
   const lock=await redis(['SET','ricky:onboarding:lock:'+data.id,'1','NX','EX',90]);
   if(lock!=='OK')return deny('Formulário já está sendo enviado.',409);
   // Store photo bytes separately; only a server-authenticated admin can retrieve them.
   if(photos.length)await redis(['SET',mediaKey(data.id),JSON.stringify(photos)]);
   // Keep completed client configurations until explicitly deleted; the public link still expires.
   await redis(['SET',key(data.id),JSON.stringify(data)]);
   return json({ok:true,receivedAt:now});
  }catch(error){return deny(error?.message&&/informações da barbearia|dados adicionais|confirme as respostas|informação adicional/i.test(error.message)?error.message:'Não foi possível concluir. Tente novamente.',error?.message&&/informações da barbearia|dados adicionais|confirme as respostas|informação adicional/i.test(error.message)?400:503)}
 };
}
export default {fetch:createHandler()};
