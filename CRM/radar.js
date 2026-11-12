/* Search results are untrusted public snippets, never an audit or verified contact. */
window.RickyRadar = {
  mount({ getKey, getLeads, createLead }) {
    const $ = s => document.querySelector(s);
    const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const domain = s => { try { return new URL(s).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
    let results = [], searchMeta = null, busy = false;
    const audits = window.RadarAudit.mount({ getKey, render });
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
            message(item.results.some(row => row.historyTicket) ? 'Varredura salva · sem nova consulta ao Brave. Você pode auditar os candidatos enquanto o executor estiver conectado.' : 'Histórico antigo sem autorização de auditoria. Para auditar, será necessária uma nova busca uma única vez.');
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
      if(!getKey()) {message('Entre no CRM para buscar contatos.');return}
      if(row.contact && row.contact.status==='scanned')return;
      const ticket=row.ticket||row.historyTicket;
      if(!ticket){message('Comprovante da busca expirado. Faça uma nova varredura.');return}
      button.disabled=true;
      button.textContent='Buscando contato…';
      try {
        const response=await fetch('/api/radar-contact',{
          method:'POST',headers:{Authorization:'Bearer '+getKey(),'Content-Type':'application/json'},
          body:JSON.stringify({domain:row.domain,ticket}),signal:AbortSignal.timeout(35000)
        });
        const data=await response.json();
        if(!response.ok)throw Error(data.message||'Consulta indisponível');
        row.contact=data;
        saveContactToHistory(row);
        render();
      }catch(error){
        button.disabled=false;
        button.textContent='Encontrar contato';
        message('Contato de '+row.name+': '+String(error.message||'falhou'));
      }
    }
    function contactPanel(row,card,actions) {
      if(!row.contact){
        const button=node('button','Encontrar contato','ghost');button.type='button';
        button.addEventListener('click',()=>findContact(row,button));actions.append(button);return;
      }
      const c=row.contact;
      const area=node('div','','radar-contact');
      if(c.status!=='scanned'){
        area.append(node('small','Não foi possível verificar este site automaticamente. Confira o contato manualmente.','radar-contact-note'));
      }else{
        area.append(node('strong',c.priority==='Evitar'?'Plataforma a evitar':c.emails?.length?'Contato comercial encontrado':'Nenhum e-mail público localizado'));
        area.append(node('small',(c.platform||'Plataforma não verificada')+' · '+(c.cached?'Verificação em cache':'Site consultado')+' · Pontuação preliminar '+(c.score||0)+'/100','radar-contact-note'));
        if(c.emails?.length){
          const select=document.createElement('select');select.setAttribute('aria-label','E-mail da loja');
          for(const email of c.emails){const option=document.createElement('option');option.textContent=email;option.value=email;select.append(option)}
          const start=node('button','Preparar e-mail','primary');start.type='button';
          start.addEventListener('click',()=>{
            const businessName=row.name.replace(/\s+[|–—-]\s+.*$/,'').trim();
            const body='Oi! Tudo bem? Encontrei a '+businessName+' pesquisando lojas do segmento e trabalho com reformulação e modernização de lojas virtuais. Gostaria de conversar sobre possíveis melhorias na apresentação dos produtos e experiência de compra. Faz sentido para vocês?';
            const url='https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(select.value)+'&su='+encodeURIComponent('Ideia para a '+businessName)+'&body='+encodeURIComponent(body);
            window.open(url,'_blank','noopener');
          });
          const use=node('button','Criar lead com contato','ghost');use.type='button';use.addEventListener('click',()=>{
            createLead({...row,contactEmail:select.value});
          });
          area.append(select,start,use);
        }
      }
      card.append(area);
      if(c.pagesChecked?.length){
        const proof=node('small','Fontes verificadas: '+c.pagesChecked.length+' páginas públicas. Confirme antes de enviar.','radar-contact-note');
        card.append(proof);
      }
    }
    async function collectFive() {
      if(collecting||busy||!results.length)return;
      collecting=true;
      const candidates=results.filter(row=>!existing(row)&&!row.contact).slice(0,5);
      message('Buscando contatos públicos dos primeiros '+candidates.length+' candidatos...');
      for(let i=0;i<candidates.length;i++){
        const row=candidates[i];
        const button=[...document.querySelectorAll('#radarResults button')].find(btn=>btn.textContent==='Encontrar contato'&&btn.closest('.prospect-card')?.querySelector('.prospect-meta')?.textContent===row.domain);
        if(button)await findContact(row,button);
      }
      collecting=false;
      message('Coleta concluída. Revise os contatos identificados e prepare suas abordagens.');
    }
    const bulk=node('button','Encontrar contatos dos 5 primeiros','ghost');
    bulk.type='button';bulk.className='radar-collect-bulk';
    bulk.addEventListener('click',collectFive);
    $('#radarOutput').insertBefore(bulk,$('#radarResults'));

    function render() {
      const list = $('#radarResults'); list.replaceChildren();
      bulk.hidden = !results.length;
      let duplicates = 0;
      [...results].sort((a, b) => (b.audit?.priority?.score ?? -1) - (a.audit?.priority?.score ?? -1)).forEach(row => {
        if (existing(row)) { duplicates++; return; }
        const card = node('article', '', 'prospect-card');
        card.append(node('span', 'REVISÃO MANUAL', 'prospect-label'), node('h3', row.name));
        card.append(node('small', row.domain, 'prospect-meta'));
        const description = node('p', row.description || 'Sem descrição pública retornada pelo provedor.', 'prospect-description');
        description.title = row.description || '';
        card.append(description);
        const actions = node('div', '', 'prospect-actions');
        const link = node('a', 'Consultar fonte ↗', 'ghost');
        // Defense in depth: only web URLs, even if an upstream response is malformed.
        try { const url = new URL(row.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return; link.href = url.href; } catch { return; }
        link.target = '_blank'; link.rel = 'noopener noreferrer';
        const add = node('button', 'Preparar lead', 'primary'); add.type = 'button';
        add.addEventListener('click', () => createLead(row));
        // Draft only: never claim an audit was performed or that a problem was verified.
        const draft = node('button', 'Copiar abordagem', 'ghost');
        draft.type = 'button';
        draft.title = 'Modelo inicial sem diagnósticos inventados';
        draft.addEventListener('click', async () => {
          const businessName = row.name.replace(/\s+[|–—-]\s+.*$/, '').trim();
          const message = 'Oi! Tudo bem? Encontrei a ' + businessName + ' pesquisando lojas online do segmento. Trabalho com criação e modernização de sites e tenho algumas ideias de como poderia apresentar melhor os produtos e a identidade da marca. Se fizer sentido para vocês, posso preparar uma prévia visual gratuita de uma possível reformulação, sem compromisso. Teriam interesse?';
          try {
            await navigator.clipboard.writeText(message);
            const previous = draft.textContent;
            draft.textContent = '✓ Copiado';
            setTimeout(() => { if (draft.isConnected) draft.textContent = previous; }, 1800);
          } catch { window.prompt('Copie sua mensagem:', message); }
        });
        actions.append(link, add, draft); audits.append(row, card, actions); card.append(actions); contactPanel(row,card,actions); list.append(card);
      });
      if (searchMeta) {
        const removed = searchMeta.removed || { duplicates: 0, platforms: 0, other: 0 };
        $('#radarSummary').textContent = `${list.children.length} candidatos · ${removed.duplicates + duplicates} duplicados · ${removed.platforms} com indícios de plataforma · ${removed.other} outros descartados`;
        $('#radarSource').textContent = `${loadedFromHistory ? 'HISTÓRICO SALVO · sem nova consulta' : 'Brave Search'} · ${new Date(searchMeta.searchedAt).toLocaleString('pt-BR')} · Consulta: ${searchMeta.query}`;
        if (!list.children.length) list.append(node('p', 'Nenhum candidato novo após os filtros. Experimente outro nicho ou região.', 'radar-empty'));
      }
    }
    async function status() {
      if (!getKey()) { message('Entre no CRM para usar o Radar.'); return; }
      audits.status();
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
      message('Buscando fontes públicas e filtrando resultados…');
      try {
        const data = await api('POST', { niche: $('#radarNiche').value.trim(), region: $('#radarRegion').value.trim() });
        results = data.results; searchMeta = data; loadedFromHistory = false; render();
        searchMeta.id=saveHistory($('#radarNiche').value.trim(), $('#radarRegion').value.trim(), data);
        engine('BUSCA CONCLUÍDA');
        $('#radarResults').removeAttribute('aria-busy');
        message(`Busca concluída. Uso: ${data.usage.daily}/${data.usage.limits.daily} no dia e ${data.usage.monthly}/${data.usage.limits.monthly} no mês (UTC).`);
        revealResults();
        if ($('#radarAutoAudit').checked) {
          $('#radarSearch').textContent = 'Enfileirando auditorias…';
          for (const row of results.filter(row => !existing(row)).slice(0, 3)) await audits.start(row);
        }
      } catch (error) {
        engine('BUSCA INTERROMPIDA'); message(error.message);
        $('#radarResults').replaceChildren(node('p', 'Busca não concluída. Verifique o status do motor e tente novamente.', 'radar-empty'));
      }
      finally {
        busy = false; $('#radarSearch').disabled = false; $('#radarCheck').disabled = false;
        $('#radarSearch').textContent = '◎ Iniciar varredura';
        $('#radarPanel').classList.remove('is-searching');
        $('#radarResults').removeAttribute('aria-busy');
      }
    });
    window.addEventListener('hashchange', navigate);
    renderHistory();
    navigate();
  }
};
