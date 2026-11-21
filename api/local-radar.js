import {authorized,boundedText,json} from '../lib/radar-control.js';

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
 const phone=String(place.internationalPhoneNumber||place.nationalPhoneNumber||'').slice(0,45);
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

const MAX_PER_SCAN=8,TARGET=40;
const FIELD_MASK='nextPageToken,places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.businessStatus,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.googleMapsUri';
const valid=s=>typeof s==='string'&&s.length>=2&&s.length<=80&&/^[\p{L}\p{N}\s,.'’&()-]+$/u.test(s);
const isSP=/^s[aã]o paulo(?:,\s*sp)?$/i;
const COUNTRIES={
 BR:{name:'Brasil',region:'BR',language:'pt-BR'},IT:{name:'Italia',region:'IT',language:'it'},PT:{name:'Portugal',region:'PT',language:'pt-PT'},US:{name:'United States',region:'US',language:'en'},ES:{name:'España',region:'ES',language:'es'},FR:{name:'France',region:'FR',language:'fr'},
 DE:{name:'Deutschland',region:'DE',language:'de'},GB:{name:'United Kingdom',region:'GB',language:'en'},CH:{name:'Schweiz',region:'CH',language:'de'},AT:{name:'Österreich',region:'AT',language:'de'},NL:{name:'Nederland',region:'NL',language:'nl'},BE:{name:'Belgique',region:'BE',language:'fr'},IE:{name:'Ireland',region:'IE',language:'en'},CA:{name:'Canada',region:'CA',language:'en'},AR:{name:'Argentina',region:'AR',language:'es'},MX:{name:'México',region:'MX',language:'es'},CL:{name:'Chile',region:'CL',language:'es'},UY:{name:'Uruguay',region:'UY',language:'es'},JP:{name:'日本',region:'JP',language:'ja'},AU:{name:'Australia',region:'AU',language:'en'},NZ:{name:'New Zealand',region:'NZ',language:'en'}
};
export function assessCandidate(p){
 const closed=p.business_status==='CLOSED_PERMANENTLY';
 const contact=!!p.phone||['social','whatsapp'].includes(p.link_type);
 const landing=['none','social','bio','whatsapp'].includes(p.link_type);
 const bot=['own','booking','unknown'].includes(p.link_type);
 return {...p,candidate:!closed&&contact&&(landing||bot),
  match_type:closed||!contact?'research':landing?'landing':'bot_investigate',
  reason:closed?'Estabelecimento marcado como fechado no Google.':!contact?'Nenhum contato comercial identificado.':landing?'Link público pode indicar oportunidade de landing; site próprio não verificado.':'Contato identificado; atendimento manual e necessidade de bot ainda não verificados.'};
}
function queryPlan(niche,city,neighborhoods,country){
 const areas=Array.isArray(neighborhoods)?neighborhoods.filter(valid).slice(0,5):[];
 // Different neighborhoods surface a broader variety than pages of one city-wide relevance ranking.
 if(!areas.length&&country.region==='BR'&&isSP.test(city))areas.push('Itaquera','Penha','Santana','Vila Prudente','Santo Amaro');
 const locality=city+', '+country.name;
 const local=areas.filter(x=>x.toLowerCase()!==city.toLowerCase()).map(x=>niche+' '+x+', '+locality);
 return [...local,niche+' '+locality];
}
function diverseByReviews(rows){
 const buckets=[[],[],[],[]];
 for(const row of rows){
  const n=Number(row.reviews);
  const group=row.reviews==null||!Number.isFinite(n)?3:n<10?0:n<30?1:n<100?2:3;
  buckets[group].push(row);
 }
 const out=[];
 while(buckets.some(group=>group.length)){
  for(const group of buckets)if(group.length)out.push(group.shift());
 }
 return out;
}
export function createHandler({env=process.env,fetcher=fetch,clock=()=>new Date()}={}){
 return async request=>{
  if(!['GET','POST'].includes(request.method))return json({message:'Método não permitido.'},405);
  if(!authorized(request,env))return json({message:'Não autorizado.'},401);
  if(request.method==='GET')return json({ready:!!env.GOOGLE_PLACES_API_KEY,provider:'Google Places (New)',goal:'both',target:TARGET,maxCallsPerScan:MAX_PER_SCAN,unlimitedScans:true});
  if(!env.GOOGLE_PLACES_API_KEY)return json({message:'Google Places não configurado.'},503);
  let body;try{body=JSON.parse(await boundedText(request,2500))}catch{return json({message:'Dados inválidos.'},400)}
  const niche=String(body?.niche||'').trim(),city=String(body?.city||'').trim();
  const countryCode=String(body?.countryCode||'BR').trim().toUpperCase();
  const country=COUNTRIES[countryCode];
  if(!country)return json({message:'País não suportado. Escolha uma opção da lista.'},400);
  if(!valid(niche)||!valid(city))return json({message:'Informe segmento e cidade válidos.'},400);
  if(body.goal&&body.goal!=='both')return json({message:'Modo disponível: Ambos.'},400);
  const queries=[...new Set(queryPlan(niche,city,body.neighborhoods,country))];
  let all=[],ids=new Set(),calls=0,stopReason='exhausted',pages=0,areaCalls=0;
  const started=Date.now();
  outer:for(let qi=0;qi<queries.length;qi++){
   let pageToken='',page=0;
   do{
    if(calls>=MAX_PER_SCAN){stopReason='scan_limit';break outer}
    if(Date.now()-started>=37000){stopReason='time_limit';break outer}
    const query={textQuery:queries[qi],pageSize:20,languageCode:country.language,regionCode:country.region,...(pageToken?{pageToken}:{})};
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
      const p=normalizePlace(raw);p.country_code=countryCode;if(countryCode!=='BR')p.mobile_probable=false;
      if(!p.place_id||!p.name||ids.has(p.place_id))continue;
      ids.add(p.place_id);all.push(assessCandidate(p));
     }
     if(all.filter(p=>p.candidate).length>=TARGET&&all.filter(p=>p.match_type==='landing').length>=10){stopReason='target_reached';break outer}
     page++;
     pageToken=qi===queries.length-1&&page<3&&typeof data.nextPageToken==='string'?data.nextPageToken:'';
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
  const possibleLanding=diverseByReviews(all.filter(p=>p.candidate&&p.match_type==='landing'));
  const possibleBot=diverseByReviews(all.filter(p=>p.candidate&&p.match_type==='bot_investigate'));
  const selectedLanding=possibleLanding.slice(0,Math.min(20,TARGET));
  const selectedBot=possibleBot.slice(0,TARGET-selectedLanding.length);
  if(selectedLanding.length+selectedBot.length<TARGET)selectedLanding.push(...possibleLanding.slice(selectedLanding.length,TARGET-selectedBot.length));
  const qualified=[...selectedLanding,...selectedBot].slice(0,TARGET);
  return json({results:[...qualified,...all.filter(p=>!p.candidate)],provider:'Google Places',countryCode,languageCode:country.language,goal:'both',target:TARGET,
   matched:qualified.length,eligibleDiscovered:possibleLanding.length+possibleBot.length,landingMatches:selectedLanding.length,botLeadsToInvestigate:selectedBot.length,unique:all.length,calls,stopReason,checkedAt:clock().toISOString(),
   source:{pages,neighborhoodQueries:areaCalls,areas:queries.slice(1)},usage:{unlimitedScans:true,maxCallsPerScan:MAX_PER_SCAN},
   disclaimer:'Landing e bot são hipóteses comerciais. Site não informado não comprova ausência; celular não confirma WhatsApp; atendimento manual não foi confirmado. Cada página é uma chamada da API.'});
 };
}
export default {fetch:createHandler()};
