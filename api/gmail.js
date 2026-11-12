import { ready,authorized,json,redisClient,STORE,LEADS,RESULTS,ADDRESS,nonce,authUrl,seal,unseal,tidyLeads,syncInbox } from '../lib/gmail.js';
import { boundedText } from '../lib/radar-control.js';

export async function handler(request) {
 const env=process.env;
 if(!['GET','POST'].includes(request.method))return json({message:'Método não permitido.'},405);
 if(!authorized(request,env))return json({message:'Entre no CRM com a chave do painel.'},401);
 if(!ready(env))return json({message:'Integração Gmail aguardando configuração.'},503);
 const redis=redisClient(env);
 try{
  if(request.method==='GET'){
   const raw=await redis(['GET',STORE]);
   const stored=raw?unseal(raw,env):null;
   const resultsRaw=await redis(['GET',RESULTS]);
   const items=resultsRaw?unseal(resultsRaw,env):[];
   return json({connected:stored?.email===ADDRESS,email:stored?.email||null,items,aiActive:!!env.OPENAI_API_KEY&&env.GMAIL_AI_ENABLED==='true',syncMode:'Ao abrir o CRM e a cada 2 minutos enquanto estiver aberto.'});
  }
  let body;
  try {body=JSON.parse(await boundedText(request,35000));}catch{return json({message:'Requisição inválida.'},400)}
  if(body?.action==='connect'){
   const state=nonce();
   await redis(['SET','ricky:gmail:v1:state:'+state,'1','EX',600]);
   return json({url:authUrl(state,env)});
  }
  if(body?.action==='disconnect'){
   await redis(['DEL',STORE,LEADS,RESULTS]);
   return json({connected:false});
  }
  if(body?.action==='sync'){
   const leads=tidyLeads(body.leads);
   await redis(['SET',LEADS,seal(leads,env),'EX',90*86400]);
   const raw=await redis(['GET',STORE]);
   if(!raw)return json({connected:false,items:[],message:'Conecte o Gmail para sincronizar.'});
   const result=await syncInbox(env,redis);
   if(result.busy){
     const current=await redis(['GET',RESULTS]);
     return json({connected:true,busy:true,items:current?unseal(current,env):[]});
   }
   return json({connected:true,...result});
  }
  return json({message:'Ação inválida.'},400);
 }catch(error){
  const codes={token_expired:'Autorização do Google expirada. Reconecte o Gmail.',not_connected:'Gmail não conectado.',wrong_account:'A conta Google autorizada não corresponde à conta de prospecção.',oauth_exchange:'Não foi possível concluir a autorização.'};
  const message=codes[error?.message]||(String(error?.message||'').startsWith('gmail_')?'O Gmail recusou a sincronização. Confira a autorização.':'Integração Gmail indisponível temporariamente.');
  return json({message},503);
 }
}

export default { fetch: handler };
