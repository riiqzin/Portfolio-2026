import {authorized,boundedText,json,redisClient,configured} from '../lib/radar-control.js';

const knownSocial=/^(?:www\.)?(?:instagram\.com|facebook\.com|m\.facebook\.com|fb\.com|tiktok\.com)$/i;
const bioSites=/(?:^|\.)((?:linktr\.ee)|(?:beacons\.ai)|(?:bio\.link)|(?:carrd\.co)|(?:linkme\.bio)|(?:taplink\.cc))$/i;
const booking=/(?:^|\.)(?:trinks\.com|booksy\.com|booksy\.com\.br|appbarber\.com|calendly\.com|avec\.app|agendaai\.com\.br|barberapp\.com\.br)$/i;
const whats=/(?:^|\.)(?:wa\.me|api\.whatsapp\.com|whatsapp\.com)$/i;
export function classifyWebsite(raw){
 if(!raw)return 'none';
 try{
  const u=new URL(raw);
  if(!['http:','https:'].includes(u.protocol))return 'unknown';
  const host=u.hostname.toLowerCase().replace(/^www\./,'');
  if(knownSocial.test(host))return 'social';
  if(bioSites.test(host))return 'bio';
  if(whats.test(host))return 'whatsapp';
  if(booking.test(host))return 'booking';
  return 'own';
 }catch{return 'unknown'}
}
export function normalizePlace(place){
 const url=String(place.websiteUri||'').slice(0,1500);
 const phone=String(place.nationalPhoneNumber||place.internationalPhoneNumber||'').slice(0,45);
 const digits=phone.replace(/\D/g,'');
 const phoneBr=digits.startsWith('55')&&digits.length>=12?digits.slice(2):digits;
 const mobile=/^[1-9][0-9]9[0-9]{8}$/.test(phoneBr);
 return {
  place_id:String(place.id||'').slice(0,250),
  name:String(place.displayName?.text||'').slice(0,160),
  city:String(place.formattedAddress||'').slice(0,180),
  rating:typeof place.rating==='number'?place.rating:null,
  reviews:Number.isInteger(place.userRatingCount)?place.userRatingCount:null,
  phone,
  mobile_probable:mobile,
  website:url,
  link_type:classifyWebsite(url),
  business_status:place.businessStatus||'UNKNOWN',
  maps_url:String(place.googleMapsUri||'').slice(0,1000)
 };
}

const QUOTA_LUA=["local d=tonumber(redis.call('GET',KEYS[1]) or '0')","local m=tonumber(redis.call('GET',KEYS[2]) or '0')","if d>=tonumber(ARGV[1]) or m>=tonumber(ARGV[2]) then return {0,d,m} end","redis.call('INCR',KEYS[1]);redis.call('EXPIRE',KEYS[1],172800)","redis.call('INCR',KEYS[2]);redis.call('EXPIRE',KEYS[2],5356800)","return {1,d+1,m+1}"].join('\n');
const DAY_CALLS=15,MONTH_CALLS=200,MAX_PER_SCAN=8,DAY_SCANS=5,MONTH_SCANS=75,TARGET=40;
const FIELD_MASK='nextPageToken,places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.businessStatus,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri';
const valid=s=>typeof s==='string'&&s.length>=2&&s.length<=80&&/^[\p{L}\p{N}\s,.'’&()-]+$/u.test(s);
const isSP=/^s[aã]o paulo(?:,\s*sp)?$/i;
export function assessCandidate(p){
 const closed=p.business_status==='CLOSED_PERMANENTLY';
 const contact=!!p.phone||['social','whatsapp'].includes(p.link_type);
 const landing=['none','social','bio','whatsapp'].includes(p.link_type);
 const bot=['own','booking','unknown'].includes(p.link_type);
 return {...p,candidate:!closed&&contact&&(landing||bot),
  match_type:closed||!contact?'research':landing?'landing':'bot_investigate',
  reason:closed?'Estabelecimento marcado como fechado no Google.':!contact?'Nenhum contato comercial identificado.':landing?'Link público pode indicar oportunidade de landing; site próprio não verificado.':'Contato identificado; atendimento manual e necessidade de bot ainda não verificados.'};
}
function queryPlan(niche,city,neighborhoods){
 const areas=Array.isArray(neighborhoods)?neighborhoods.filter(valid).slice(0,5):[];
 if(!areas.length&&isSP.test(city))areas.push('Mooca','Tatuapé','Santana','Vila Mariana','Pinheiros');
 return [niche+' em '+city,...areas.filter(x=>x.toLowerCase()!==city.toLowerCase()).map(x=>niche+' em '+x+', '+city)];
}
export function createHandler({env=process.env,fetcher=fetch,clock=()=>new Date()}={}){
 return async request=>{
  if(!['GET','POST'].includes(request.method))return json({message:'Método não permitido.'},405);
  if(!authorized(request,env))return json({message:'Não autorizado.'},401);
  if(request.method==='GET')return json({ready:!!env.GOOGLE_PLACES_API_KEY&&configured(env),provider:'Google Places (New)',goal:'both',target:TARGET,maxCallsPerScan:MAX_PER_SCAN,dailyCallLimit:DAY_CALLS,monthlyCallLimit:MONTH_CALLS,dailyLimit:DAY_SCANS,monthlyLimit:MONTH_SCANS});
  if(!env.GOOGLE_PLACES_API_KEY||!configured(env))return json({message:'Google Places ou controle de custo não configurado.'},503);
  let body;try{body=JSON.parse(await boundedText(request,2500))}catch{return json({message:'Dados inválidos.'},400)}
  const niche=String(body?.niche||'').trim(),city=String(body?.city||'').trim();
  if(!valid(niche)||!valid(city))return json({message:'Informe segmento e cidade válidos.'},400);
  if(body.goal&&body.goal!=='both')return json({message:'Modo disponível: Ambos.'},400);
  const queries=[...new Set(queryPlan(niche,city,body.neighborhoods))];
  const date=clock().toISOString(),day=date.slice(0,10),month=date.slice(0,7),redis=redisClient(env,fetcher);
  try{
   const scans=await redis(['EVAL',QUOTA_LUA,2,'ricky:local:scans2:day:'+day,'ricky:local:scans2:month:'+month,DAY_SCANS,MONTH_SCANS]);
   if(!Array.isArray(scans)||scans[0]!==1)return json({message:'Limite de varreduras atingido. Nenhuma chamada enviada.'},429);
  }catch{return json({message:'Sem acesso ao limitador; busca bloqueada para proteger os custos.'},503)}
  let all=[],ids=new Set(),calls=0,stopReason='exhausted',usage=null,pages=0,areaCalls=0;
  const started=Date.now();
  outer:for(let qi=0;qi<queries.length;qi++){
   let pageToken='',page=0;
   do{
    if(calls>=MAX_PER_SCAN){stopReason='scan_limit';break outer}
    if(Date.now()-started>=37000){stopReason='time_limit';break outer}
    let reservation;
    try{reservation=await redis(['EVAL',QUOTA_LUA,2,'ricky:local:calls2:day:'+day,'ricky:local:calls2:month:'+month,DAY_CALLS,MONTH_CALLS])}
    catch{stopReason='quota_unavailable';break outer}
    if(!Array.isArray(reservation)||reservation[0]!==1){stopReason='quota_limit';break outer}
    usage={daily:reservation[1],monthly:reservation[2],dailyLimit:DAY_CALLS,monthlyLimit:MONTH_CALLS};
    const query={textQuery:queries[qi],pageSize:20,languageCode:'pt-BR',regionCode:'BR',...(pageToken?{pageToken}:{})};
    calls++;if(qi===0)pages++;else areaCalls++;
    try{
     const res=await fetcher('https://places.googleapis.com/v1/places:searchText',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'Content-Type':'application/json','X-Goog-Api-Key':env.GOOGLE_PLACES_API_KEY,'X-Goog-FieldMask':FIELD_MASK},
      body:JSON.stringify(query)
     });
     if(!res.ok){stopReason='provider_error';break outer}
     const data=await res.json();
     for(const raw of Array.isArray(data.places)?data.places:[]){
      const p=normalizePlace(raw);
      if(!p.place_id||!p.name||ids.has(p.place_id))continue;
      ids.add(p.place_id);all.push(assessCandidate(p));
     }
     if(all.filter(p=>p.candidate).length>=TARGET&&all.filter(p=>p.match_type==='landing').length>=10){stopReason='target_reached';break outer}
     page++;
     pageToken=qi===0&&page<3&&typeof data.nextPageToken==='string'?data.nextPageToken:'';
    }catch{stopReason='provider_error';break outer}
   }while(pageToken);
  }
  const group=new Map();
  for(const p of all){
   const n=p.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(?:barbearia|unidade|loja)\b/g,'').replace(/[^a-z0-9]/g,'').slice(0,38);
   p.chain_group=n;p.chain_hint=false;if(n)group.set(n,(group.get(n)||0)+1);
  }
  for(const p of all)p.chain_hint=!!p.chain_group&&group.get(p.chain_group)>1;
  // Select up to 40 mixed candidates, without claiming bot demand is verified.
  const possibleLanding=all.filter(p=>p.candidate&&p.match_type==='landing');
  const possibleBot=all.filter(p=>p.candidate&&p.match_type==='bot_investigate');
  const selectedLanding=possibleLanding.slice(0,Math.min(20,TARGET));
  const selectedBot=possibleBot.slice(0,TARGET-selectedLanding.length);
  if(selectedLanding.length+selectedBot.length<TARGET)selectedLanding.push(...possibleLanding.slice(selectedLanding.length,TARGET-selectedBot.length));
  const qualified=[...selectedLanding,...selectedBot].slice(0,TARGET);
  return json({results:[...qualified,...all.filter(p=>!p.candidate)],provider:'Google Places',goal:'both',target:TARGET,
   matched:qualified.length,eligibleDiscovered:possibleLanding.length+possibleBot.length,landingMatches:selectedLanding.length,botLeadsToInvestigate:selectedBot.length,unique:all.length,calls,stopReason,checkedAt:clock().toISOString(),
   source:{pages,neighborhoodQueries:areaCalls,areas:queries.slice(1)},usage:usage||{dailyLimit:DAY_CALLS,monthlyLimit:MONTH_CALLS},
   disclaimer:'Landing e bot são hipóteses comerciais. Site não informado não comprova ausência; celular não confirma WhatsApp; atendimento manual não foi confirmado. Cada página é uma chamada da API.'});
 };
}
export default {fetch:createHandler()};
