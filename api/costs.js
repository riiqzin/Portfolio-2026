import {authorized,json,redisClient,configured,SPEND_KEY} from '../lib/radar-control.js';

const int=(v)=>v===null||v===undefined?0:Math.max(0,Number.parseInt(v,10)||0);
const num=(v)=>Number.isFinite(Number(v))?Number(v):null;
const progress=(used,limit)=>({used,limit,remaining:Math.max(0,limit-used),percentage:limit?Math.min(100,Math.round(used/limit*100)):null});
async function getOfficialOpenAICosts(env,fetcher,startSeconds,endSeconds){
 if(!env.OPENAI_ADMIN_API_KEY)return {connected:false,amountUsd:null,daily:[],status:'Admin API key ainda não configurada'};
 try{
  const url=new URL('https://api.openai.com/v1/organization/costs');
  url.searchParams.set('start_time',String(startSeconds));
  url.searchParams.set('end_time',String(endSeconds));
  url.searchParams.set('bucket_width','1d');
  url.searchParams.set('limit','31');
  const r=await fetcher(url.href,{method:'GET',headers:{Authorization:'Bearer '+env.OPENAI_ADMIN_API_KEY,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!r.ok)return {connected:false,amountUsd:null,daily:[],status:'Não autorizado ou dados indisponíveis na OpenAI Costs API'};
  const payload=await r.json();
  if(!Array.isArray(payload?.data)||payload.has_more)return {connected:false,amountUsd:null,daily:[],status:'Dados de cobrança incompletos'};
  const daily=payload.data.map(bucket=>({
   day:new Date(Number(bucket.start_time)*1000).toISOString().slice(0,10),
   usd:(Array.isArray(bucket.results)?bucket.results:[]).reduce((sum,item)=>sum+(item?.amount?.currency==='usd'&&Number.isFinite(Number(item?.amount?.value))?Number(item.amount.value):0),0)
  }));
  return {connected:true,amountUsd:daily.reduce((sum,x)=>sum+x.usd,0),daily,status:'Custo oficial da organização OpenAI; dados podem ter atraso'};
 }catch{return {connected:false,amountUsd:null,daily:[],status:'Não foi possível consultar custos oficiais da OpenAI'};}
}

export function createHandler({env=process.env,clock=()=>new Date(),fetcher=fetch}={}){
 return async request=>{
  if(request.method!=='GET')return json({message:'Método não permitido.'},405);
  if(!authorized(request,env))return json({message:'Não autorizado.'},401);
  if(!configured(env))return json({message:'Contadores temporariamente indisponíveis. Não vamos inventar consumo.'},503);
  const now=clock().toISOString(),day=now.slice(0,10),month=now.slice(0,7);
  const keys=[
   'ricky:local:calls2:day:'+day,'ricky:local:calls2:month:'+month,
   'ricky:local:scans2:day:'+day,'ricky:local:scans2:month:'+month,
   'ricky:ai:day:'+day,'ricky:ai:month:'+month,
   'radar:v1:day:'+day,'radar:v1:month:'+month,SPEND_KEY,
   'ricky:ai:tokens:input:month:'+month,'ricky:ai:tokens:output:month:'+month,
   'ricky:ai:tokens:input:day:'+day,'ricky:ai:tokens:output:day:'+day,
   'ricky:ai:reserved-cents:month:'+month
  ];
  // Historical counters are CRM-only and not a substitute for provider billing.
  const historyDates=Array.from({length:14},(_,i)=>new Date(Date.parse(day+'T00:00:00Z')-(13-i)*86400000).toISOString().slice(0,10));
  try{
   const redis=redisClient(env,fetcher),values=await redis(['MGET',...keys]);
   if(!Array.isArray(values)||values.length!==keys.length)throw new Error('invalid_usage');
   const x=values.map(int);
   let history=[];
   try{
    const counts=await redis(['MGET',...historyDates.map(d=>'ricky:ai:day:'+d)]);
    if(Array.isArray(counts)&&counts.length===historyDates.length)history=historyDates.map((d,i)=>({day:d,requests:int(counts[i])}));
   }catch{/* Historical chart is optional; monthly counters remain valid. */}
   const first=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1,1));
   const official=await getOfficialOpenAICosts(env,fetcher,Math.floor(first.getTime()/1000),Math.floor(clock().getTime()/1000));
   const aiBudget=int(env.AI_MONTHLY_BUDGET_CENTS);
   const aiReserved=x[13];
   const braveDayLimit=int(env.RADAR_DAILY_LIMIT),braveMonthLimit=int(env.RADAR_MONTHLY_LIMIT);
   const braveBudget=int(env.RADAR_BUDGET_CENTS);
   return json({
    updatedAt:now,period:{day,month,timezone:'UTC'},
    note:'Contadores de reservas realizadas pelo Ricky CRM. Não são faturas nem consumo de outras aplicações.',
    places:{connected:!!env.GOOGLE_PLACES_API_KEY,callsDay:progress(x[0],15),callsMonth:progress(x[1],200),scansDay:progress(x[2],5),scansMonth:progress(x[3],75),freeTierRemaining:null,billedAmount:null,billingSource:'Não conectado ao Google Cloud Billing'},
    openai:{connected:!!env.OPENAI_API_KEY,requestsDay:progress(x[4],30),requestsMonth:progress(x[5],350),tokens:{inputMonth:x[9],outputMonth:x[10],inputDay:x[11],outputDay:x[12]},history,freeTierRemaining:null,billedAmount:official.amountUsd,official:official.connected,billingSource:official.status,officialDaily:official.daily,budget:{limitCents:aiBudget,reservedCents:aiReserved,remainingCents:aiBudget?Math.max(0,aiBudget-aiReserved):null,percentage:aiBudget?Math.min(100,Math.round(aiReserved/aiBudget*100)):null,warning:aiBudget>0&&aiReserved/aiBudget>=0.8}},
    brave:{connected:!!env.BRAVE_SEARCH_API_KEY,requestsDay:braveDayLimit?progress(x[6],braveDayLimit):null,requestsMonth:braveMonthLimit?progress(x[7],braveMonthLimit):null,reservedBudgetCents:braveBudget?{used:x[8],limit:braveBudget,remaining:Math.max(0,braveBudget-x[8])}:null,freeTierRemaining:null,billedAmount:null,billingSource:'Créditos do Brave não consultados'},
    upstash:{connected:configured(env),requests:null,billedAmount:null,billingSource:'Uso total do Redis não disponibilizado por este endpoint'},
    vercel:{connected:true,requests:null,billedAmount:null,billingSource:'Cobrança da Vercel não conectada'}
   });
  }catch{return json({message:'Não foi possível ler os contadores. Tente novamente; nenhum valor foi estimado.'},503)}
 };
}
export default {fetch:createHandler()};
