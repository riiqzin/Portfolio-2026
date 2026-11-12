/* Ricky Outreach: manual approval is required for every individual email. */
window.RickyOutreach={
 mount({getKey,getLeads,refreshLeads,addRadarLead,markSent}){
  const $=s=>document.querySelector(s),make=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e};
  const panel=$('#outreachPanel'),list=$('#outQueue'),timeline=$('#outTimeline'),templates=$('#outTemplates'),status=$('#outStatus');
  const leadSel=$('#outLead'),templateSel=$('#outTemplate'),subject=$('#outSubject'),body=$('#outBody');
  let data={templates:[],queue:[],sent:[],followups:[],connected:false,canSend:false},busy=false;
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
   const selected=templateSel.value;templateSel.replaceChildren();
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
    [saveBtn,sendBtn,delBtn].forEach(btn=>{btn.type='button';actions.append(btn)});
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
     return lead.active&&email&&date&&now-Date.parse(date)>5*86400000&&!lead.responded_at
       &&!data.sent.some(sent=>sent.email===email)&&!data.queue.some(item=>item.email===email);
   }).slice(0,15);
   const totalFollowups=data.followups.length+oldFollowups.length;
   const summary=make('div',undefined,'out-stats');
   for(const [num,label] of [[data.queue.length,'Na fila'],[totalFollowups,'Follow-ups'],[data.sent.length,'Enviados (histórico)']]){
    const metric=make('div',undefined,'out-stat');metric.append(make('strong',String(num)),make('span',label));summary.append(metric);
   }
   timeline.append(summary);
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
   for(const [selector,value] of [['#dashQueued',data.queue.length],['#dashFollowups',data.followups.length+getLeads().filter(l=>l.active&&l.prospect_email&&!l.responded_at&&(l.email_sent_at||l.email_sent_date)&&Date.now()-Date.parse(l.email_sent_at||l.email_sent_date)>5*86400000&&!data.sent.some(s=>s.email===String(l.prospect_email).toLowerCase().split(/[,;\s]+/)[0])).length],['#dashSent',data.sent.length]]){
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
  leadSel.addEventListener('change',compose);templateSel.addEventListener('change',compose);
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
  window.RickyOutreach.stageProspect=stageProspect;
  window.RickyOutreach.openForLead=id=>{location.hash='#outreach';refresh().then(()=>{leadSel.value=id;compose()})};
  function navigate(){
   const active=location.hash==='#outreach';
   document.body.classList.toggle('outreach-active',active);panel.hidden=!active;
   if(active){
    document.querySelectorAll('.sidebar .nav-item').forEach(a=>{a.classList.toggle('selected',a.hash==='#outreach');if(a.hash==='#outreach')a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
    refresh();
   }
  }
  addEventListener('hashchange',navigate);
  window.RickyOutreach.refreshSummary=refresh;
  setInterval(()=>{if(getKey()&&!document.hidden&&location.hash!=='#outreach')refresh()},90000);
  navigate();
  if(getKey())refresh();
 }
};