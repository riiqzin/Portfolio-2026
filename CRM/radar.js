/* Search results are untrusted public snippets, never an audit or verified contact. */
window.RickyRadar = {
  mount({ getKey, getLeads, createLead }) {
    const $ = s => document.querySelector(s);
    const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const domain = s => { try { return new URL(s).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
    let results = [], searchMeta = null, busy = false;
    // Visual audits were retired; contact enrichment is the only post-search step.
    let collecting = false;
    // Local history stores public search snippets and server-signed audit receipts; never API keys or dashboard credentials.
    // This first version is intentionally device-local, not a server-side shared archive.
    const HISTORY_KEY = 'ricky-radar-history-v1';
    const HISTORY_MAX = 30;
    const HISTORY_TTL = 90 * 24 * 60 * 60 * 1000;
    let loadedFromHistory = false;
    const getHistory = () => {
      try {
        const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        if (!Array.isArray(data)) return [];
        return data.filter(item => item && typeof item.id === 'string' && typeof item.niche === 'string' &&
          typeof item.region === 'string' && Array.isArray(item.results) && Number.isFinite(Date.parse(item.searchedAt)) &&
          Date.now() - Date.parse(item.searchedAt) < HISTORY_TTL).slice(0, HISTORY_MAX);
      } catch { return []; }
    };
    function saveHistory(niche, region, data) {
      const safeResults = (Array.isArray(data.results) ? data.results : []).slice(0, 20).map(row => ({
        name: String(row.name || '').slice(0, 160), domain: String(row.domain || '').slice(0, 255),
        url: String(row.url || '').slice(0, 2048), description: String(row.description || '').slice(0, 600),
        historyTicket: String(row.historyTicket || '').slice(0, 4096), contact: row.contact && typeof row.contact === 'object' ? row.contact : null
      }));
      const item = {
        id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
        niche: niche.slice(0, 80), region: region.slice(0, 80),
        searchedAt: data.searchedAt, query: String(data.query || '').slice(0, 500),
        removed: data.removed || { duplicates: 0, platforms: 0, other: 0 },
        results: safeResults
      };
      const updated = [item, ...getHistory()].slice(0, HISTORY_MAX);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); }
      catch { message('Busca concluída, mas o navegador não conseguiu guardar o histórico.'); }
      renderHistory();
      return item.id;
    }
    function renderHistory() {
      let section = $('#radarHistory');
      if (!section) {
        section = node('section', '', 'radar-history');
        section.id = 'radarHistory';
        section.setAttribute('aria-label', 'Varreduras salvas neste navegador');
        $('#radarOutput').parentElement.insertBefore(section, $('#radarOutput'));
      }
      section.replaceChildren();
      const header = node('div', '', 'radar-history-head');
      header.append(node('h2', 'Varreduras salvas'), node('small', 'Neste navegador · até 30 buscas · 90 dias'));
      section.append(header);
      const history = getHistory();
      if (!history.length) { section.append(node('p', 'As próximas buscas ficarão salvas aqui, por segmento.', 'radar-history-empty')); return; }
      const groups = new Map();
      history.forEach(item => {
        const key = item.niche.trim().toLocaleLowerCase('pt-BR');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });
      groups.forEach(items => {
        const group = node('div', '', 'radar-history-group');
        group.append(node('h3', items[0].niche));
        const entries = node('div', '', 'radar-history-entries');
        items.forEach(item => {
          const open = node('button', '', 'radar-history-item');
          open.type = 'button';
          open.append(node('strong', item.region), node('span', new Date(item.searchedAt).toLocaleString('pt-BR')),
            node('small', item.results.length + ' candidatos · abrir sem nova consulta'));
          open.addEventListener('click', () => {
            if (busy) return;
            results = item.results.map(row => ({ ...row, ticket: row.historyTicket || null }));
            searchMeta = { ...item, removed: item.removed || { duplicates: 0, platforms: 0, other: 0 } };
            loadedFromHistory = true;
            $('#radarNiche').value = item.niche;
            $('#radarRegion').value = item.region;
            render();
            engine('HISTÓRICO ABERTO');
            message('Varredura salva aberta. Os resultados podem ser analisados enquanto o comprovante de consulta estiver válido.');
            revealResults();
          });
          entries.append(open);
        });
        group.append(entries);
        section.append(group);
      });
    }

    const message = value => { $('#radarStatus').textContent = value; };
    const engine = (label, searching = false) => {
      $('#radarEngineState').textContent = label;
      $('#radarPanel').classList.toggle('is-searching', searching);
      $('#radarPanel').classList.toggle('is-unavailable', ['INDISPONÍVEL', 'BUSCA INTERROMPIDA'].includes(label));
    };
    function revealResults() {
      const output = $('#radarOutput');
      output.classList.add('is-revealed');
      // Do not pull the user back if they left the Radar while the request ran.
      if (location.hash !== '#radar') return;
      output.focus({ preventScroll: true });
      output.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    }
    const node = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
    async function api(method, body) {
      let response;
      try {
        response = await fetch('/api/radar', { method, cache: 'no-store', headers: { Authorization: `Bearer ${getKey()}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(22000) });
      } catch { throw new Error('Sem resposta do Radar. Verifique a conexão. Uma busca interrompida pode consumir uma consulta.'); }
      let data;
      try { data = await response.json(); } catch { throw new Error('O serviço do Radar não está disponível nesta implantação. Consulte o guia de ativação.'); }
      if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a busca.');
      return data;
    }
    const existing = row => getLeads().some(lead => normalize(lead.name) === normalize(row.name) || (domain(lead.project_url) && domain(lead.project_url) === row.domain));

    function saveContactToHistory(row) {
      if (!searchMeta?.id) return;
      try {
        const data=getHistory();
        const match=data.find(item=>item.id===searchMeta.id);
        if(!match)return;
        const record=match.results.find(item=>item.domain===row.domain);
        if(!record)return;
        record.contact=row.contact;
        localStorage.setItem(HISTORY_KEY,JSON.stringify(data));
      }catch{}
    }
    async function findContact(row,button) {
      if(!getKey()) {message('Entre no CRM para buscar contatos.');return false}
      if(row.contact?.opportunity&&row.contact.status==='scanned')return true;
      const ticket=row.ticket||row.historyTicket;
      if(!ticket){row.contactError='Comprovante expirado; faça uma nova varredura.';render();return false}
      if(button){button.disabled=true;button.textContent='Consultando...'}
      row.contactLoading=true;row.contactError='';
      render();
      try {
        const response=await fetch('/api/radar-contact',{
          method:'POST',headers:{Authorization:'Bearer '+getKey(),'Content-Type':'application/json'},
          body:JSON.stringify({domain:row.domain,ticket,refresh:!!button}),signal:AbortSignal.timeout(45000)
        });
        const data=await response.json().catch(()=>({message:'Resposta inesperada ao procurar contato.'}));
        if(!response.ok)throw Error(data.message||'Consulta indisponível');
        row.contact=data;
        saveContactToHistory(row);
        return true;
      }catch(error){
        row.contactError=String(error.message||'Não foi possível consultar o site agora.');
        return false;
      }finally{
        row.contactLoading=false;render();
      }
    }
    function contactPanel(row,card,actions) {
      const area=node('div','','radar-contact');
      const c=row.contact;
      const label=row.contactLoading?'Localizando contato comercial...':row.contactError||(!c?'Contato ainda não verificado':c.status!=='scanned'?'Contato não localizado automaticamente':c.emails?.length?'E-mail comercial encontrado':'Nenhum e-mail público encontrado');
      area.append(node('strong',label));
      if(c?.emails?.length){
        area.append(node('small',c.emails[0]+' · '+c.emails.length+' endereço(s) público(s)','radar-contact-note'));
      }else if(c?.status==='scanned'){
        area.append(node('small','O site foi consultado, mas não publicou um e-mail identificável.','radar-contact-note'));
      }else if(c?.reason){
        area.append(node('small',c.reason,'radar-contact-note'));
      }
      if(c?.platform&&c.platform!=='Não identificada')area.append(node('small','Plataforma: '+c.platform,'radar-contact-note'));
      if(!row.contactLoading&&(!c||c.status!=='scanned'||!c.emails?.length)){
        const retry=node('button',c?'Tentar localizar novamente':'Localizar e-mail','ghost');retry.type='button';
        retry.addEventListener('click',()=>findContact(row,retry));
        area.append(retry);
      }
      if(row.contactLoading){const loader=node('div','','radar-contact-loading');loader.setAttribute('role','progressbar');loader.setAttribute('aria-label','Procurando e-mail comercial');area.append(loader)}
      card.append(area);
    }
    async function collectAll() {
      if(collecting||!results.length)return;
      collecting=true;
      // Unverified historic results may be rechecked with a valid signed ticket.
      const candidates=results.filter(row=>!existing(row)&&(!row.contact||!row.contact.opportunity));
      const total=candidates.length;
      let completed=0,emails=0,scored=0;
      if(total===0){collecting=false;message('Todas as lojas elegíveis desta varredura já foram verificadas.');return}
      message('Análise técnica: 0/'+total+' lojas · duas verificações em paralelo.');
      const worker=async()=>{
        while(candidates.length){
          const row=candidates.shift();
          if(!row)break;
          const ok=await findContact(row,null);
          if(ok&&row.contact?.emails?.length)emails++;
          if(row.contact?.opportunity?.score!==null&&row.contact?.opportunity?.score!==undefined)scored++;
          completed++;
          message('Análise técnica: '+completed+'/'+total+' · '+scored+' notas provisórias · '+emails+' lojas com e-mail');
        }
      };
      await Promise.allSettled([worker(),worker()]);
      collecting=false;
      message('Análise concluída: '+completed+' lojas consultadas, '+scored+' com score provisório e '+emails+' com e-mail. Os demais resultados estão sinalizados como incompletos.');
    }
    const bulk=node('button','Analisar lojas ainda não verificadas','ghost');
    bulk.type='button';bulk.className='radar-collect-bulk';
    bulk.addEventListener('click',collectAll);
    $('#radarOutput').insertBefore(bulk,$('#radarResults'));

    function render() {
      const list=$('#radarResults');list.replaceChildren();
      bulk.hidden=!results.length||collecting;
      let duplicates=0;
      const sorted=[...results].sort((a,b)=>{
        const x=a.contact?.opportunity?.score,y=b.contact?.opportunity?.score;
        return (y??-1)-(x??-1);
      });
      for(const row of sorted){
        if(existing(row)){duplicates++;continue}
        const card=node('article','','prospect-card radar-prospect-modern');
        const top=node('div','','radar-prospect-head');
        top.append(node('span',row.contact?.emails?.length?'CONTATO ENCONTRADO':'CANDIDATO','prospect-label'),node('small',row.domain,'prospect-meta'));
        card.append(top,node('h3',row.name),node('p',row.description||'Resultado público do mecanismo de busca.','prospect-description'));
        const op=row.contact?.opportunity;
        const ranking=node('section','','radar-opportunity');
        ranking.setAttribute('aria-label','Score de oportunidade');
        const scoreline=node('div','','radar-opportunity-scoreline');
        scoreline.append(node('strong',op?.score===null||op?.score===undefined?'— / 100':op.score+' / 100','radar-opportunity-number'),
          node('span',row.contactLoading?'Analisando…':op?.score===null||!op?'Análise incompleta':'Score provisório · confiança '+op.confidence,'radar-opportunity-state'));
        ranking.append(scoreline);
        if(op?.score!==null&&op?.score!==undefined){
          const bar=node('div','','radar-opportunity-bar');
          const fill=node('span','','radar-opportunity-fill');fill.style.width=Math.max(0,Math.min(100,op.score))+'%';
          bar.append(fill);ranking.append(bar);
        }
        if(op?.criteria){
          const detail=document.createElement('details');detail.className='radar-score-details';
          const summary=node('summary','Ver critérios e evidências ('+op.coverage+'/100 pontos cobertos)','');
          detail.append(summary);
          const names={compatibility:'Compatibilidade · 30',improvement:'Melhorias verificáveis · 25',contact:'Contato comercial · 20',activity:'Sinais de loja ativa · 15',approach:'Facilidade de abordagem · 10'};
          for(const [key,criterion] of Object.entries(op.criteria)){
            const line=node('div','','radar-score-criterion');
            line.append(node('strong',names[key]||key),node('span',criterion.verified?criterion.earned+'/'+criterion.max:'Não verificado'));
            const why=node('small',(criterion.details||[]).join(' · '),'radar-contact-note');
            detail.append(line,why);
          }
          detail.append(node('small',op.note||'Pontuação provisória baseada em evidências públicas.','radar-contact-note'));
          ranking.append(detail);
        }
        card.append(ranking);
        contactPanel(row,card);
        const actions=node('div','','prospect-actions radar-modern-actions');
        const link=node('a','Ver site ↗','ghost');
        try{const u=new URL(row.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)continue;link.href=u.href}catch{continue}
        link.target='_blank';link.rel='noopener noreferrer';
        const add=node('button','Preparar abordagem','primary');add.type='button';
        add.addEventListener('click',async()=>{
          add.disabled=true;
          try{
            const name=row.name.replace(/\s+[|–—-]\s+.*$/,'').trim();
            await window.RickyOutreach.openRadarComposer({name,domain:row.domain,email:row.contact?.emails?.[0]||'',segment:$('#radarNiche').value});
          }catch(err){message('Não foi possível preparar: '+String(err.message||'Erro desconhecido'))}
          finally{add.disabled=false}
        });
        actions.append(link,add);card.append(actions);list.append(card);
      }
      if(searchMeta){
        const removed=searchMeta.removed||{duplicates:0,platforms:0,other:0};
        $('#radarSummary').textContent=list.children.length+' candidatos · '+(removed.duplicates+duplicates)+' duplicatas · '+removed.platforms+' plataformas filtradas';
        $('#radarSource').textContent=(loadedFromHistory?'HISTÓRICO SALVO':'Brave Search')+' · '+new Date(searchMeta.searchedAt).toLocaleString('pt-BR')+' · '+searchMeta.query;
        if(!list.children.length)list.append(node('p','Nenhuma oportunidade nova após os filtros. Tente outro segmento.','radar-empty'));
      }
    }
    async function status() {
      if (!getKey()) { message('Entre no CRM para usar o Radar.'); return; }
      message('Consultando o servidor. Nenhuma busca será cobrada nesta verificação…');
      try { const data = await api('GET'); if (busy) return; engine('MOTOR PRONTO'); message(`Motor pronto · até ${data.limits.daily} consultas/dia e ${data.limits.monthly}/mês (UTC). Cada busca usa uma consulta.`); }
      catch (error) { if (!busy) { engine('INDISPONÍVEL'); message(error.message); } }
    }
    function navigate() {
      const active = location.hash === '#radar';
      document.body.classList.toggle('radar-active', active);
      document.body.classList.toggle('leads-focused', location.hash === '#workspace');
      $('#radarPanel').hidden = !active;
      document.querySelectorAll('.sidebar nav .nav-item').forEach(a => {
        const selected = active ? a.hash === '#radar' : a.hash === '#app';
        a.classList.toggle('selected', selected);
        if (selected) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      if (active && !busy && !searchMeta) status();
      if (active && searchMeta) render();
    }
    // Quick niche chips update the actual search field; "Personalizado" makes it editable.
    document.querySelectorAll('[data-radar-niche]').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('[data-radar-niche]').forEach(el => el.classList.toggle('is-active', el === button));
      $('#radarNiche').value = button.dataset.radarNiche;
      if (!button.dataset.radarNiche) $('#radarNiche').focus();
    }));
    $('#radarCheck').addEventListener('click', () => { if (!busy) status(); });
    $('#radarMotion').addEventListener('click', () => {
      const paused = $('#radarPanel').classList.toggle('motion-paused');
      $('#radarMotion').setAttribute('aria-pressed', String(paused));
      $('#radarMotion').textContent = paused ? 'Retomar animação' : 'Pausar animação';
    });
    $('#radarNewSearch').addEventListener('click', () => $('#radarNiche').focus());
    $('#radarForm').addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      if (!getKey()) { message('Entre no CRM para usar o Radar.'); return; }
      busy = true; $('#radarSearch').disabled = true; $('#radarCheck').disabled = true;
      $('#radarSearch').textContent = '◎ Buscando…';
      engine('BUSCANDO', true);
      $('#radarOutput').classList.remove('is-revealed');
      $('#radarResults').setAttribute('aria-busy', 'true');
      results = []; searchMeta = null; loadedFromHistory = false; $('#radarResults').replaceChildren(); $('#radarSummary').textContent = ''; $('#radarSource').textContent = '';
      message('Etapa 1/2 · Encontrando lojas e filtrando duplicatas…');
      try {
        const data = await api('POST', { niche: $('#radarNiche').value.trim(), region: $('#radarRegion').value.trim() });
        results = data.results; searchMeta = data; loadedFromHistory = false; render();
        searchMeta.id=saveHistory($('#radarNiche').value.trim(), $('#radarRegion').value.trim(), data);
        engine('BUSCA CONCLUÍDA');
        $('#radarResults').removeAttribute('aria-busy');
        message(`Busca concluída. Uso: ${data.usage.daily}/${data.usage.limits.daily} no dia e ${data.usage.monthly}/${data.usage.limits.monthly} no mês (UTC).`);
        revealResults();
        // Every candidate is analyzed progressively, without a second Brave search.
        void collectAll();

      } catch (error) {
        engine('BUSCA INTERROMPIDA'); message(error.message);
        $('#radarResults').replaceChildren(node('p', 'Busca não concluída. Verifique o status do motor e tente novamente.', 'radar-empty'));
      }
      finally {
        busy = false; $('#radarSearch').disabled = false; $('#radarCheck').disabled = false;
        $('#radarSearch').textContent = '◎ Encontrar lojas';
        $('#radarPanel').classList.remove('is-searching');
        $('#radarResults').removeAttribute('aria-busy');
      }
    });
    window.addEventListener('hashchange', navigate);
    renderHistory();
    navigate();
  }
};
