import {authorized,json,redisClient,configured,SPEND_KEY} from '../lib/radar-control.js';

const int=(v)=>v===null||v===undefined?0:Math.max(0,Number.parseInt(v,10)||0);
const num=(v)=>Number.isFinite(Number(v))?Number(v):null;
const progress=(used,limit)=>({used,limit,remaining:Math.max(0,limit-used),percentage:limit?Math.min(100,Math.round(used/limit*100)):null});
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
   'radar:v1:day:'+day,'radar:v1:month:'+month,SPEND_KEY
  ];
  try{
   const redis=redisClient(env,fetcher),values=await redis(['MGET',...keys]);
   if(!Array.isArray(values)||values.length!==keys.length)throw new Error('invalid_usage');
   const x=values.map(int);
   const braveDayLimit=int(env.RADAR_DAILY_LIMIT),braveMonthLimit=int(env.RADAR_MONTHLY_LIMIT);
   const braveBudget=int(env.RADAR_BUDGET_CENTS);
   return json({
    updatedAt:now,period:{day,month,timezone:'UTC'},
    note:'Contadores de reservas realizadas pelo Ricky CRM. Não são faturas nem consumo de outras aplicações.',
    places:{connected:!!env.GOOGLE_PLACES_API_KEY,callsDay:progress(x[0],15),callsMonth:progress(x[1],200),scansDay:progress(x[2],5),scansMonth:progress(x[3],75),freeTierRemaining:null,billedAmount:null,billingSource:'Não conectado ao Google Cloud Billing'},
    openai:{connected:!!env.OPENAI_API_KEY,requestsDay:progress(x[4],30),requestsMonth:progress(x[5],350),tokens:null,freeTierRemaining:null,billedAmount:null,billingSource:'Não conectado à OpenAI Costs API'},
    brave:{connected:!!env.BRAVE_SEARCH_API_KEY,requestsDay:braveDayLimit?progress(x[6],braveDayLimit):null,requestsMonth:braveMonthLimit?progress(x[7],braveMonthLimit):null,reservedBudgetCents:braveBudget?{used:x[8],limit:braveBudget,remaining:Math.max(0,braveBudget-x[8])}:null,freeTierRemaining:null,billedAmount:null,billingSource:'Créditos do Brave não consultados'},
    upstash:{connected:configured(env),requests:null,billedAmount:null,billingSource:'Uso total do Redis não disponibilizado por este endpoint'},
    vercel:{connected:true,requests:null,billedAmount:null,billingSource:'Cobrança da Vercel não conectada'}
   });
  }catch{return json({message:'Não foi possível ler os contadores. Tente novamente; nenhum valor foi estimado.'},503)}
 };
}
export default {fetch:createHandler()};
