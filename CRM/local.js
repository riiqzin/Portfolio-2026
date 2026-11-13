/* Ricky Local — evidence-first private CRM. Public Places data is never treated as human verification. */
(()=>{
'use strict';
const API_BASE='https://crjnawbtlwtruwwzbkzk.supabase.co/rest/v1/rpc/';
const API_KEY='sb_publishable_jI_JTaDvip_9t9qCTNqzqQ_eGH03OiR';
const KEY_NAME='ricky_crm_dashboard_key';
const $=sel=>document.querySelector(sel);
const $$=sel=>[...document.querySelectorAll(sel)];
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dom=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x};
const now=()=>new Date().toISOString();
const formatDate=v=>v?new Date(v).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}):'';
const daysSince=v=>v?Math.floor((Date.now()-Date.parse(v))/86400000):0;
const formatStars=v=>Number.isFinite(Number(v))&&v!==null&&v!==''?Number(v).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}):'—';
const placeholder=(title,description)=>'<div class="action-card"><div class="action-left"><div class="action-icon">✧</div><div class="action-copy"><strong>'+escapeHTML(title)+'</strong><p>'+escapeHTML(description)+'</p></div></div></div>';
const prefsKey='ricky:local:archive-v1';
const state={key:localStorage.getItem(KEY_NAME)||sessionStorage.getItem(KEY_NAME)||'',leads:[],results:[],niche:'Barbearias',city:'São Paulo, SP',filterOutside:false,offerFilter:'all',todayFilter:'all',current:null,draft:null,editing:false,placesReady:false,scanning:false,archive:[],gmail:{connected:false,canSend:false,items:[]},emailQueue:[],pendingSend:false,toastTimer:0,sequence:0,lastGmailSync:0,aiBusy:false,aiDraftEpoch:0};
const VERIFY=[
 ['whatsapp_confirmed','WhatsApp confirmado (conferi o perfil)'],
 ['instagram_found','Tem Instagram (confirmei)'],
 ['instagram_missing','Não encontrei Instagram (verifiquei)'],
 ['booking_in_bio','Bio tem link de agendamento'],
 ['generic_booking','Usa plataforma de agendamento genérica'],
 ['site_mobile_ok','Site próprio funciona bem no celular'],
 ['manual_booking','Atendimento ou agendamento parece manual'],
 ['no_online_booking','Confirmei que não oferece agendamento online'],
 ['active_confirmed','Negócio parece ativo (conferi)'],
 ['possible_chain','Possível rede ou franquia'],
 ['top','Cliente prioritário'],
 ['demo_ready','Já preparei e conferi a demonstração']
];
const STATUSES={novo:'Novo',abordado:'Abordado',respondeu:'Respondeu',interessado:'Interessado',proposta:'Proposta enviada',fechou:'Fechou',sem_interesse:'Sem interesse'};
const TEMPLATES=[
 ['A · Landing page','Oi, tudo bem? Vi a {{empresa}} no Google e fiquei com uma ideia.\n{{observacao}}\nSou o Henrique, crio páginas para negócios locais. Posso te mostrar como ficaria?'],
 ['B · Bot de WhatsApp','Oi, aqui é o Henrique! Uma pergunta rápida: vocês perdem muito tempo respondendo preços e horários pelo WhatsApp?\nFaço assistentes que ajudam com essas perguntas e deixam o atendimento mais leve.\nPosso te mostrar uma ideia para a {{empresa}}?'],
 ['C · Mostrar antes','Oi! Aqui é o Henrique. Vi a {{empresa}} e preparei um rascunho de página para vocês.\nFiz por conta própria, sem compromisso, e posso mandar a imagem.\nPosso te mostrar?'],
 ['Follow-up 1','Oi! Passando só pra saber se você chegou a ver minha mensagem.\nSe não fizer sentido agora, tudo bem!'],
 ['Follow-up 2','Oi! Última mensagem por aqui pra não incomodar.\nSe um dia quiser ver um exemplo, é só me chamar. Sucesso com a {{empresa}}!'],
 ['Resposta · Pode mandar','Claro! Posso te mandar um exemplo rápido e você me diz se faz sentido para a {{empresa}}?'],
 ['Resposta · Quanto custa','Para essa proposta, o valor é {{preco}} e o prazo é {{prazo}}. Posso te explicar o que está incluído?'],
 ['Resposta · Sem interesse','Tudo bem, agradeço por responder! Não vou insistir. Sucesso com a {{empresa}}!']
];
function toast(msg){const x=$('#toast');x.textContent=msg;x.classList.add('show');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>x.classList.remove('show'),4100)}
function key(){return state.key||''}
async function rpc(fn,data){
 const response=await fetch(API_BASE+encodeURIComponent(fn),{method:'POST',headers:{apikey:API_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_key:key(),...data}),signal:AbortSignal.timeout(25000)});
 const json=await response.json().catch(()=>null);
 if(!response.ok)throw Error(json?.message||json?.hint||'Erro no banco de dados');
 return json;
}
async function backend(path,method='GET',body){
 const response=await fetch('/api/'+path,{method,headers:{Authorization:'Bearer '+key(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(path==='local-radar'&&method==='POST'?57000:32000)});
 const data=await response.json().catch(()=>({message:'Resposta inesperada do servidor'}));
 if(!response.ok)throw Error(data.message||'Serviço indisponível.');
 return data;
}
function loadArchive(){try{const a=JSON.parse(localStorage.getItem(prefsKey)||'[]');return Array.isArray(a)?a.slice(0,20):[]}catch{return []}}
state.archive=loadArchive();
function archiveSearch(meta){
 state.archive=[{id:Date.now(),niche:meta.niche,city:meta.city,count:meta.count,date:now()},...state.archive].slice(0,20);
 try{localStorage.setItem(prefsKey,JSON.stringify(state.archive))}catch{}
}
function normalizePhone(phone){
 let digits=String(phone||'').replace(/\D/g,'');
 if(digits.startsWith('00'))digits=digits.slice(2);
 if(digits.startsWith('55')&&digits.length>=12)digits=digits.slice(2);
 if(digits.length!==10&&digits.length!==11)return '';
 return '55'+digits;
}
function websiteType(url){
 if(!url)return 'none';
 try{const host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');
 if(/^(instagram\.com|facebook\.com|m\.facebook\.com|tiktok\.com)$/.test(host))return 'social';
 if(/^(linktr\.ee|beacons\.ai|bio\.link|taplink\.cc|linkme\.bio)$/.test(host))return 'bio';
 if(/^(wa\.me|api\.whatsapp\.com|whatsapp\.com)$/.test(host))return 'whatsapp';
 if(/^(trinks\.com|booksy\.com|booksy\.com\.br|appbarber\.com|calendly\.com|avec\.app|agendaai\.com\.br)$/.test(host))return 'booking';
 return 'own'
 }catch{return 'unknown'}
}
function siteLabel(type){return ({none:'Nenhum site informado',social:'Rede social como site',bio:'Página de links',whatsapp:'WhatsApp como site',booking:'Agendamento externo',own:'Domínio próprio',unknown:'Link não reconhecido'})[type]||'Não verificado'}
function eligible(c){
 if(c.business_status==='CLOSED_PERMANENTLY')return false;
 const rating=typeof c.rating==='number'?c.rating:NaN,reviews=Number(c.reviews);
 const minR=Number($('#minRating').value),minN=Number($('#minReviews').value);
 return Number.isFinite(rating)&&rating>=minR&&Number.isFinite(reviews)&&reviews>=minN;
}
function priority(c){
 const v=c.verified||{};
 if(c.business_status==='CLOSED_PERMANENTLY')return {type:'baixa',why:'Cadastro indica fechamento permanente.'};
 if(c.business_status==='CLOSED_TEMPORARILY')return {type:'investigar',why:'O Google informa fechamento temporário; confirme se voltou a funcionar.'};
 if(v.possible_chain)return {type:'baixa',why:'Você marcou possível rede ou franquia; confirme quem decide as contratações.'};
 if(c.chain_hint)return {type:'investigar',why:'Nome parecido com outro estabelecimento; confirme se é rede antes de abordar.'};
 if(v.site_mobile_ok)return {type:'baixa',why:'Você confirmou que o site já funciona bem no celular.'};
 const contact=!!normalizePhone(c.phone)||['social','whatsapp'].includes(c.link_type);
 if(!c.place_id&&!c.maps_url)return {type:'investigar',why:'Cadastro manual: confirme a presença digital e o canal antes da abordagem.'};
 if(['none','social','bio','whatsapp'].includes(c.link_type)&&contact)return {type:'alta',why:c.link_type==='none'?'O Google não informa um site; investigar presença digital antes da abordagem.':'O link cadastrado é '+siteLabel(c.link_type).toLowerCase()+'; site próprio ainda não confirmado.'};
 if(c.link_type==='booking'&&contact)return {type:'investigar',why:'Já usa agendamento externo; uma landing pode fortalecer a marca sem substituir reservas.'};
 if(c.link_type==='own')return {type:'investigar',why:'Existe um domínio cadastrado. Verifique se há oportunidade real de melhoria.'};
 return {type:'investigar',why:'Faltam evidências para classificar este negócio com segurança.'};
}
function offerFor(c){
 const v=c.verified||{};
 if(v.possible_chain||v.site_mobile_ok)return {blocked:true,offer:'landing',angle:'A',why:'Revisão recomendada antes de preparar uma nova oferta.'};
 if(v.manual_booking||(v.whatsapp_confirmed&&v.no_online_booking))return {blocked:false,offer:'bot',angle:'B',why:'Atendimento manual verificado: bot pode reduzir perguntas repetitivas.'};
 if(['none','social','bio','whatsapp','booking'].includes(c.link_type))return {blocked:false,offer:'landing',angle:'A',why:'Presença própria não confirmada ou depende de página externa. Oferta de landing page adequada para investigar.'};
 return {blocked:false,offer:'landing',angle:'A',why:'Sem oportunidade confirmada. Verifique o negócio antes de enviar.'};
}
function evidencePhrase(c){
 const type=c.link_type,v=c.verified||{};
 if(type==='social')return 'Vi que o link cadastrado no Google leva a uma rede social; uma página própria poderia reunir serviços e agendamentos.';
 if(type==='bio')return 'Vi que o link no Google leva a uma página de links; pensei numa página própria para apresentar melhor o negócio.';
 if(type==='booking')return 'Vi que vocês usam uma plataforma externa de agendamento; pensei numa página com a identidade da barbearia que leva direto às reservas.';
 if(type==='whatsapp')return 'Vi que o link cadastrado no Google abre o WhatsApp; uma página poderia reunir serviços, preços e localização antes do contato.';
 if(type==='none')return (c.place_id||c.maps_url)?'Não encontrei um link de site cadastrado no Google; queria entender onde novos clientes veem serviços e agendamentos.':'Queria entender onde seus novos clientes podem conhecer serviços e agendar horários.';
 if(v.site_mobile_ok)return 'Vi que o site de vocês funciona bem no celular.';
 return 'Encontrei a empresa no Google e fiquei curioso sobre como vocês recebem novos agendamentos.';
}
function praise(c){
 if(typeof c.rating!=='number'&&(!c.rating||!Number.isFinite(Number(c.rating))))return 'Vi a '+c.name+' no Google.';
 const suffix=Number(c.reviews)>=30?' com '+c.reviews+' avaliações':'';
 return 'Vi a '+c.name+' no Google, nota '+formatStars(c.rating)+suffix+'.';
}
function templateMessage(c){
 const angle=c.angle||'A';
 if(c.followup_count>=2&&c.status==='abordado')return TEMPLATES[4][1].replaceAll('{{empresa}}',c.name);
 if(c.followup_count===1&&c.status==='abordado')return TEMPLATES[3][1].replaceAll('{{empresa}}',c.name);
 if(angle==='C'){
  if(!c.verified?.top||!c.verified?.demo_ready)return '';
  return 'Oi! Aqui é o Henrique. '+praise(c)+'\nPreparei um rascunho de como poderia ser a página de vocês.\nPosso te mostrar?';
 }
 if(angle==='B'||c.offer==='bot'){
  return 'Oi, aqui é o Henrique! Pergunta rápida: vocês gastam muito tempo respondendo preços e horários no WhatsApp?\nMonto assistentes que ajudam com essas perguntas e facilitam o atendimento.\nPosso te mostrar uma ideia para a '+c.name+'?';
 }
 return 'Oi, tudo bem? '+praise(c)+'\n'+evidencePhrase(c)+'\nSou o Henrique, faço páginas para negócios locais. Posso te mostrar uma ideia para vocês?';
}
function dueFor(c){
 return c.status==='abordado'&&c.followup_at&&Date.parse(c.followup_at)<=Date.now()&&Number(c.followup_count)<2;
}
function getTodos(){
 const todos=[];
 for(const c of state.leads){
  if(c.status==='novo')todos.push({c,type:'new',label:'Preparar abordagem',detail:'Ainda não abordado · escolha um ângulo e revise a mensagem',order:2});
  else if(dueFor(c))todos.push({c,type:'followup',label:'Follow-up pendente',detail:'Último contato há '+daysSince(c.contacted_at)+' dias · confira a conversa antes de enviar',order:0});
  else if(['respondeu','interessado'].includes(c.status))todos.push({c,type:'reply',label:c.status==='interessado'?'Oportunidade quente':'Responder contato',detail:'A conversa precisa de uma próxima ação',order:1});
  else if(c.status==='proposta'&&c.followup_at&&Date.parse(c.followup_at)<=Date.now())todos.push({c,type:'reply',label:'Acompanhar proposta',detail:'Já passaram quatro dias desde a proposta · confira a conversa',order:1});
 }
 return todos.sort((a,b)=>a.order-b.order||new Date(b.c.updated_at)-new Date(a.c.updated_at));
}
function setNav(){
 let page=(location.hash||'#central').replace('#','');
 if(!['central','radar','hoje','clientes','custos'].includes(page))page='central';
 $$('.page').forEach(x=>x.hidden=x.id!=='page-'+page);
 $$('[data-nav]').forEach(a=>{a.classList.toggle('active',a.dataset.nav===page);if(a.dataset.nav===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
 $('#headerSection').textContent=({central:'Central',radar:'Radar Local',hoje:'Pra Hoje',clientes:'Clientes',custos:'Custos & APIs'})[page];
 if(page==='hoje')loadGmail(true);
 if(page==='custos'&&state.key)void loadCosts();
}
async function refresh(){
 const list=await rpc('crm_local_list',{});
 state.leads=Array.isArray(list)?list:[];
 $('#connectionState').innerHTML='<i></i> Sincronizado';
 $('#connectionState').classList.remove('error');
 render();
}
async function signIn(){
 const candidate=$('#loginKey').value.trim();
 if(!candidate){$('#loginError').textContent='Informe a chave.';return}
 state.key=candidate;
 try{
  await refresh();
  ( $('#rememberKey').checked?localStorage:sessionStorage).setItem(KEY_NAME,candidate);
  ( $('#rememberKey').checked?sessionStorage:localStorage).removeItem(KEY_NAME);
  $('#authOverlay').hidden=true;
  $('#loginError').textContent='';
  checkPlaces();
  if(location.hash==='#custos')void loadCosts();
 }catch(e){state.key='';$('#loginError').textContent='Não foi possível entrar. Verifique a chave.';}
}
function showLogin(){
 $('#authOverlay').hidden=false;
 $('#connectionState').innerHTML='<i></i> Aguardando acesso';
}
function actionCard(item){
 const article=dom('article','action-card');
 const left=dom('div','action-left'),icon=dom('div','action-icon',item.type==='followup'?'↻':item.type==='reply'?'✉':'✦'),copy=dom('div','action-copy');
 copy.append(dom('strong','',item.c.name),dom('p','',item.detail));
 left.append(icon,copy);
 const btn=dom('button','btn btn-outline compact',item.label+' ↗');btn.type='button';btn.addEventListener('click',()=>openLead(item.c));article.append(left,btn);
 return article;
}
function renderCentral(){
 const todos=getTodos(),contacted=state.leads.filter(c=>c.contacted_at).length,replies=state.leads.filter(c=>c.ever_responded||['respondeu','interessado','proposta','fechou','sem_interesse'].includes(c.status)).length,wins=state.leads.filter(c=>c.status==='fechou').length;
 $('#statLeads').textContent=state.leads.length;$('#statToday').textContent=todos.length;$('#statReplies').textContent=replies;$('#statWon').textContent=wins;
 $('#navTodayCount').textContent=todos.length;$('#navTodayCount').hidden=!todos.length;
 const area=$('#centralActions');area.replaceChildren();
 if(!todos.length)area.innerHTML=placeholder('Tudo em ordem','Adicione negócios pelo Radar e suas próximas ações aparecerão aqui.');
 else todos.slice(0,5).forEach(x=>area.append(actionCard(x)));
 $('#experimentFill').style.width=Math.min(100,contacted/40*100)+'%';
 $('#experimentCount').textContent=contacted+' / 40';
 $('#experimentSummary').textContent=replies+' responderam · '+wins+' fecharam · resultados ainda exploratórios.';
}
function renderToday(){
 const area=$('#todayList');area.replaceChildren();
 const todos=getTodos().filter(x=>state.todayFilter==='all'||x.type===state.todayFilter);
 if(!todos.length)area.innerHTML=placeholder('Nada pendente nesta lista','Seu próximo contato aparece aqui depois que você salva uma oportunidade.');
 else todos.forEach(x=>area.append(actionCard(x)));
}
function renderClients(){
 const q=$('#clientSearch').value.trim().toLowerCase(),status=$('#clientStatus').value,area=$('#clientList');area.replaceChildren();
 const filtered=state.leads.filter(x=>(status==='all'||x.status===status)&&[x.name,x.city,x.phone,x.email].some(s=>String(s||'').toLowerCase().includes(q)));
 if(!filtered.length){area.innerHTML=placeholder('Nenhum negócio nesta lista','O Radar e o cadastro manual alimentam sua carteira.');return}
 for(const c of filtered){
  const row=dom('article','client-row');
  const left=dom('div','client-main'),avatar=dom('div','client-avatar',c.name.slice(0,1).toUpperCase()),label=dom('div');
  label.append(dom('strong','',c.name),dom('span','',c.city||'Localidade não informada'));
  left.append(avatar,label);
  const right=dom('div','client-meta'),tag=dom('small','',STATUSES[c.status]||'Novo'),btn=dom('button','btn btn-outline compact','Abrir ↗');
  btn.onclick=()=>openLead(c);right.append(tag,btn);row.append(left,right);area.append(row);
 }
}
function renderArchive(){
 const box=$('#radarArchive');box.replaceChildren();
 if(!state.archive.length){box.innerHTML=placeholder('Nenhuma varredura salva','Salvamos data, segmento e cidade — não copiamos os dados do Google Maps para o histórico.');return}
 for(const a of state.archive){
  const b=dom('button','archive-item');b.type='button';
  b.append(dom('small','',formatDate(a.date)+' · GOOGLE PLACES'),dom('strong','',a.niche+' / '+a.city),dom('span','',a.count+' candidatos na busca original · repetir consulta ↗'));
  b.title='O histórico conserva apenas os parâmetros e a quantidade, não os candidatos antigos. Repetir consome sua cota de API.';
  b.addEventListener('click',async()=>{
   if(state.scanning){toast('Aguarde a varredura atual terminar.');return}
   $('#localNiche').value=a.niche;$('#localCity').value=a.city;
   // Os bairros não eram salvos nas entradas antigas; não reutilizar bairros de outra pesquisa.
   $('#localAreas').value='';
   if(!state.placesReady){$('#localForm').scrollIntoView({behavior:'smooth',block:'start'});toast('Busca preenchida. Conecte o Google Places para executar.');return}
   if(!confirm('Esta sessão antiga guarda apenas a pesquisa e o total de candidatos; a lista original não foi salva.\\n\\nDeseja executar uma NOVA varredura de '+a.niche+' em '+a.city+'? Os resultados podem mudar e a consulta consumirá sua cota do Google Places.'))return;
   $('#radarProgress').scrollIntoView({behavior:'smooth',block:'center'});
   await scan({preventDefault(){}});
   $('#radarResults').scrollIntoView({behavior:'smooth',block:'start'});
  });
  box.append(b);
 }
}
function resultsReason(c){
 const p=priority(c);
 return p.why;
}
function resultCard(c,i){
 const art=dom('article','prospect');art.style.animationDelay=Math.min(i*55,650)+'ms';
 const head=dom('div','prospect-top');head.append(dom('span','prospect-index','CANDIDATO '+String(i+1).padStart(2,'0')),dom('span','priority '+priority(c).type,({alta:'ALTA PRIORIDADE',investigar:'INVESTIGAR',baixa:'BAIXA PRIORIDADE'})[priority(c).type]));
 art.append(head,dom('h3','',c.name),dom('p','prospect-sub',c.city||'Endereço não informado'));
 const metrics=dom('div','prospect-metrics');
 metrics.append(dom('span','','★ '+formatStars(c.rating)+' · '+(c.reviews??'—')+' avaliações'),dom('span','',siteLabel(c.link_type)),dom('span','',c.mobile_probable?'Celular provável':c.phone?'Telefone público':'Sem telefone'));
 const offer=dom('span','prospect-offer',c.match_type==='landing'?'LANDING · INDÍCIO':c.match_type==='bot_investigate'?'BOT · A VERIFICAR':'SEM CANAL CONFIRMADO');
 offer.classList.add(c.match_type==='landing'?'landing':c.match_type==='bot_investigate'?'bot':'research');
 art.append(offer);
 art.append(metrics);
 const insight=dom('div','prospect-insight');insight.append(dom('strong','',c.business_status==='CLOSED_PERMANENTLY'?'Fechado permanentemente':'Por que investigar?'),dom('p','',resultsReason(c)));
 art.append(insight);
 const actions=dom('div','prospect-actions');
 const saved=state.leads.some(lead=>lead.place_id&&lead.place_id===c.place_id);
 const open=dom('button','btn btn-primary compact',saved?'Abrir na carteira':'Salvar / verificar'),site=dom('a','btn btn-outline compact','Ver link ↗');
 open.type='button';open.addEventListener('click',()=>openLead(c));
 if(c.website||c.maps_url){site.href=safeUrl(c.website)||safeUrl(c.maps_url)||'#';site.target='_blank';site.rel='noopener noreferrer'}else{site.href='#';site.addEventListener('click',ev=>ev.preventDefault());site.setAttribute('aria-disabled','true')}
 actions.append(open,site);art.append(actions);
 return art;
}
function safeUrl(v){try{const u=new URL(String(v||''));return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null}catch{return null}}
function renderRadar(){
 const area=$('#radarResults');area.replaceChildren();
 const search=$('#radarSearch').value.trim().toLocaleLowerCase('pt-BR');
 const link=$('#radarLink').value, contact=$('#radarContact').value, reviews=$('#radarReviews').value, sort=$('#radarSort').value;
 const filtered=state.results.filter(c=>eligible(c)!==state.filterOutside)
  .filter(c=>state.filterOutside||c.candidate!==false)
  .filter(c=>state.offerFilter==='all'||(state.offerFilter==='landing'?c.match_type==='landing':c.match_type==='bot_investigate'))
  .filter(c=>!search||[c.name,c.city,c.address,c.website].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(search)))
  .filter(c=>link==='all'||(link==='other'?!['none','social','whatsapp','bio','booking','own'].includes(c.link_type):c.link_type===link))
  .filter(c=>contact==='all'||(contact==='phone'?!!normalizePhone(c.phone):contact==='email'?!!c.email:contact==='website'?!!c.website:!normalizePhone(c.phone)&&!c.email))
  .filter(c=>{const n=Number(c.reviews);if(reviews==='all')return true;if(!Number.isFinite(n)||c.reviews==null)return false;return reviews==='lt10'?n<10:reviews==='lt30'?n<30:reviews==='lt100'?n<100:n>=100});
 const rating=c=>c.rating==null||!Number.isFinite(Number(c.rating))?null:Number(c.rating);
 const count=c=>c.reviews==null||!Number.isFinite(Number(c.reviews))?null:Number(c.reviews);
 const compareNullable=(x,y,direction)=>x==null&&y==null?0:x==null?1:y==null?-1:direction*(x-y);
 filtered.sort((a,b)=>{
  if(sort==='rating_asc')return compareNullable(rating(a),rating(b),1);
  if(sort==='rating_desc')return compareNullable(rating(a),rating(b),-1);
  if(sort==='reviews_asc')return compareNullable(count(a),count(b),1);
  if(sort==='reviews_desc')return compareNullable(count(a),count(b),-1);
  if(sort==='name')return String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
  const weights={alta:2,investigar:1,baixa:0};
  return weights[priority(b).type]-weights[priority(a).type]||Number(b.reviews||0)-Number(a.reviews||0);
 });
 $('#radarMatchCount').textContent=filtered.length+' de '+state.results.length+' candidatos exibidos · filtros locais, sem novas chamadas';
 if(!state.results.length){area.innerHTML=placeholder('Pronto para encontrar oportunidades','Pesquise sua região. O Radar vai organizar candidatos sem inventar oportunidades.');return}
 if(!filtered.length){area.innerHTML=placeholder('Nenhum candidato com esses filtros','Altere os filtros, a nota mínima ou use Limpar filtros para ampliar a lista.');return}
 filtered.forEach((c,i)=>area.append(resultCard(c,i)));
}
function render(){renderCentral();renderToday();renderClients();renderArchive();renderRadar();}
async function checkPlaces(){
 try{const x=await backend('local-radar');state.placesReady=!!x.ready;
 $('#placesNotice').textContent=x.ready?'Google Places conectado · '+x.dailyLimit+' varreduras/dia · até '+x.maxCallsPerScan+' chamadas por busca · '+x.monthlyCallLimit+' chamadas/mês.':'Google Places ainda não configurado. Cadastro manual liberado; buscas ficam desabilitadas até configurar a chave na Vercel.';
 $('#placesNotice').classList.toggle('bad',!x.ready);$('#runLocal').disabled=!x.ready;
 }catch(e){$('#placesNotice').textContent=e.message;$('#placesNotice').classList.add('bad');$('#runLocal').disabled=true}
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function scan(ev){
 ev.preventDefault();if(state.scanning||!state.placesReady)return;
 state.scanning=true;state.filterOutside=false;
 $('#filterEligible').classList.add('active');$('#filterOutside').classList.remove('active');
 $('#runLocal').disabled=true;
 $('#radarProgress').hidden=false;$('#radarProgress').classList.add('busy');
 $('#scanProgressText').textContent='Consultando o Google Places…';$('#scanProgressCount').textContent='BUSCANDO';
 $('#scanProgressBar').style.width='0%';$('#radarExplain').textContent='Consultando estabelecimentos. Nenhuma classificação está sendo inventada.';
 state.results=[];renderRadar();
 try{
  const niche=$('#localNiche').value.trim(),city=$('#localCity').value.trim();
  const neighborhoods=$('#localAreas').value.split(',').map(x=>x.trim()).filter(Boolean).slice(0,5);
  const data=await backend('local-radar','POST',{niche,city,neighborhoods,goal:'both'});
  state.niche=niche;state.city=city;
  $('#radarProgress').classList.remove('busy');
  const all=(data.results||[]).filter(c=>!state.leads.some(lead=>lead.place_id&&lead.place_id===c.place_id));
  const alreadySaved=(data.results||[]).length-all.length;
  $('#scanProgressText').textContent='Resultados recebidos · classificando os links e contatos';
  for(let i=0;i<all.length;i++){
   state.results.push(all[i]);
   $('#scanProgressCount').textContent=(i+1)+' / '+all.length;
   $('#scanProgressBar').style.width=Math.round((i+1)/Math.max(1,all.length)*100)+'%';
   renderRadar();
   if(!matchMedia('(prefers-reduced-motion: reduce)').matches)await wait(85);
  }
  $('#scanProgressText').textContent='Busca ampliada concluída · '+data.calls+' consultas utilizadas';
  const landing=all.filter(x=>x.match_type==='landing').length,bot=all.filter(x=>x.match_type==='bot_investigate').length;
  const inside=all.filter(x=>eligible(x)&&x.candidate!==false).length;
  $('#radarExplain').textContent=data.unique+' negócios únicos encontrados · '+data.matched+' candidatos compatíveis ('+landing+' landing, '+bot+' bot a investigar) · '+inside+' dentro dos seus filtros · '+alreadySaved+' já na carteira excluídos. Meta: 40 (não garantida).';
  const reasons={target_reached:'Meta de 40 atingida',scan_limit:'Teto de chamadas da varredura',quota_limit:'Limite diário ou mensal de custo',time_limit:'Limite de tempo',exhausted:'Resultados disponíveis esgotados',provider_error:'A consulta foi interrompida pelo Google',quota_unavailable:'Controle de custos indisponível'};
  $('#radarUsage').textContent=(reasons[data.stopReason]||'Busca concluída')+' · '+(data.calls||0)+' chamadas ao Google · '+(data.usage?.daily??'—')+'/'+(data.usage?.dailyLimit??15)+' hoje · '+(data.usage?.monthly??'—')+'/'+(data.usage?.monthlyLimit??200)+' no mês. Candidatos de bot são hipóteses, não atendimento manual comprovado.';
  archiveSearch({niche,city,count:all.length});renderArchive();
  if(!all.length)toast('Nenhum estabelecimento retornado para esta busca.');
 }catch(e){$('#radarProgress').classList.remove('busy');$('#scanProgressText').textContent='Não foi possível concluir a busca';$('#radarExplain').textContent=e.message;toast(e.message)}
 finally{state.scanning=false;$('#runLocal').disabled=!state.placesReady;}
}
function blankLead(c={}){
 const base=offerFor(c);
 return {id:c.id||'',place_id:c.place_id||'',name:c.name||'',city:c.city||'',phone:c.phone||'',website:c.website||'',maps_url:c.maps_url||'',email:c.email||'',rating:c.rating??null,reviews:c.reviews??null,business_status:c.business_status||'UNKNOWN',link_type:c.link_type||websiteType(c.website),chain_hint:!!c.chain_hint,channel:c.channel||'whatsapp',status:c.status||'novo',priority:c.priority||priority(c).type,offer:c.offer||base.offer,angle:c.angle||base.angle,verified:{...(c.verified||{})},notes:c.notes||'',contacted_at:c.contacted_at||null,followup_at:c.followup_at||null,followup_count:c.followup_count||0,message_version:c.message_version||0,last_message:c.last_message||'',created_at:c.created_at,updated_at:c.updated_at};
}
function fromFields(){
 const d=state.draft;if(!d)return;
 d.name=$('#leadName').value.trim();d.city=$('#leadCity').value.trim();d.phone=$('#leadPhone').value.trim();d.website=$('#leadWebsite').value.trim();d.email=$('#leadEmail').value.trim();d.channel=$('#leadChannel').value;
 d.link_type=websiteType(d.website);
 d.offer=$('#leadOffer').value;d.angle=$('#leadAngle').value;d.notes=$('#leadNotes').value.trim();
 d.last_message=$('#leadMessage').value.trim();
 $$('[data-check]').forEach(c=>d.verified[c.dataset.check]=c.checked);
 const name=$('#verifiedPlatform');if(name)d.verified.platform_name=name.value.trim();
 d.priority=priority(d).type;
}
async function loadLeadHistory(id){
 const target=$('#leadHistory');target.replaceChildren();
 if(!id){target.append(dom('p','field-note','Salve este negócio para começar o histórico.'));return}
 try{
  const entries=await rpc('crm_local_history',{p_lead_id:id});
  if(!Array.isArray(entries)||!entries.length){target.append(dom('p','field-note','Ainda não existe um contato registrado.'));return}
  for(const x of entries.slice(0,35)){
   const card=dom('div','history-entry');
   const top=dom('div','history-entry-top');top.append(dom('strong','',STATUSES[x.event_type]||x.event_type||'Ação'),dom('span','',new Date(x.created_at).toLocaleString('pt-BR')));
   card.append(top);
   if(x.note)card.append(dom('p','',x.note));
   if(x.channel)card.append(dom('small','',x.channel==='whatsapp'?'WhatsApp':x.channel==='email'?'E-mail':x.channel));
   target.append(card);
  }
 }catch{target.append(dom('p','field-note','Histórico indisponível no momento.'))}
}
function populateLead(){
 const d=state.draft;if(!d)return;
 $('#leadDialogTitle').textContent=d.name||'Nova oportunidade';
 const source=$('#leadSource');source.replaceChildren();
 source.append(dom('span','',d.rating!=null?'★ '+formatStars(d.rating)+' · '+(d.reviews??'—')+' avaliações':'Sem nota verificada'),dom('span','',siteLabel(d.link_type)));
 const u=safeUrl(d.maps_url);
 if(u){const a=dom('a','','Abrir no Maps ↗');a.href=u;a.target='_blank';a.rel='noopener noreferrer';source.append(a)}
 const siteUrl=safeUrl(d.website);
 if(siteUrl){const a=dom('a','','Ver site / perfil ↗');a.href=siteUrl;a.target='_blank';a.rel='noopener noreferrer';source.append(a)}
 const phone=normalizePhone(d.phone);
 if(phone){const a=dom('a','','Conferir WhatsApp ↗');a.href='https://wa.me/'+phone;a.target='_blank';a.rel='noopener noreferrer';source.append(a)}
 for(const [id,key] of [['leadName','name'],['leadCity','city'],['leadPhone','phone'],['leadWebsite','website'],['leadEmail','email'],['leadChannel','channel'],['leadOffer','offer'],['leadAngle','angle'],['leadNotes','notes']])$('#'+id).value=d[key]??'';
 const grid=$('#verificationGrid');grid.replaceChildren();
 for(const [key,label] of VERIFY){
  const lab=dom('label','verification'),check=dom('input');check.type='checkbox';check.dataset.check=key;check.checked=!!d.verified[key];
  lab.append(check,dom('span','',label));
  check.addEventListener('change',()=>{fromFields();updateRecommendation(true)});
  grid.append(lab);
 }
 const platform=dom('label','verification'),platformText=dom('span','','Qual plataforma de agendamento?'),platformInput=dom('input');
 platformInput.id='verifiedPlatform';platformInput.placeholder='Ex.: Trinks, Booksy';platformInput.maxLength=100;platformInput.value=d.verified.platform_name||'';
 platformInput.addEventListener('change',()=>{fromFields();updateRecommendation(false)});
 platform.append(platformText,platformInput);grid.append(platform);
 $('#leadMessage').value=d.last_message||(offerFor(d).blocked?'':templateMessage(d));
 $('#leadActionBar').hidden=true;
 void loadLeadHistory(d.id);
 $('#openWhatsapp').hidden=d.channel==='email';
 $('#queueGmail').hidden=d.channel!=='email';
 updateRecommendation(false);
}
function updateRecommendation(replaceText){
 const d=state.draft;if(!d)return;
 const recommendation=offerFor(d),container=$('#leadRecommendation');container.replaceChildren();
 container.append(dom('strong','',recommendation.blocked?'Atenção · revisar antes de abordar':('Prioridade '+({alta:'alta',investigar:'vale investigar',baixa:'baixa'})[priority(d).type]+' · '+(d.offer==='bot'?'Oferta: bot':'Oferta: landing'))),dom('p','',priority(d).why+' '+recommendation.why));
 $('#leadWarning').textContent=d.angle==='C'&&(!d.verified.top||!d.verified.demo_ready)?'Ângulo C só pode ser usado depois que você marcar este cliente como prioritário e confirmar que preparou a demonstração.':recommendation.blocked?'O Radar não recomenda gerar landing automaticamente para este caso. Confira antes de prosseguir.':d.link_type==='none'?'Sem link no Google não significa que o negócio não tenha site. Confirme antes de afirmar isso.':'Todo dado não verificado deve permanecer como hipótese.';
 if(replaceText){d.offer=recommendation.offer;d.angle=recommendation.angle;$('#leadOffer').value=d.offer;$('#leadAngle').value=d.angle;$('#leadMessage').value=recommendation.blocked?'':templateMessage(d);d.last_message=$('#leadMessage').value}
}
function openLead(candidate){
 state.aiDraftEpoch++;
 $('#draftAIStatus').textContent='A IA só recebe os fatos disponíveis e suas verificações marcadas.';
 const stored=candidate.id?state.leads.find(x=>x.id===candidate.id):state.leads.find(x=>candidate.place_id&&x.place_id===candidate.place_id);
 state.draft=blankLead(stored||candidate);
 populateLead();
 $('#leadOverlay').hidden=false;document.body.style.overflow='hidden';
 $('#closeLead').focus();
}
function closeLead(){state.aiDraftEpoch++;state.draft=null;$('#leadOverlay').hidden=true;document.body.style.overflow=''}
async function saveLead(showToast=true){
 fromFields();
 const d=state.draft;
 if(!d?.name){toast('Informe o nome do negócio.');return null}
 if(d.email&&!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(d.email)){toast('E-mail inválido.');return null}
 try{
  const saved=await rpc('crm_local_save',{p_data:{...d,place_id:d.place_id||null}});
  state.draft=blankLead(saved);await refresh();
  void loadLeadHistory(saved.id);
  if(showToast)toast('Negócio salvo na sua carteira.');
  return saved;
 }catch(e){toast('Não foi possível salvar: '+e.message);return null}
}
async function action(type,note=''){
 const saved=await saveLead(false);if(!saved)return;
 try{
  const d=state.draft;
  const update=await rpc('crm_local_action',{p_lead_id:saved.id,p_type:type,p_note:note||d.last_message||'',p_channel:d.channel,p_offer:d.offer,p_angle:d.angle});
  state.draft=blankLead(update);await refresh();populateLead();toast((STATUSES[type]||'Ação')+' registrado com sucesso.');
 }catch(e){toast(e.message)}
}
function openWhatsApp(){
 fromFields();
 const d=state.draft,number=normalizePhone(d?.phone);
 if(d&&['sem_interesse','fechou'].includes(d.status)){toast('Contato encerrado. Não vamos sugerir novas mensagens.');return}
 if(d?.angle==='C'&&(!d.verified.top||!d.verified.demo_ready)){toast('Antes do ângulo C, confirme que a demonstração está pronta.');return}
 if(d?.status==='abordado'&&!dueFor(d)){toast('Follow-up ainda não está previsto. Confira a data na Central.');return}
 if(!number){toast('Informe um telefone com DDD antes de abrir o WhatsApp.');return}
 const msg=($('#leadMessage').value||'').trim();
 if(!msg){toast('Revise a mensagem antes de abrir.');return}
 const url='https://wa.me/'+number+'?text='+encodeURIComponent(msg);
 window.open(url,'_blank','noopener,noreferrer');
 state.pendingSend=true;
 $('#leadActionBar').hidden=false;
 $('#confirmSent').disabled=true;
 void saveLead(false).then(saved=>{if(!$('#leadActionBar').hidden)$('#confirmSent').disabled=!saved});
 toast('Conversa aberta. Só marque enviado depois de confirmar o envio no WhatsApp.');
}
async function prepareEmail(){
 fromFields();const d=state.draft;
 if(['sem_interesse','fechou'].includes(d.status)){toast('Não abordaremos contatos encerrados.');return}
 if(d.status==='abordado'&&!dueFor(d)){toast('Ainda não é momento de follow-up. Confira a data na Central.');return}
 if(d.angle==='C'&&(!d.verified.top||!d.verified.demo_ready)){toast('Confirme que a demonstração está pronta antes do ângulo C.');return}
 if(!d.email){toast('Cadastre o e-mail comercial primeiro.');return}
 const saved=await saveLead(false);if(!saved)return;
 const msg=$('#leadMessage').value.trim();
 if(!msg){toast('Prepare uma mensagem primeiro.');return}
 try{
  const reply=await backend('outreach','POST',{action:'queue-add',company:saved.name,email:saved.email,subject:'Uma ideia para a '+saved.name,text:msg,leadId:saved.id,type:saved.status==='abordado'?'followup':'initial'});
  toast('E-mail adicionado à fila de aprovação em Pra Hoje.');
  closeLead();location.hash='#hoje';$('#gmailDetails').open=true;await loadEmailQueue();
 }catch(e){toast('Fila Gmail: '+e.message)}
}
function statusChooser(){
 if(!state.draft?.id){toast('Salve o negócio antes de registrar resultados.');return}
 const bar=$('#leadActionBar');bar.replaceChildren();bar.hidden=false;
 bar.append(dom('p','','Qual foi o resultado do contato?'));
 const wrap=dom('div','status-buttons');wrap.style.display='flex';wrap.style.gap='6px';wrap.style.flexWrap='wrap';
 for(const type of ['respondeu','interessado','proposta','sem_interesse','fechou']){
  const btn=dom('button','btn btn-outline compact',STATUSES[type]);btn.onclick=()=>action(type,'Resultado registrado manualmente');wrap.append(btn);
 }bar.append(wrap);
}
function loadTemplatePreferences(){
 try{
  const overrides=JSON.parse(localStorage.getItem('ricky:local:templates-v1')||'{}');
  for(const template of TEMPLATES)if(typeof overrides[template[0]]==='string'&&overrides[template[0]].trim())template[1]=overrides[template[0]].slice(0,1800);
 }catch{}
}
function templateLibrary(){
 const root=$('#templateLibrary');root.replaceChildren();
 const settings=dom('div','template-settings');
 const header=dom('div','template-settings-top');
 header.append(dom('strong','','Dados para respostas prontas'),dom('small','','Valores salvos neste navegador'));
 settings.append(header);
 const row=dom('div','template-settings-row');
 const price=dom('input'),deadline=dom('input');
 price.type='text';price.placeholder='Preço, ex.: R$ 700';price.maxLength=70;
 deadline.type='text';deadline.placeholder='Prazo, ex.: 5 dias úteis';deadline.maxLength=70;
 try{const x=JSON.parse(localStorage.getItem('ricky:local:pricing-v1')||'{}');price.value=x.price||'';deadline.value=x.deadline||''}catch{}
 const saveValues=()=>{try{localStorage.setItem('ricky:local:pricing-v1',JSON.stringify({price:price.value.trim(),deadline:deadline.value.trim()}));toast('Valores salvos neste navegador.')}catch{toast('Não foi possível salvar neste navegador.')}};
 const saveBtn=dom('button','btn btn-outline compact','Salvar valores');saveBtn.type='button';saveBtn.onclick=saveValues;
 row.append(price,deadline,saveBtn);settings.append(row);root.append(settings);
 for(const [i,template] of TEMPLATES.entries()){
  const [name,body]=template;
  const card=dom('div','template');card.append(dom('h4','',name));
  const preview=dom('p','',body);card.append(preview);
  const actions=dom('div','template-actions');
  const copy=dom('button','btn btn-outline compact','Copiar'),edit=dom('button','btn btn-outline compact','Editar');
  copy.type='button';edit.type='button';
  copy.onclick=async()=>{
   let text=template[1].replaceAll('{{preco}}',price.value.trim()||'[definir preço]').replaceAll('{{prazo}}',deadline.value.trim()||'[definir prazo]');
   try{await navigator.clipboard.writeText(text);toast('Modelo copiado. Personalize os dados do negócio antes de enviar.')}catch{toast('Não foi possível copiar automaticamente.')}
  };
  const editor=dom('textarea','template-editor');editor.value=body;editor.rows=7;editor.maxLength=1800;editor.hidden=true;
  edit.onclick=()=>{
   if(editor.hidden){editor.hidden=false;edit.textContent='Salvar';editor.focus();return}
   const value=editor.value.trim();if(!value){toast('O modelo não pode ficar vazio.');return}
   template[1]=value;preview.textContent=value;editor.hidden=true;edit.textContent='Editar';
   try{localStorage.setItem('ricky:local:templates-v1',JSON.stringify(Object.fromEntries(TEMPLATES.map(([k,v])=>[k,v]))))}catch{}
   toast('Modelo atualizado neste navegador.');
  };
  actions.append(copy,edit);card.append(actions,editor);root.append(card);
 }
}
async function loadGmail(shouldSync=false){
 if(!state.key)return;
 try{
  const data=await backend('gmail');
  state.gmail={connected:data.connected,canSend:data.canSend,items:data.items||[]};
  $('#gmailState').textContent=data.connected?'Gmail conectado · '+(data.aiActive?'classificação OpenAI ativa':'classificação por regras'):'Gmail ainda não conectado';
  $('#gmailConnect').textContent=data.connected?'Reconectar Gmail':'Conectar Gmail';
  $('#gmailSync').disabled=!data.connected;
  renderGmail();
  if(shouldSync&&data.connected&&Date.now()-state.lastGmailSync>120000&&state.leads.some(x=>x.email&&x.contacted_at&&x.channel==='email'))await syncGmail();
  await loadEmailQueue();
 }catch(e){$('#gmailState').textContent=e.message}
}
async function syncGmail(){
 const list=state.leads.filter(x=>x.email&&x.contacted_at&&x.channel==='email').map(x=>({id:x.id,name:x.name,email:x.email,sentAt:x.contacted_at}));
 if(!list.length){toast('Ainda não há leads abordados por e-mail para sincronizar.');return}
 try{
  $('#gmailState').textContent='Sincronizando mensagens vinculadas…';
  const data=await backend('gmail','POST',{action:'sync',leads:list});
  state.lastGmailSync=Date.now();
  state.gmail.items=data.items||[];
  renderGmail();
  $('#gmailState').textContent='Respostas sincronizadas. Revise os resultados antes de responder.';
  for(const reply of state.gmail.items){
   const c=state.leads.find(x=>x.id===reply.leadId);
   if(!c||!c.contacted_at||!reply.receivedAt||Date.parse(reply.receivedAt)<Date.parse(c.contacted_at))continue;
   if(!['novo','abordado'].includes(c.status)||reply.label==='Automático')continue;
   try{await rpc('crm_local_action',{p_lead_id:c.id,p_type:'respondeu',p_note:'Resposta detectada pelo Gmail; classificação '+(reply.label||'revisar'),p_channel:'email'})}catch{}
  }
  await refresh();
 }catch(e){toast('Gmail: '+e.message);$('#gmailState').textContent=e.message}
}
function renderGmail(){
 const root=$('#gmailReplyList');root.replaceChildren();
 const items=(state.gmail.items||[]).filter(x=>state.leads.some(c=>c.id===x.leadId)).slice(0,30);
 if(!items.length){root.append(dom('p','field-note','Nenhuma resposta de e-mail vinculada aos novos contatos ainda.'));return}
 for(const r of items){
  const card=dom('div','reply');card.append(dom('strong','',r.name+' · '+(r.label||'Revisar')+' · '+(r.priority||'')),dom('p','',r.summary||''),dom('p','',r.next||''));
  const a=dom('a','','Abrir no Gmail ↗');a.href='https://mail.google.com/mail/u/0/#all/'+encodeURIComponent(r.threadId||'');a.target='_blank';a.rel='noopener noreferrer';card.append(a);root.append(card);
 }
}
async function loadEmailQueue(){
 try{
  const x=await backend('outreach');
  state.emailQueue=x.queue||[];
  const root=$('#gmailReplyList');
  root.querySelectorAll('.queued-email').forEach(x=>x.remove());
  for(const q of state.emailQueue){
   if(!state.leads.some(c=>c.id===q.leadId))continue;
   const row=dom('div','reply queued-email');row.append(dom('strong','','Na fila de aprovação: '+q.company),dom('p','',q.subject+' · '+q.email),dom('p','',q.text));
   const action=dom('button','btn btn-primary compact','Aprovar e enviar');
   const contact=state.leads.find(c=>c.id===q.leadId);
   if(contact&&(['fechou','sem_interesse'].includes(contact.status)||(contact.status==='abordado'&&!dueFor(contact)))){
     action.disabled=true;action.textContent='Envio bloqueado por status';
   }
   action.onclick=async()=>{
    if(!confirm('Confirma o envio deste e-mail para '+q.email+'?'))return;
    action.disabled=true;
    try{
     const sent=await backend('outreach','POST',{action:'send',id:q.id,approved:true});
     const c=state.leads.find(x=>x.id===q.leadId);
     try{
       if(c){
         const kind=c.status==='novo'?'abordado':dueFor(c)?'followup':'mensagem';
         const updated=await rpc('crm_local_action',{p_lead_id:c.id,p_type:kind,p_note:'E-mail enviado com aprovação humana: '+q.subject,p_channel:'email',p_offer:'landing',p_angle:'A'});
         updated.contacted_at=sent.sent?.sentAt||now();updated.channel='email';
         await rpc('crm_local_save',{p_data:updated});
       }
       await refresh();await loadEmailQueue();toast('E-mail enviado e registrado.');
     }catch(regError){await loadEmailQueue();toast('E-mail enviado pelo Gmail, mas falhou o registro no CRM: '+regError.message)}
    }catch(e){toast('Envio não confirmado: '+e.message)}
    finally{action.disabled=false}
   };
   row.append(action);root.prepend(row);
  }
 }catch{}
}
async function gmailConnect(){
 try{const data=await backend('gmail','POST',{action:'connect'});if(!/^https:\/\/accounts\.google\.com\//.test(data.url))throw Error('Autorização inválida');location.href=data.url}catch(e){toast(e.message)}
}

async function improveMessageAI(){
 if(state.aiBusy){toast('Já existe uma análise em andamento.');return}
 fromFields();const lead=state.draft;
 if(!lead?.name){toast('Preencha o nome do negócio primeiro.');return}
 if(lead.verified.possible_chain||lead.verified.site_mobile_ok){toast('O cadastro requer uma revisão antes de sugerir abordagem.');return}
 if(lead.angle==='C'&&(!lead.verified.top||!lead.verified.demo_ready)){toast('Confirme primeiro que o rascunho do ângulo C está pronto.');return}
 const epoch=state.aiDraftEpoch;
 const btn=$('#improveMessageAI'),status=$('#draftAIStatus');
 btn.disabled=true;status.textContent='✦ Preparando uma versão revisada…';
 state.aiBusy=true;
 try{
  const data=await backend('local-ai','POST',{task:'approach',lead:{
   name:lead.name,city:lead.city,rating:lead.rating,reviews:lead.reviews,link_type:lead.link_type,
   verified:lead.verified,offer:lead.offer,angle:lead.angle
  }});
  if(epoch!==state.aiDraftEpoch||!state.draft||$('#leadOverlay').hidden)return;
  if(typeof data.text==='string'&&data.text.trim()){
   $('#leadMessage').value=data.text.trim();
   state.draft.last_message=$('#leadMessage').value;
   status.textContent=data.source==='openai'?'✓ Texto ajustado. Revise antes de enviar.':'Modelo seguro mantido: '+(data.message||'revise antes de enviar.');
  }else{status.textContent='Não foi gerada uma sugestão utilizável.'}
 }catch(e){if(epoch===state.aiDraftEpoch){status.textContent='Não foi possível ajustar. Seu texto foi mantido.';toast('Ricky AI: '+e.message)}}
 finally{state.aiBusy=false;btn.disabled=false}
}
async function analyzeWhatsAppReply(){
 const incoming=$('#aiIncoming').value.trim(),btn=$('#analyzeReply');
 if(incoming.length<3){toast('Cole uma resposta recebida do cliente.');return}
 if(state.aiBusy){toast('Aguarde a análise atual.');return}
 btn.disabled=true;btn.textContent='✦ Analisando…';state.aiBusy=true;
 $('#replyAIStatus').textContent='A IA vai interpretar somente o texto colado.';
 try{
  const data=await backend('local-ai','POST',{task:'reply',incoming});
  const labels={interessado:'Possível interesse — confirme na conversa',pergunta:'Cliente fez uma pergunta',sem_interesse:'Sem interesse — não insistir',neutro:'Resposta a verificar'};
  $('#replyAIClassification').textContent=labels[data.classification]||labels.neutro;
  $('#replyAISummary').textContent=data.summary||'Leia a mensagem antes de decidir.';
  $('#replyAISuggestion').value=data.suggestion||'';
  $('#replyAIResult').hidden=false;
  $('#replyAIStatus').textContent='Sugestão pronta. Revise, copie e registre o resultado no card do cliente.';
 }catch(e){$('#replyAIStatus').textContent='Erro na análise: '+e.message;toast(e.message)}
 finally{btn.disabled=false;btn.textContent='✦ Sugerir resposta';state.aiBusy=false}
}
async function analyzeExperiment(){
 if(state.aiBusy){toast('Já existe uma análise em andamento.');return}
 const rows=state.leads.slice(0,100).map(c=>({
  status:c.status,link_type:c.link_type,contacted:!!c.contacted_at,
  ever_responded:!!c.ever_responded,ever_interested:!!c.ever_interested
 }));
 if(!rows.some(c=>c.contacted)){toast('Registre uma abordagem antes de analisar os resultados.');return}
 const btn=$('#analyzeResults');btn.disabled=true;state.aiBusy=true;
 $('#insightsStatus').textContent='✦ Procurando padrões nos contatos registrados…';
 try{
  const data=await backend('local-ai','POST',{task:'insights',rows});
  const root=$('#insightsOutput');root.replaceChildren();
  root.append(dom('strong','','Leitura comercial da Ricky AI'),dom('p','',data.summary||'Resultados ainda iniciais.'));
  const stats=data.stats||{},totals=dom('p','ai-stats',String(stats.approached||0)+' abordados · '+String(stats.replied||0)+' respostas · '+String(stats.interested||0)+' interessados · '+String(stats.won||0)+' fechamentos');
  root.append(totals);
  if(Array.isArray(data.insights)){
   const ul=dom('ul');data.insights.forEach(item=>ul.append(dom('li','',item)));root.append(ul);
  }
  if(data.next_step)root.append(dom('p','ai-next','Próximo teste: '+data.next_step));
  root.append(dom('p','field-note','Análise exploratória de dados agregados. Não demonstra causa ou previsão de fechamento.'));
  root.hidden=false;$('#insightsStatus').textContent='Análise concluída · sem alterações nos leads.';
 }catch(e){$('#insightsStatus').textContent='Não foi possível analisar: '+e.message;toast(e.message)}
 finally{state.aiBusy=false;btn.disabled=false}
}


function costCard({mark,title,connected,rows,description,link,linkLabel}){
 const card=dom('article','costs-service');
 const head=dom('div','costs-service-head');
 const left=dom('div','costs-service-name'),avatar=dom('span','costs-provider-icon',mark),label=dom('div');
 label.append(dom('strong','',title),dom('small','',description));
 left.append(avatar,label);
 head.append(left,dom('span','costs-state '+(connected?'connected':'offline'),connected?'Configurado':'Não configurado'));
 card.append(head);
 for(const row of rows){
  const section=dom('div','costs-meter');
  const line=dom('div','costs-meter-line');line.append(dom('span','',row.label),dom('strong','',row.value));section.append(line);
  if(row.pct!==null&&row.pct!==undefined){
   const track=dom('div','costs-meter-track'),fill=dom('span','');
   const p=Math.max(0,Math.min(100,row.pct));fill.style.width=p+'%';
   if(p>=90)fill.className='danger';else if(p>=75)fill.className='warning';
   track.append(fill);section.append(track);
  }
  if(row.caption)section.append(dom('small','costs-meter-caption',row.caption));
  card.append(section);
 }
 const note=dom('div','costs-provider-footer');
 note.append(dom('span','', 'Cobrança confirmada: não conectada'));
 const a=dom('a','',linkLabel+' ↗');a.href=link;a.target='_blank';a.rel='noopener noreferrer';note.append(a);card.append(note);
 return card;
}
function meter(label,value,unit='chamadas'){
 if(!value)return {label,value:'Não disponível',pct:null,caption:'Ainda não há limite instrumentado para este indicador.'};
 const fmt=v=>Number(v).toLocaleString('pt-BR');
 return {label,value:fmt(value.used)+' / '+fmt(value.limit),pct:value.percentage,caption:fmt(value.remaining)+' '+unit+' restantes no limite interno'};
}
async function loadCosts(){
 if(!state.key)return;
 const error=$('#costsError'),button=$('#refreshCosts');button.disabled=true;
 error.textContent='';$('#costsUpdated').textContent='Atualizando contadores…';
 try{
  const data=await backend('costs');
  $('#costsUpdated').textContent='Atualizado em '+new Date(data.updatedAt).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})+' · UTC';
  $('#costsPlacesCount').textContent=String(data.places.callsMonth.used)+' / '+String(data.places.callsMonth.limit);
  $('#costsPlacesRemaining').textContent=data.places.callsMonth.remaining+' chamadas disponíveis no limite interno';
  $('#costsAiCount').textContent=String(data.openai.requestsMonth.used)+' / '+String(data.openai.requestsMonth.limit);
  $('#costsAiRemaining').textContent=data.openai.requestsMonth.remaining+' análises disponíveis no limite interno';
  const cards=$('#costsCards');cards.replaceChildren();
  cards.append(
   costCard({mark:'◎',title:'Google Places',connected:data.places.connected,description:'Radar Local · descoberta de estabelecimentos',rows:[meter('Chamadas neste mês',data.places.callsMonth),meter('Chamadas hoje',data.places.callsDay),meter('Varreduras neste mês',data.places.scansMonth,'varreduras'),{label:'Franquia gratuita do Google',value:'Não verificada',pct:null,caption:'Contas e outros projetos podem consumir a franquia.'}],link:'https://console.cloud.google.com/billing',linkLabel:'Ver fatura Google'}),
   costCard({mark:'✦',title:'OpenAI · Ricky AI',connected:data.openai.connected,description:'Mensagens, respostas e análises comerciais',rows:[meter('Análises neste mês',data.openai.requestsMonth),meter('Análises hoje',data.openai.requestsDay),{label:'Tokens e custo em USD',value:'Não conectado',pct:null,caption:'Número de chamadas não permite calcular o preço real.'}],link:'https://platform.openai.com/usage',linkLabel:'Ver custos OpenAI'}),
   costCard({mark:'♜',title:'Brave Search',connected:data.brave.connected,description:'Busca web do Radar antigo',rows:[meter('Buscas neste mês',data.brave.requestsMonth),meter('Buscas hoje',data.brave.requestsDay),data.brave.reservedBudgetCents?{label:'Reserva interna acumulada',value:(data.brave.reservedBudgetCents.used/100).toLocaleString('pt-BR',{style:'currency',currency:'USD'}),pct:Math.min(100,data.brave.reservedBudgetCents.used/data.brave.reservedBudgetCents.limit*100),caption:'Reserva em centavos configurados; não equivale à fatura oficial.'}:{label:'Reserva interna',value:'Não configurada',pct:null}, {label:'Créditos do plano Brave',value:'Não verificados',pct:null}],link:'https://api-dashboard.search.brave.com/',linkLabel:'Ver painel Brave'}),
   costCard({mark:'⬡',title:'Upstash Redis',connected:data.upstash.connected,description:'Armazenamento e controle de limites',rows:[{label:'Requisições e armazenamento totais',value:'Não conectado',pct:null,caption:'Consulte a franquia e o uso total no console Upstash.'}],link:'https://console.upstash.com/',linkLabel:'Ver console Upstash'}),
   costCard({mark:'▱',title:'Vercel',connected:data.vercel.connected,description:'Hospedagem e funções do CRM',rows:[{label:'Consumo da hospedagem',value:'Não conectado',pct:null,caption:'O consumo total da Vercel depende de outros recursos da conta.'}],link:'https://vercel.com/dashboard',linkLabel:'Ver custos Vercel'})
  );
 }catch(e){
  $('#costsUpdated').textContent='Dados indisponíveis';
  $('#costsPlacesCount').textContent='—';$('#costsPlacesRemaining').textContent='Contagem indisponível';
  $('#costsAiCount').textContent='—';$('#costsAiRemaining').textContent='Contagem indisponível';
  $('#costsCards').replaceChildren(dom('p','field-note','Não foi possível consultar os contadores. Nenhum número foi presumido.'));
  error.textContent=e.message;
 }finally{button.disabled=false}
}

function bind(){
 window.addEventListener('hashchange',setNav);
 $('#loginForm').addEventListener('submit',e=>{e.preventDefault();signIn()});
 $('#refreshApp').onclick=()=>refresh().then(()=>toast('Carteira atualizada.')).catch(e=>toast(e.message));
 $('#refreshCosts').onclick=()=>loadCosts();
 $('#logoutButton').onclick=()=>{localStorage.removeItem(KEY_NAME);sessionStorage.removeItem(KEY_NAME);state.key='';state.leads=[];state.results=[];state.gmail.items=[];state.emailQueue=[];render();showLogin();location.hash='#central';toast('Sessão local encerrada.');};
 $('#logoutMobile').onclick=()=>$('#logoutButton').click();
 $('#localForm').addEventListener('submit',scan);
 $$('[data-niche]').forEach(b=>b.addEventListener('click',()=>{
  $$('[data-niche]').forEach(x=>x.classList.toggle('active',x===b));
  $('#localNiche').value=b.dataset.niche;
 }));
 for(const id of ['radarSearch','radarSort','radarLink','radarContact','radarReviews'])$('#'+id).addEventListener(id==='radarSearch'?'input':'change',renderRadar);
 $('#resetRadarFilters').onclick=()=>{for(const id of ['radarSearch','radarSort','radarLink','radarContact','radarReviews'])$('#'+id).value=id==='radarSort'?'priority':id==='radarSearch'?'':'all';renderRadar();};
 $('#minRating').addEventListener('change',renderRadar);$('#minReviews').addEventListener('change',renderRadar);
 $('#filterEligible').onclick=()=>{state.filterOutside=false;$('#filterEligible').classList.add('active');$('#filterOutside').classList.remove('active');renderRadar()};
 $('#filterOutside').onclick=()=>{state.filterOutside=true;$('#filterOutside').classList.add('active');$('#filterEligible').classList.remove('active');renderRadar()};
 $('[data-offer]').forEach(b=>b.addEventListener('click',()=>{state.offerFilter=b.dataset.offer;$('[data-offer]').forEach(x=>x.classList.toggle('active',x===b));renderRadar()}));
 $$('[data-today]').forEach(b=>b.addEventListener('click',()=>{state.todayFilter=b.dataset.today;$$('[data-today]').forEach(x=>x.classList.toggle('active',x===b));renderToday()}));
 $('#clientStatus').addEventListener('change',renderClients);$('#clientSearch').addEventListener('input',renderClients);
 $('#manualAdd').onclick=()=>openLead({});$('#addClient').onclick=()=>openLead({});
 $('#closeLead').onclick=closeLead;
 $('#leadOverlay').addEventListener('click',e=>{if(e.target===$('#leadOverlay'))closeLead()});
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#leadOverlay').hidden)closeLead()});
 $('#saveLead').onclick=()=>saveLead();
 $('#improveMessageAI').onclick=improveMessageAI;
 $('#analyzeReply').onclick=analyzeWhatsAppReply;
 $('#analyzeResults').onclick=analyzeExperiment;
 $('#copyReplyAI').onclick=async()=>{const msg=$('#replyAISuggestion').value.trim();if(!msg){toast('Não há resposta para copiar.');return}try{await navigator.clipboard.writeText(msg);toast('Resposta copiada. Envie manualmente no WhatsApp.')}catch{toast('Selecione o texto para copiar manualmente.')}};
 $('#markResponse').onclick=statusChooser;
 $('#openWhatsapp').onclick=openWhatsApp;
 $('#confirmSent').onclick=async()=>{if(!confirm('Você realmente enviou a mensagem pelo WhatsApp?'))return;fromFields();const d=state.draft;if(!d)return;const kind=d.status==='novo'?'abordado':d.status==='abordado'?'followup':'mensagem';await action(kind,d.last_message)};
 $('#queueGmail').onclick=prepareEmail;
 $('#leadChannel').addEventListener('change',()=>{fromFields();$('#openWhatsapp').hidden=state.draft.channel==='email';$('#queueGmail').hidden=state.draft.channel!=='email'});
 $('#leadOffer').addEventListener('change',()=>{fromFields();$('#leadMessage').value=templateMessage(state.draft);state.draft.last_message=$('#leadMessage').value;updateRecommendation(false)});
 $('#leadAngle').addEventListener('change',()=>{fromFields();$('#leadMessage').value=templateMessage(state.draft);state.draft.last_message=$('#leadMessage').value;updateRecommendation(false)});
 $('#leadWebsite').addEventListener('change',()=>{fromFields();updateRecommendation(true)});
 $('#gmailSync').onclick=syncGmail;
 $('#gmailConnect').onclick=gmailConnect;
 $('#gmailDetails').addEventListener('toggle',()=>{if($('#gmailDetails').open)loadGmail(true)});
}
async function init(){
 loadTemplatePreferences();templateLibrary();bind();
 const oauth=new URLSearchParams(location.search).get('gmail');
 if(oauth){history.replaceState(null,'',location.pathname+'#hoje');$('#gmailDetails').open=true}
 setNav();render();
 if(!state.key){showLogin();return}
 try{await refresh();$('#authOverlay').hidden=true;checkPlaces();if(location.hash==='#custos')void loadCosts()}
 catch(e){localStorage.removeItem(KEY_NAME);sessionStorage.removeItem(KEY_NAME);state.key='';showLogin();$('#connectionState').classList.add('error')}
}
init();
})();