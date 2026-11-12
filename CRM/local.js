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
const state={key:localStorage.getItem(KEY_NAME)||sessionStorage.getItem(KEY_NAME)||'',leads:[],results:[],niche:'Barbearias',city:'São Paulo, SP',filterOutside:false,todayFilter:'all',current:null,draft:null,editing:false,placesReady:false,scanning:false,archive:[],gmail:{connected:false,canSend:false,items:[]},emailQueue:[],pendingSend:false,toastTimer:0,sequence:0};
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
 ['top','Cliente prioritário — preparei uma demonstração']
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
 const response=await fetch('/api/'+path,{method,headers:{Authorization:'Bearer '+key(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(32000)});
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
 if(v.possible_chain||c.chain_hint)return {type:'baixa',why:'Possível rede ou franquia; verificar antes de oferecer.'};
 if(v.site_mobile_ok)return {type:'baixa',why:'Você confirmou que o site já funciona bem no celular.'};
 const contact=!!normalizePhone(c.phone)||['social','whatsapp'].includes(c.link_type);
 if(['none','social','bio','whatsapp'].includes(c.link_type)&&contact)return {type:'alta',why:c.link_type==='none'?'O Google não informa um site; investigar presença digital antes da abordagem.':'O link cadastrado é '+siteLabel(c.link_type).toLowerCase()+'; site próprio ainda não confirmado.'};
 if(c.link_type==='booking'&&contact)return {type:'investigar',why:'Já usa agendamento externo; uma landing pode fortalecer a marca sem substituir reservas.'};
 if(c.link_type==='own')return {type:'investigar',why:'Existe um domínio cadastrado. Verifique se há oportunidade real de melhoria.'};
 return {type:'investigar',why:'Faltam evidências para classificar este negócio com segurança.'};
}
function offerFor(c){
 const v=c.verified||{};
 if(v.possible_chain||v.site_mobile_ok||c.chain_hint)return {blocked:true,offer:'landing',angle:'A',why:'Revisão recomendada antes de preparar uma nova oferta.'};
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
 if(type==='none')return 'Não encontrei um link de site cadastrado no Google; queria entender onde novos clientes veem serviços e agendamentos.';
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
 if(angle==='B'||c.offer==='bot'){
  return 'Oi, aqui é o Henrique! Pergunta rápida: vocês gastam muito tempo respondendo preços e horários no WhatsApp?\nMonto assistentes que ajudam com essas perguntas e facilitam o atendimento.\nPosso te mostrar uma ideia para a '+c.name+'?';
 }
 if(angle==='C')return 'Oi! Aqui é o Henrique. '+praise(c)+'\nPreparei um rascunho de como poderia ser a página de vocês.\nPosso te mostrar?';
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
 }
 return todos.sort((a,b)=>a.order-b.order||new Date(b.c.updated_at)-new Date(a.c.updated_at));
}
function setNav(){
 let page=(location.hash||'#central').replace('#','');
 if(!['central','radar','hoje','clientes'].includes(page))page='central';
 $$('.page').forEach(x=>x.hidden=x.id!=='page-'+page);
 $$('[data-nav]').forEach(a=>{a.classList.toggle('active',a.dataset.nav===page);if(a.dataset.nav===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
 $('#headerSection').textContent=({central:'Central',radar:'Radar Local',hoje:'Pra Hoje',clientes:'Clientes'})[page];
 if(page==='hoje')loadGmail(false);
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
 const todos=getTodos(),contacted=state.leads.filter(c=>c.contacted_at).length,replies=state.leads.filter(c=>['respondeu','interessado','proposta','fechou'].includes(c.status)).length,wins=state.leads.filter(c=>c.status==='fechou').length;
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
  b.append(dom('small','',formatDate(a.date)+' · GOOGLE PLACES'),dom('strong','',a.niche+' / '+a.city),dom('span','',a.count+' candidatos · repetir pesquisa ↗'));
  b.addEventListener('click',()=>{$('#localNiche').value=a.niche;$('#localCity').value=a.city;window.scrollTo({top:0,behavior:'smooth'});toast('Busca carregada. Inicie outra varredura para consultar dados atuais; uma nova chamada pode ser cobrada.')});
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
 art.append(metrics);
 const insight=dom('div','prospect-insight');insight.append(dom('strong','',c.business_status==='CLOSED_PERMANENTLY'?'Fechado permanentemente':'Por que investigar?'),dom('p','',resultsReason(c)));
 art.append(insight);
 const actions=dom('div','prospect-actions');
 const open=dom('button','btn btn-primary compact','Salvar / verificar'),site=dom('a','btn btn-outline compact','Ver link ↗');
 open.type='button';open.addEventListener('click',()=>openLead(c));
 if(c.website||c.maps_url){site.href=safeUrl(c.website)||safeUrl(c.maps_url)||'#';site.target='_blank';site.rel='noopener noreferrer'}else{site.href='#';site.addEventListener('click',ev=>ev.preventDefault());site.setAttribute('aria-disabled','true')}
 actions.append(open,site);art.append(actions);
 return art;
}
function safeUrl(v){try{const u=new URL(String(v||''));return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null}catch{return null}}
function renderRadar(){
 const area=$('#radarResults');area.replaceChildren();
 const filtered=state.results.filter(c=>eligible(c)!==state.filterOutside);
 if(!state.results.length){area.innerHTML=placeholder('Pronto para encontrar oportunidades','Escolha um segmento, uma localidade e inicie a busca.');return}
 if(!filtered.length){area.innerHTML=placeholder('Nenhum resultado neste filtro','Altere os valores de nota e avaliações ou consulte os candidatos fora do filtro.');return}
 filtered.sort((a,b)=>{const weights={alta:2,investigar:1,baixa:0};return weights[priority(b).type]-weights[priority(a).type]||Number(b.reviews||0)-Number(a.reviews||0)});
 filtered.forEach((c,i)=>area.append(resultCard(c,i)));
}
function render(){renderCentral();renderToday();renderClients();renderArchive();renderRadar();}
async function checkPlaces(){
 try{const x=await backend('local-radar');state.placesReady=!!x.ready;
 $('#placesNotice').textContent=x.ready?'Google Places conectado · limite '+x.dailyLimit+' varreduras/dia.':'Google Places ainda não configurado. Cadastro manual liberado; buscas ficam desabilitadas até adicionar GOOGLE_PLACES_API_KEY na Vercel.';
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
  const data=await backend('local-radar','POST',{niche,city});
  state.niche=niche;state.city=city;
  $('#radarProgress').classList.remove('busy');
  const all=data.results||[];
  $('#scanProgressText').textContent='Resultados recebidos · classificando os links e contatos';
  for(let i=0;i<all.length;i++){
   state.results.push(all[i]);
   $('#scanProgressCount').textContent=(i+1)+' / '+all.length;
   $('#scanProgressBar').style.width=Math.round((i+1)/Math.max(1,all.length)*100)+'%';
   renderRadar();
   if(!matchMedia('(prefers-reduced-motion: reduce)').matches)await wait(85);
  }
  $('#scanProgressText').textContent='Varredura concluída · confira os candidatos';
  $('#radarExplain').textContent=all.length+' estabelecimentos encontrados · '+all.filter(eligible).length+' dentro dos filtros. Sites e agendamentos ainda podem exigir sua verificação.';
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
function populateLead(){
 const d=state.draft;if(!d)return;
 $('#leadDialogTitle').textContent=d.name||'Nova oportunidade';
 const source=$('#leadSource');source.replaceChildren();
 source.append(dom('span','',d.rating!=null?'★ '+formatStars(d.rating)+' · '+(d.reviews??'—')+' avaliações':'Sem nota verificada'),dom('span','',siteLabel(d.link_type)));
 const u=safeUrl(d.maps_url);
 if(u){const a=dom('a','','Abrir no Maps ↗');a.href=u;a.target='_blank';a.rel='noopener noreferrer';source.append(a)}
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
 $('#leadMessage').value=d.last_message||templateMessage(d);
 $('#leadActionBar').hidden=true;
 $('#openWhatsapp').hidden=d.channel==='email';
 $('#queueGmail').hidden=d.channel!=='email';
 updateRecommendation(false);
}
function updateRecommendation(replaceText){
 const d=state.draft;if(!d)return;
 const recommendation=offerFor(d),container=$('#leadRecommendation');container.replaceChildren();
 container.append(dom('strong','',recommendation.blocked?'Atenção · revisar antes de abordar':('Prioridade '+({alta:'alta',investigar:'vale investigar',baixa:'baixa'})[priority(d).type]+' · '+(d.offer==='bot'?'Oferta: bot':'Oferta: landing'))),dom('p','',priority(d).why+' '+recommendation.why));
 $('#leadWarning').textContent=recommendation.blocked?'O Radar não recomenda gerar landing automaticamente para este caso. Confira antes de prosseguir.':d.link_type==='none'?'Sem link no Google não significa que o negócio não tenha site. Confirme antes de afirmar isso.':'Todo dado não verificado deve permanecer como hipótese.';
 if(replaceText){d.offer=recommendation.offer;d.angle=recommendation.angle;$('#leadOffer').value=d.offer;$('#leadAngle').value=d.angle;$('#leadMessage').value=templateMessage(d);d.last_message=$('#leadMessage').value}
}
function openLead(candidate){
 const stored=candidate.id?state.leads.find(x=>x.id===candidate.id):state.leads.find(x=>candidate.place_id&&x.place_id===candidate.place_id);
 state.draft=blankLead(stored||candidate);
 populateLead();
 $('#leadOverlay').hidden=false;document.body.style.overflow='hidden';
 $('#closeLead').focus();
}
function closeLead(){state.draft=null;$('#leadOverlay').hidden=true;document.body.style.overflow=''}
async function saveLead(showToast=true){
 fromFields();
 const d=state.draft;
 if(!d?.name){toast('Informe o nome do negócio.');return null}
 if(d.email&&!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(d.email)){toast('E-mail inválido.');return null}
 try{
  const saved=await rpc('crm_local_save',{p_data:{...d,place_id:d.place_id||null}});
  state.draft=blankLead(saved);await refresh();
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
 if(!number){toast('Informe um telefone com DDD antes de abrir o WhatsApp.');return}
 const msg=($('#leadMessage').value||'').trim();
 if(!msg){toast('Revise a mensagem antes de abrir.');return}
 const url='https://wa.me/'+number+'?text='+encodeURIComponent(msg);
 window.open(url,'_blank','noopener,noreferrer');
 state.pendingSend=true;
 $('#leadActionBar').hidden=false;
 void saveLead(false);
 toast('Conversa aberta. Só marque enviado depois de confirmar o envio no WhatsApp.');
}
async function prepareEmail(){
 fromFields();const d=state.draft;
 if(!d.email){toast('Cadastre o e-mail comercial primeiro.');return}
 const saved=await saveLead(false);if(!saved)return;
 const msg=$('#leadMessage').value.trim();
 if(!msg){toast('Prepare uma mensagem primeiro.');return}
 try{
  const reply=await backend('outreach','POST',{action:'queue-add',company:saved.name,email:saved.email,subject:'Uma ideia para a '+saved.name,text:msg,leadId:saved.id,type:saved.followup_count>0?'followup':'initial'});
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
function templateLibrary(){
 const root=$('#templateLibrary');root.replaceChildren();
 for(const [name,body] of TEMPLATES){const card=dom('div','template');card.append(dom('h4','',name),dom('p','',body));root.append(card)}
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
  if(shouldSync&&data.connected)await syncGmail();
  await loadEmailQueue();
 }catch(e){$('#gmailState').textContent=e.message}
}
async function syncGmail(){
 const list=state.leads.filter(x=>x.email&&x.contacted_at&&x.channel==='email').map(x=>({id:x.id,name:x.name,email:x.email,sentAt:x.contacted_at}));
 if(!list.length){toast('Ainda não há leads abordados por e-mail para sincronizar.');return}
 try{
  $('#gmailState').textContent='Sincronizando mensagens vinculadas…';
  const data=await backend('gmail','POST',{action:'sync',leads:list});
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
   action.onclick=async()=>{
    if(!confirm('Confirma o envio deste e-mail para '+q.email+'?'))return;
    action.disabled=true;
    try{
     const sent=await backend('outreach','POST',{action:'send',id:q.id,approved:true});
     await rpc('crm_local_action',{p_lead_id:q.leadId,p_type:'abordado',p_note:'E-mail enviado com aprovação humana: '+q.subject,p_channel:'email',p_offer:'landing',p_angle:'A'});
     const c=state.leads.find(x=>x.id===q.leadId);if(c){c.contacted_at=sent.sent?.sentAt||now();c.channel='email';await rpc('crm_local_save',{p_data:c})}
     await refresh();await loadEmailQueue();toast('E-mail enviado e registrado.');
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
function bind(){
 window.addEventListener('hashchange',setNav);
 $('#loginForm').addEventListener('submit',e=>{e.preventDefault();signIn()});
 $('#refreshApp').onclick=()=>refresh().then(()=>toast('Carteira atualizada.')).catch(e=>toast(e.message));
 $('#localForm').addEventListener('submit',scan);
 $$('[data-niche]').forEach(b=>b.addEventListener('click',()=>{
  $$('[data-niche]').forEach(x=>x.classList.toggle('active',x===b));
  $('#localNiche').value=b.dataset.niche;
 }));
 $('#minRating').addEventListener('change',renderRadar);$('#minReviews').addEventListener('change',renderRadar);
 $('#filterEligible').onclick=()=>{state.filterOutside=false;$('#filterEligible').classList.add('active');$('#filterOutside').classList.remove('active');renderRadar()};
 $('#filterOutside').onclick=()=>{state.filterOutside=true;$('#filterOutside').classList.add('active');$('#filterEligible').classList.remove('active');renderRadar()};
 $$('[data-today]').forEach(b=>b.addEventListener('click',()=>{state.todayFilter=b.dataset.today;$$('[data-today]').forEach(x=>x.classList.toggle('active',x===b));renderToday()}));
 $('#clientStatus').addEventListener('change',renderClients);$('#clientSearch').addEventListener('input',renderClients);
 $('#manualAdd').onclick=()=>openLead({});$('#addClient').onclick=()=>openLead({});
 $('#closeLead').onclick=closeLead;
 $('#leadOverlay').addEventListener('click',e=>{if(e.target===$('#leadOverlay'))closeLead()});
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#leadOverlay').hidden)closeLead()});
 $('#saveLead').onclick=()=>saveLead();
 $('#markResponse').onclick=statusChooser;
 $('#openWhatsapp').onclick=openWhatsApp;
 $('#confirmSent').onclick=async()=>{if(!confirm('Você realmente enviou a mensagem pelo WhatsApp?'))return;fromFields();const d=state.draft;if(!d)return;await action(d.status==='abordado'?'followup':'abordado',d.last_message)};
 $('#queueGmail').onclick=prepareEmail;
 $('#leadChannel').addEventListener('change',()=>{fromFields();$('#openWhatsapp').hidden=state.draft.channel==='email';$('#queueGmail').hidden=state.draft.channel!=='email'});
 $('#leadOffer').addEventListener('change',()=>{fromFields();$('#leadMessage').value=templateMessage(state.draft);state.draft.last_message=$('#leadMessage').value;updateRecommendation(false)});
 $('#leadAngle').addEventListener('change',()=>{fromFields();$('#leadMessage').value=templateMessage(state.draft);state.draft.last_message=$('#leadMessage').value;updateRecommendation(false)});
 $('#leadWebsite').addEventListener('change',()=>{fromFields();updateRecommendation(true)});
 $('#gmailSync').onclick=syncGmail;
 $('#gmailConnect').onclick=gmailConnect;
 $('#gmailDetails').addEventListener('toggle',()=>{if($('#gmailDetails').open)loadGmail(false)});
}
async function init(){
 templateLibrary();bind();setNav();render();
 if(!state.key){showLogin();return}
 try{await refresh();$('#authOverlay').hidden=true;checkPlaces()}
 catch(e){localStorage.removeItem(KEY_NAME);sessionStorage.removeItem(KEY_NAME);state.key='';showLogin();$('#connectionState').classList.add('error')}
}
init();
})();