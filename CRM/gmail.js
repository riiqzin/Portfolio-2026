/* Gmail inbox widget: never render email content as HTML, never send email automatically. */
window.RickyGmail = {
 mount({getKey,getLeads,markReplied}) {
  const $=s=>document.querySelector(s);
  const panel=$('#gmailPanel'),status=$('#gmailStatus'),list=$('#gmailResults'),connect=$('#gmailConnect'),sync=$('#gmailSync'),disconnect=$('#gmailDisconnect'),reconnect=$('#gmailReconnect'),state=$('#gmailConnection');
  let connected=false,busy=false,lastSync=0;
  const node=(tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el};
  async function api(method,body){
    const response=await fetch('/api/gmail',{method,cache:'no-store',headers:{Authorization:'Bearer '+getKey(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});
    const data=await response.json().catch(()=>({message:'Resposta inesperada do servidor.'}));
    if(!response.ok)throw Error(data.message||'Gmail indisponível.');
    return data;
  }
  const leadInput=()=>getLeads().filter(l=>l.active&&l.prospect_email).map(l=>({id:l.id,name:l.name,email:l.prospect_email,sentAt:l.email_sent_at||l.email_sent_date||''}));
  function show(items){
    list.replaceChildren();
    const sorted=[...items].sort((a,b)=>({alta:0,'média':1,baixa:2}[a.priority]??3)-({alta:0,'média':1,baixa:2}[b.priority]??3) || Date.parse(b.receivedAt)-Date.parse(a.receivedAt));
    for(const item of sorted){
      const card=node('article','','gmail-card');
      const top=node('div','','gmail-card-head');
      top.append(node('strong',item.name||item.email),node('span',item.label||'Revisar','gmail-pill '+(item.priority==='alta'?'high':item.priority==='baixa'?'low':'')));
      card.append(top,node('small',(item.email||'')+' · '+(item.receivedAt?new Date(item.receivedAt).toLocaleString('pt-BR'):'')+' · '+(item.source==='openai'?'IA':'Regras'),'gmail-muted'));
      if(item.summary)card.append(node('p',item.summary,'gmail-summary'));
      card.append(node('p','Próximo passo: '+(item.next||'Revisar a conversa.'),'gmail-next'));
      const a=node('a','Abrir conversa no Gmail ↗','gmail-link');a.href='https://mail.google.com/mail/u/0/#all/'+encodeURIComponent(item.threadId||'');a.target='_blank';a.rel='noopener noreferrer';card.append(a);
      list.append(card);
    }
    const awaiting=leadInput().filter(l=>!!l.sentAt&&!sorted.some(x=>x.leadId===l.id)&&Date.now()-Date.parse(l.sentAt)>4*86400000).slice(0,15);
    for(const l of awaiting){const card=node('article','','gmail-card');card.append(node('strong',l.name),node('small','Follow-up sugerido · sem resposta identificada','gmail-muted'),node('p','Revisar a conversa e escolher uma abordagem de acompanhamento.','gmail-next'));list.append(card);}
    if(!list.children.length)list.append(node('p','Nenhuma resposta vinculada aos leads ainda. Cadastre o e-mail do contato no lead para que ele seja acompanhado.','gmail-muted'));
    $('#gmailCount').textContent=sorted.length+' resposta(s) · '+awaiting.length+' follow-up(s) sugerido(s)';
  }
  async function refresh(){
    if(!getKey()||busy)return;busy=true;
    try{
      const data=await api('GET');connected=!!data.connected;
      state.textContent=connected?'Conta conectada: '+data.email:'Gmail ainda não conectado';
      connect.hidden=connected;sync.hidden=!connected;disconnect.hidden=!connected;reconnect.hidden=!connected||!!data.canSend;
      status.textContent=connected?((data.aiActive?'Classificação OpenAI ativa.':'Classificação por regras ativa.')+(data.canSend?' Envio aprovado pelo Google.':' Para enviar pelo CRM, clique em Autorizar envio pelo Gmail.')):'Conecte sua conta de prospecção para acompanhar os leads.';
      show(data.items||[]);
    }catch(e){status.textContent=e.message;}
    finally{busy=false}
  }
  async function synchronize(){
    if(!getKey()||!connected||busy)return;
    const leads=leadInput();if(!leads.length){status.textContent='Cadastre e-mails de contato nos leads para iniciar a sincronização.';return;}
    busy=true;sync.disabled=true;status.textContent='Sincronizando respostas dos leads...';
    try{const data=await api('POST',{action:'sync',leads});show(data.items||[]);if(!data.busy&&markReplied)await markReplied(data.items||[]);lastSync=Date.now();status.textContent=data.busy?'Outra sincronização já está em andamento.':'Sincronizado. Respostas classificadas automaticamente; nenhuma mensagem enviada.';}
    catch(e){status.textContent=e.message;}
    finally{busy=false;sync.disabled=false}
  }
  const startAuth=async()=>{
    if(busy||!getKey())return;busy=true;connect.disabled=true;
    try{const data=await api('POST',{action:'connect'});if(!/^https:\/\/accounts\.google\.com\//.test(data.url))throw Error('URL de autorização inválida.');location.href=data.url;}
    catch(e){status.textContent=e.message;busy=false;connect.disabled=false;reconnect.disabled=false}
  };
  connect.addEventListener('click',startAuth);
  reconnect.addEventListener('click',startAuth);
  disconnect.addEventListener('click',async()=>{
    if(!confirm('Desconectar o Gmail deste CRM? Isso apaga o token de acesso e os resumos sincronizados, mas não altera seus e-mails.'))return;
    try{await api('POST',{action:'disconnect'});connected=false;lastSync=0;await refresh();}catch(e){status.textContent=e.message;}
  });
  sync.addEventListener('click',synchronize);
  function navigate(){
    const active=location.hash==='#inbox';
    document.body.classList.toggle('gmail-active',active);
    panel.hidden=!active;
    document.querySelectorAll('.sidebar nav .nav-item').forEach(a=>{
      if(a.hash==='#inbox'){a.classList.toggle('selected',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
      else if(active){a.classList.remove('selected');a.removeAttribute('aria-current')}
    });
    if(active){refresh().then(()=>{if(connected&&Date.now()-lastSync>120000)synchronize()});}
  }
  addEventListener('hashchange',navigate);
  setInterval(()=>{if(getKey()&&!document.hidden&&Date.now()-lastSync>120000){refresh().then(()=>{if(connected)synchronize()})}},120000);
  const oauth=new URLSearchParams(location.search).get('gmail');
  if(oauth){status.textContent=oauth==='connected'?'Google autorizado. Sincronizando sua conta...':'Não foi possível conectar o Gmail ('+oauth+').';history.replaceState(null,'',location.pathname+location.hash);}
  navigate();
 }
};