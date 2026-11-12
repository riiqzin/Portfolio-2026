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
const REFILL=\`local d=tonumber(redis.call('GET',KEYS[1]) or '0')
local m=tonumber(redis.call('GET',KEYS[2]) or '0')
if d>=tonumber(ARGV[1]) or m>=tonumber(ARGV[2]) then return {0,d,m} end
redis.call('INCR',KEYS[1]); redis.call('EXPIRE',KEYS[1],172800)
redis.call('INCR',KEYS[2]); redis.call('EXPIRE',KEYS[2],5356800)
return {1,d+1,m+1}\`;
export function createHandler({env=process.env,fetcher=fetch}={}){
 return async request=>{
  if(!['GET','POST'].includes(request.method))return json({message:'Método não permitido.'},405);
  if(!authorized(request,env))return json({message:'Não autorizado.'},401);
  const key=env.GOOGLE_PLACES_API_KEY;
  if(request.method==='GET')return json({ready:!!key&&configured(env),provider:'Google Places (New)',defaultLimit:20,dailyLimit:Math.min(20,Math.max(1,Number(env.LOCAL_RADAR_DAILY_LIMIT)||5)),monthlyLimit:Math.min(300,Math.max(1,Number(env.LOCAL_RADAR_MONTHLY_LIMIT)||100))});
  if(!key)return json({message:'Google Places ainda não configurado. Adicione GOOGLE_PLACES_API_KEY à Vercel para habilitar buscas reais.'},503);
  if(!configured(env))return json({message:'Controle de consultas indisponível.'},503);
  let body;
  try{body=JSON.parse(await boundedText(request,1500))}catch{return json({message:'Dados inválidos.'},400)}
  const niche=String(body?.niche||'').trim(),city=String(body?.city||'').trim();
  if(niche.length<3||niche.length>80||city.length<2||city.length>80||!(/^[\p{L}\p{N}\s,.'’&()-]+$/u.test(niche+' '+city)))return json({message:'Preencha segmento e cidade válidos.'},400);
  const dailyLimit=Math.min(20,Math.max(1,Number(env.LOCAL_RADAR_DAILY_LIMIT)||5));
  const monthlyLimit=Math.min(300,Math.max(1,Number(env.LOCAL_RADAR_MONTHLY_LIMIT)||100));
  try{
   const redis=redisClient(env,fetcher),date=new Date().toISOString();
   const limit=await redis(['EVAL',REFILL,2,'ricky:local:day:'+date.slice(0,10),'ricky:local:month:'+date.slice(0,7),dailyLimit,monthlyLimit]);
   if(!Array.isArray(limit)||limit[0]!==1)return json({message:'Limite de varreduras locais atingido. Nenhuma busca adicional foi feita.'},429);
   const response=await fetcher('https://places.googleapis.com/v1/places:searchText',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(14000),
    headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,
     'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.businessStatus,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri'},
    body:JSON.stringify({textQuery:niche+' em '+city,languageCode:'pt-BR',regionCode:'BR',pageSize:20})
   });
   if(!response.ok)return json({message:'Google Places não respondeu à varredura. Verifique a chave, a API ativa e as restrições de faturamento.'},502);
   const payload=await response.json(),all=(Array.isArray(payload.places)?payload.places:[]).map(normalizePlace).filter(p=>p.place_id&&p.name);
   const byName=new Map();
   for(const p of all){const normalized=p.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(?:unidade|loja|barbearia)\b/g,'').replace(/[^a-z0-9]/g,'').slice(0,35);byName.set(normalized,(byName.get(normalized)||0)+1);p.chain_hint=false;p.chain_group=normalized;}
   for(const p of all)p.chain_hint=byName.get(p.chain_group)>1;
   return json({results:all,provider:'Google Places',checkedAt:new Date().toISOString(),usage:{daily:limit[1],monthly:limit[2],dailyLimit,monthlyLimit},disclaimer:'URLs, notas, telefones e status são informações fornecidas pelo Google. Celular não comprova WhatsApp; sem website cadastrado não comprova inexistência de site.'});
  }catch{return json({message:'Não foi possível consultar o Google Places. Nenhum resultado inventado foi retornado.'},503)}
 };
}
export default {fetch:createHandler()};