/* Ricky Outreach: manual approval is required for every individual email. */
window.RickyOutreach={
 mount({getKey,getLeads,refreshLeads,addRadarLead,markSent}){
  const $=s=>document.querySelector(s),make=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e};
  const panel=$('#outreachPanel'),list=$('#outQueue'),timeline=$('#outTimeline'),templates=$('#outTemplates'),status=$('#outStatus');
  const leadSel=$('#outLead'),templateSel=$('#outTemplate'),subject=$('#outSubject'),body=$('#outBody');
  let data={templates:[],queue:[],sent:[],followups:[],connected:false,canSend:false},busy=false;
  const NEW_PHASE=Date.parse('2026-11-12T00:00:00-03:00');
  const chosenTemplate=()=>localStorage.getItem('ricky_crm_template_default')||'initial';
  async function api(action,payload={}){
   const isRead=action==='GET';
   const response=await fetch('/api/outreach',{method:isRead?'GET':'POST',headers:{Authorization:'Bearer '+getKey(),'Content-Type':'application/json'},...(!isRead?{body:JSON.stringify({...payload,action})}:{}),cache:'no-store',signal:AbortSignal.timeout(isRead?18000:35000)});
   const result=await response.json().catch(()=>({message:'Resposta inválida do servidor.'}));
   if(!response.ok)throw Error(result.message||'Falha na operação.');
   return result;
  }
  const templateValues=(template,lead)=>({
    subject:template.subject.replace(/\{\{empresa\}\}/gi,lead.name||lead.company||'sua loja').replace(/\{\{segmento\}\}/gi,lead.segment||'e-commerce').replace(/\{\{observacao\}\}/gi,''),
    text:template.body.replace(/\{\{empresa\}\}/gi,lead.name||lead.company||'sua loja').replace(/\{\{segmento\}\}/gi,lead.segment||'e-commerce').replace(/\{\{observacao\}\}/gi,'')
  });
  function setStatus(msg){status.textContent=msg}
  function option(label,value){const o=make('option',label);o.value=value;return o}
  function populateSelectors(){
   const previous=leadSel.value;
   leadSel.replaceChildren(option('Selecione um lead com e-mail',''));
   const names=new Set();
   for(const lead of getLeads().filter(x=>x.active&&x.prospect_email)){
    const email=String(lead.prospect_email).split(/[,;\s]+/)[0];if(!email)continue;
    const item=option(lead.name+' · '+email,lead.id);item.dataset.email=email;leadSel.append(item);names.add(lead.id);
   }
   if(names.has(previous))leadSel.value=previous;
   const selected=templateSel.value||chosenTemplate();templateSel.replaceChildren();
   for(const t of data.templates)templateSel.append(option(t.name,t.id));
   if(data.templates.some(t=>t.id===selected))templateSel.value=selected;
  }
  function compose(){
   const t=data.templates.find(t=>t.id===templateSel.value);
   const lead=getLeads().find(l=>l.id===leadSel.value);
   if(!t||!lead)return;
   const v=templateValues(t,{name:lead.name,segment:'lojas virtuais'});subject.value=v.subject;body.value=v.text;
  }
  function cardTitle(title,detail){const div=make('div',undefined,'out-card-title');div.append(make('strong',title),make('small',detail,'out-muted'));return div}
  async function invoke(action,payload={},ok='Atualizado.'){
    if(busy)return null;busy=true;
    try{const result=await api(action,payload);setStatus(ok);await refresh();return result}
    catch(e){setStatus(e.message);return null}finally{busy=false}
  }
  function renderQueue(){
   list.replaceChildren();
   if(!data.queue.length){list.append(make('p','Nenhuma mensagem na fila. Selecione um lead com contato ou adicione uma loja pelo Radar.','out-muted'));return}
   for(const item of data.queue){
    const card=make('article',undefined,'out-card'),top=cardTitle(item.company,item.email+' · '+(item.type==='followup'?'Follow-up':'Primeiro contato'));
    const s=make('input');s.type='text';s.maxLength=180;s.value=item.subject;s.setAttribute('aria-label','Assunto para '+item.company);
    const t=make('textarea');t.rows=5;t.maxLength=5500;t.value=item.text;t.setAttribute('aria-label','Mensagem para '+item.company);
    const actions=make('div',undefined,'out-actions'),saveBtn=make('button','Salvar alterações','ghost'),sendBtn=make('button','Revisar e enviar','primary'),delBtn=make('button','Remover','ghost');
    if(item.scheduledAt)top.append(make('small','Envio programado: '+new Date(item.scheduledAt).toLocaleString('pt-BR')+' · próxima verificação disponível','out-scheduled'));
    [saveBtn,sendBtn,delBtn].forEach(btn=>{btn.type='button';actions.append(btn)});
    if(item.scheduledAt){const cancel=make('button','Cancelar agendamento','ghost');cancel.type='button';cancel.addEventListener('click',()=>invoke('unschedule',{id:item.id},'Agendamento cancelado. Rascunho mantido na fila.'));actions.append(cancel)}
    saveBtn.addEventListener('click',()=>invoke('queue-update',{id:item.id,subject:s.value,text:t.value},'Rascunho salvo.'));
    delBtn.addEventListener('click',()=>invoke('queue-remove',{id:item.id},'Removido da fila.'));
    sendBtn.disabled=!data.canSend;
    sendBtn.title=data.canSend?'Envio somente após confirmação':'É necessário reconectar o Gmail com permissão de envio.';
    sendBtn.addEventListener('click',async()=>{
      if(!s.value.trim()||!t.value.trim()){setStatus('Preencha assunto e corpo.');return}
      if(s.value!==item.subject||t.value!==item.text){
       const changed=await invoke('queue-update',{id:item.id,subject:s.value,text:t.value},'Rascunho atualizado. Confira novamente antes do envio.');
       if(changed)return;return;
      }
      if(!confirm('Confirmar o envio de UMA mensagem para '+item.email+' usando a conta '+ 'rickymanginidev@gmail.com'+'?\n\nAssunto: '+item.subject+'\n\nVocê revisou o conteúdo e deseja enviar agora?'))return;
      const result=await invoke('send',{id:item.id,approved:true},'Gmail confirmou o envio de '+item.email+'.');
      if(result?.sent&&markSent)await markSent(result.sent);
    });
    card.append(top,s,t,actions);list.append(card);
   }
  }
  function renderTimeline(){
   timeline.replaceChildren();
   const now=Date.now();
   const oldFollowups=getLeads().filter(lead=>{
     const date=lead.email_sent_at||lead.email_sent_date;
     const email=String(lead.prospect_email||'').toLowerCase().split(/[,;\s]+/)[0];
     return lead.active&&email&&date&&Date.parse(date)>=NEW_PHASE&&now-Date.parse(date)>5*86400000&&!lead.responded_at
       &&!data.sent.some(sent=>sent.email===email)&&!data.queue.some(item=>item.email===email);
   }).slice(0,15);
   const totalFollowups=data.followups.length+oldFollowups.length;
   const summary=make('div',undefined,'out-stats');
   for(const [num,label] of [[data.queue.length,'Na fila'],[totalFollowups,'Follow-ups'],[data.sent.length,'Enviados (histórico)']]){
    const metric=make('div',undefined,'out-stat');metric.append(make('strong',String(num)),make('span',label));summary.append(metric);
   }
   timeline.append(summary);
   const candidates=getLeads().filter(lead=>{
     const email=String(lead.prospect_email||'').toLowerCase().split(/[,;\s]+/)[0];
     return lead.active&&email&&!lead.email_sent_at&&!lead.responded_at&&!data.queue.some(x=>x.email===email)&&!data.sent.some(x=>x.email===email);
   }).slice(0,5);
   timeline.append(make('h3','Até 5 leads prontos para abordar'));
   if(!candidates.length)timeline.append(make('p','Nenhum lead novo com e-mail disponível. Use o Radar para encontrar mais lojas.','out-muted'));
   for(const lead of candidates){
     const email=String(lead.prospect_email).toLowerCase().split(/[,;\s]+/)[0];
     const row=make('article',undefined,'out-card out-followup');
     row.append(cardTitle(lead.name,email+' · Ainda não abordado'));
     const btn=make('button','Preparar abordagem','primary');btn.type='button';
     btn.addEventListener('click',async()=>{
       const template=data.templates.find(t=>t.id==='initial')||data.templates[0];
       const v=templateValues(template,{name:lead.name,segment:'e-commerce'});
       await invoke('queue-add',{company:lead.name,email,leadId:lead.id,type:'initial',subject:v.subject,text:v.text},'Abordagem colocada na fila para aprovação.');
     });
     row.append(btn);timeline.append(row);
   }
   const heading=make('h3','Acompanhamentos para revisar');timeline.append(heading);
   if(!totalFollowups)timeline.append(make('p','Nenhum follow-up vencido registrado no CRM.','out-muted'));
   for(const sent of data.followups){
    const row=make('article',undefined,'out-card out-followup');row.append(cardTitle(sent.company,'Primeiro envio: '+new Date(sent.sentAt).toLocaleDateString('pt-BR')+' · '+sent.email));
    const actions=make('div',undefined,'out-actions'),draft=make('button','Preparar follow-up','primary'),dismiss=make('button','Dispensar','ghost');actions.append(draft,dismiss);
    draft.addEventListener('click',async()=>{
     const template=data.templates.find(t=>t.id==='followup')||data.templates[0];
     const v=templateValues(template,{name:sent.company,segment:'e-commerce'});
     const added=await invoke('queue-add',{company:sent.company,email:sent.email,leadId:sent.leadId,type:'followup',subject:v.subject,text:v.text},'Follow-up adicionado à fila para aprovação.');
     if(added){location.hash='#outreach';$('#outQueue').scrollIntoView({behavior:'smooth'})}
    });
    dismiss.addEventListener('click',()=>invoke('followup-dismiss',{id:sent.id},'Sugestão dispensada.'));
    row.append(actions);timeline.append(row);
   }
   for(const lead of oldFollowups){
    const email=String(lead.prospect_email).toLowerCase().split(/[,;\s]+/)[0];
    const row=make('article',undefined,'out-card out-followup');
    row.append(cardTitle(lead.name,email+' · Envio registrado anteriormente no CRM, sem resposta marcada'));
    const draft=make('button','Preparar retorno','ghost');draft.type='button';
    draft.addEventListener('click',async()=>{
      const template=data.templates.find(t=>t.id==='followup')||data.templates[0];
      const v=templateValues(template,{name:lead.name,segment:'e-commerce'});
      await invoke('queue-add',{company:lead.name,email,leadId:lead.id,type:'followup',subject:v.subject,text:v.text},'Follow-up anterior preparado para sua revisão.');
    });
    row.append(draft);timeline.append(row);
   }
   const history=make('details');history.append(make('summary','Histórico de envios ('+data.sent.length+')'));
   for(const sent of data.sent.slice(0,60)){
    const r=make('p',sent.company+' · '+sent.email+' · '+new Date(sent.sentAt).toLocaleString('pt-BR')+(sent.type==='followup'?' · Follow-up':''),'out-muted');history.append(r);
   }
   timeline.append(history);
  }
  function renderTemplates(){
   templates.replaceChildren();
   for(const t of data.templates){
    const form=make('form',undefined,'out-template');
    const name=make('input'),sub=make('input'),txt=make('textarea');
    name.value=t.name;name.maxLength=70;name.required=true;name.setAttribute('aria-label','Nome do modelo');
    sub.value=t.subject;sub.maxLength=180;sub.required=true;sub.setAttribute('aria-label','Assunto do modelo');
    txt.value=t.body;txt.rows=5;txt.maxLength=5000;txt.required=true;txt.setAttribute('aria-label','Texto do modelo');
    const row=make('div',undefined,'out-actions'),saveBtn=make('button','Salvar modelo','primary'),remove=make('button','Excluir','ghost');saveBtn.type='submit';remove.type='button';
    form.addEventListener('submit',async e=>{e.preventDefault();await invoke('template-save',{id:t.id,name:name.value,subject:sub.value,text:txt.value},'Modelo atualizado.')});
    remove.addEventListener('click',()=>{if(confirm('Excluir este modelo?'))invoke('template-delete',{id:t.id},'Modelo excluído.')});
    row.append(saveBtn,remove);form.append(name,sub,txt,row);templates.append(form);
   }
  }
  function render(){
   populateSelectors();renderQueue();renderTimeline();renderTemplates();
   $('#outMailbox').textContent=data.connected?(data.canSend?'Gmail conectado · leitura e envio autorizados':'Gmail conectado · falta autorizar o envio'):'Gmail não conectado';
   $('#outSendHelp').hidden=data.canSend;
   $('#outCount').textContent=data.queue.length+' para revisar';
   for(const [selector,value] of [['#dashQueued',data.queue.length],['#dashFollowups',data.followups.length+getLeads().filter(l=>l.active&&l.prospect_email&&!l.responded_at&&(l.email_sent_at||l.email_sent_date)&&Date.parse(l.email_sent_at||l.email_sent_date)>=NEW_PHASE&&Date.now()-Date.parse(l.email_sent_at||l.email_sent_date)>5*86400000&&!data.sent.some(s=>s.email===String(l.prospect_email).toLowerCase().split(/[,;\s]+/)[0])).length],['#dashSent',data.sent.length]]){
     const el=$(selector);if(el)el.textContent=String(value);
   }
  }
  async function refresh(){
   if(!getKey())return;
   try{data=await api('GET');render()}catch(e){setStatus(e.message)}
  }
  $('#outStage').addEventListener('click',async()=>{
   const lead=getLeads().find(l=>l.id===leadSel.value);
   if(!lead){setStatus('Selecione um lead com e-mail cadastrado.');return}
   const email=String(lead.prospect_email||'').split(/[,;\s]+/)[0];
   await invoke('queue-add',{leadId:lead.id,company:lead.name,email,subject:subject.value,text:body.value,type:'initial'},'Mensagem adicionada à fila. Revise antes de enviar.');
  });
  leadSel.addEventListener('change',compose);templateSel.addEventListener('change',()=>{localStorage.setItem('ricky_crm_template_default',templateSel.value);compose()});
  $('#outReload').addEventListener('click',refresh);
  $('#outNewTemplate').addEventListener('click',async()=>{
   const name=prompt('Nome do novo modelo:');if(!name)return;
   await invoke('template-save',{name,subject:'Uma ideia para a {{empresa}}',text:'Olá! Tudo bem?\n\nEncontrei a {{empresa}} e gostaria de conversar sobre melhorias para seu site.\n\nObrigado!'},'Modelo criado. Edite abaixo.');
  });
  async function stageProspect({name,domain,email,segment}){
   if(!getKey())throw Error('Entre no CRM antes de adicionar à fila.');
   const lead=await addRadarLead({name,domain,email});
   const template=data.templates.find(t=>t.id==='initial')||{subject:'Uma ideia para a {{empresa}}',body:'Oi! Tudo bem? Gostaria de conversar sobre uma ideia para a {{empresa}}.'};
   const v=templateValues(template,{name,segment:segment||'e-commerce'});
   const result=await api('queue-add',{company:name,email,leadId:lead?.id||'',subject:v.subject,text:v.text,type:'initial'});
   await refresh();location.hash='#outreach';setStatus('Loja adicionada à fila. Confira e aprove o envio.');
   return result;
  }

  // Fast contextual composer for Radar: no extra navigation or project URL required.
  const radarModal=document.createElement('div');
  radarModal.className='out-quick-overlay';
  radarModal.hidden=true;
  radarModal.innerHTML='<div class="out-quick-dialog" role="dialog" aria-modal="true" aria-labelledby="outQuickTitle"><div class="out-quick-header"><div><span class="out-eyebrow">RADAR / NOVA OPORTUNIDADE</span><h2 id="outQuickTitle">Preparar abordagem</h2></div><button type="button" class="out-quick-close" aria-label="Fechar">×</button></div><form class="out-quick-form"><div class="out-quick-row"><label>Loja<input name="company" required maxlength="130"></label><label>E-mail comercial<input name="email" type="email" required placeholder="contato@loja.com.br"></label></div><label>Modelo<select name="template"></select></label><label>Assunto<input name="subject" maxlength="180" required></label><label>Mensagem<textarea name="message" rows="8" required maxlength="5500"></textarea></label><div class="out-quick-row"><label>Link do seu portfólio (opcional)<input name="portfolio" type="url" placeholder="https://seuportfolio.com"></label><label>Envio agendado (opcional)<input name="when" type="datetime-local"></label></div><button class="ghost out-insert-link" type="button">Inserir link na mensagem</button><p class="out-muted">Links completos com https:// serão clicáveis no Gmail. Agendamentos são verificados com o CRM aberto e na rotina diária da Vercel, sem garantia de minuto exato.</p><p class="out-quick-status" role="status"></p><div class="out-quick-actions"><button class="ghost" name="queue" type="button">Salvar para depois</button><button class="ghost" name="schedule" type="button">Agendar envio</button><button class="primary" name="send" type="button">Revisar e enviar agora</button></div></form></div>';
  document.body.append(radarModal);
  const qf=radarModal.querySelector('form'),qc=qf.elements.company,qe=qf.elements.email,qt=qf.elements.template,qs=qf.elements.subject,qb=qf.elements.message;
  const qp=qf.elements.portfolio,qw=qf.elements.when;
  qf.addEventListener('submit',event=>event.preventDefault());
  let quickContext=null,quickBusy=false,quickSavedId=null;
  qp.value=localStorage.getItem('ricky_crm_portfolio_url')||'https://portfolio-ricky-mangini.vercel.app/';
  radarModal.querySelector('.out-insert-link').addEventListener('click',()=>{
    if(!qp.reportValidity()||!/^https:\/\//i.test(qp.value)){quickMessage('Informe uma URL completa começando com https://');return}
    localStorage.setItem('ricky_crm_portfolio_url',qp.value);
    const start=qb.selectionStart??qb.value.length,end=qb.selectionEnd??qb.value.length;
    qb.setRangeText(qp.value,start,end,'end');qb.focus();
  });
  function quickMessage(text){radarModal.querySelector('.out-quick-status').textContent=text}
  function closeQuick(){if(quickBusy)return;radarModal.hidden=true;document.body.classList.remove('out-quick-open')}
  radarModal.querySelector('.out-quick-close').addEventListener('click',closeQuick);
  radarModal.addEventListener('click',e=>{if(e.target===radarModal)closeQuick()});
  addEventListener('keydown',e=>{if(e.key==='Escape'&&!radarModal.hidden)closeQuick()});
  function quickTemplate(){
    const selected=data.templates.find(t=>t.id===qt.value)||data.templates[0];
    if(!selected)return;
    const v=templateValues(selected,{name:qc.value,segment:quickContext?.segment||'lojas virtuais'});
    qs.value=v.subject;qb.value=v.text;localStorage.setItem('ricky_crm_template_default',selected.id);
  }
  qt.addEventListener('change',quickTemplate);
  async function openRadarComposer(prospect){
    if(!getKey())throw Error('Entre no CRM para preparar o contato.');
    if(quickBusy)return;
    await refresh();
    quickContext=prospect;quickSavedId=null;
    qc.value=String(prospect.name||'').replace(/\s+[|–—-]\s+.*$/,'').trim().slice(0,130);
    qe.value=String(prospect.email||'').trim();
    qt.replaceChildren();
    for(const item of data.templates)qt.append(option(item.name,item.id));
    if(data.templates.some(t=>t.id===chosenTemplate()))qt.value=chosenTemplate();
    quickTemplate();
    quickMessage(!qe.value?'Contato não encontrado automaticamente. Preencha o e-mail comercial para continuar.':'Confira o contato e revise a mensagem antes de enviar.');
    radarModal.hidden=false;document.body.classList.add('out-quick-open');
    (qe.value?qt:qe).focus();
  }
  async function saveQuick(){
    if(!qf.reportValidity())return null;
    quickBusy=true;quickMessage('Preparando lead e mensagem...');
    try{
      let lead;
      if(quickContext?.leadId){lead=getLeads().find(l=>l.id===quickContext.leadId)}
      if(!lead)lead=await addRadarLead({name:qc.value,domain:quickContext?.domain,email:qe.value});
      const payload={company:qc.value,email:qe.value,leadId:lead?.id||'',subject:qs.value,text:qb.value,type:'initial'};
      if(!quickSavedId){
        const result=await api('queue-add',payload);quickSavedId=result.item.id;
      }else await api('queue-update',{id:quickSavedId,subject:qs.value,text:qb.value,email:qe.value,company:qc.value});
      quickMessage('Mensagem salva na fila. Você pode enviar agora ou voltar depois.');
      await refresh();return quickSavedId;
    }catch(error){quickMessage(error.message||'Erro ao preparar abordagem.');return null}
    finally{quickBusy=false}
  }
  qf.elements.queue.addEventListener('click',async()=>{
    const id=await saveQuick();if(id){closeQuick();location.hash='#outreach';setStatus('Abordagem na fila para revisão.')}
  });
  qf.elements.schedule.addEventListener('click',async()=>{
    if(!qw.value){quickMessage('Escolha uma data e hora para agendar.');qw.focus();return}
    const at=new Date(qw.value);
    if(!Number.isFinite(at.getTime())||at.getTime()<Date.now()+120000){quickMessage('Escolha um horário futuro, com pelo menos dois minutos de antecedência.');return}
    if(!confirm('Autorizar o envio de UMA mensagem para '+qe.value+' no horário programado? O envio será executado na primeira verificação disponível, que pode ser posterior ao horário selecionado.'))return;
    const id=await saveQuick();if(!id)return;
    quickBusy=true;
    try{await api('schedule',{id,approved:true,scheduledAt:at.toISOString()});await refresh();quickMessage('Envio agendado para a próxima verificação após '+at.toLocaleString('pt-BR')+'.');quickBusy=false;closeQuick();location.hash='#outreach';setStatus('Envio agendado. O horário exato depende da rotina de verificação.')}catch(e){quickMessage('Rascunho salvo, mas não agendado: '+e.message)}finally{quickBusy=false}
  });
  qf.elements.send.addEventListener('click',async()=>{
    if(!qf.reportValidity())return;
    // Keep the lead and unsent draft even if Google has not authorized gmail.send.
    const id=await saveQuick();if(!id)return;
    if(!data.canSend){quickMessage('Rascunho salvo. Para enviar, autorize a permissão de envio na aba Respostas.');return}
    if(!confirm('Enviar UMA mensagem comercial para '+qe.value+' usando rickymanginidev@gmail.com?\n\nAssunto: '+qs.value+'\n\nConfirme que revisou o conteúdo.'))return;
    quickBusy=true;quickMessage('Enviando pelo Gmail...');
    try{
      const result=await api('send',{id,approved:true});
      if(result?.sent&&markSent)await markSent(result.sent);
      quickMessage('Envio confirmado pelo Gmail e registrado no CRM.');
      quickSavedId=null;await refresh();
      quickBusy=false;closeQuick();location.hash='#outreach';
      setStatus('Enviado com sucesso. O histórico foi atualizado.');
    }catch(error){quickMessage('O rascunho permanece salvo: '+(error.message||'Envio não confirmado.'))}
    finally{quickBusy=false}
  });
  window.RickyOutreach.openRadarComposer=openRadarComposer;

  window.RickyOutreach.stageProspect=stageProspect;
  window.RickyOutreach.openForLead=id=>{location.hash='#outreach';refresh().then(()=>{leadSel.value=id;compose()})};
  function navigate(){
   const active=location.hash==='#outreach';
   document.body.classList.toggle('outreach-active',active);panel.hidden=!active;
   const navigation=document.querySelectorAll('.sidebar .nav-item');
   if(active){
    navigation.forEach(a=>{a.classList.toggle('selected',a.hash==='#outreach');if(a.hash==='#outreach')a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
    refresh();
   }else{
    const link=[...navigation].find(a=>a.hash==='#outreach');if(link){link.classList.remove('selected');link.removeAttribute('aria-current')}
   }
  }
  addEventListener('hashchange',navigate);
  window.RickyOutreach.refreshSummary=refresh;
  setInterval(async()=>{
    if(!getKey()||document.hidden||busy)return;
    try{const completed=await api('send-due');if(completed.sent)await refresh();else if(location.hash!=='#outreach')await refresh()}catch{}
  },90000);
  navigate();
  if(getKey())refresh();
 }
};