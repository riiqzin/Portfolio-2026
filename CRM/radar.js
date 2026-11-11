/* Search results are untrusted public snippets, never an audit or verified contact. */
window.RickyRadar = {
  mount({ getKey, getLeads, createLead }) {
    const $ = s => document.querySelector(s);
    const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const domain = s => { try { return new URL(s).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
    let results = [], searchMeta = null, busy = false;
    const audits = window.RadarAudit.mount({ getKey, render });
    const message = value => { $('#radarStatus').textContent = value; };
    const engine = (label, searching = false) => {
      $('#radarEngineState').textContent = label;
      $('#radarPanel').classList.toggle('is-searching', searching);
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
    function render() {
      const list = $('#radarResults'); list.replaceChildren();
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
        actions.append(link, add, draft); audits.append(row, card, actions); card.append(actions); list.append(card);
      });
      if (searchMeta) {
        const removed = searchMeta.removed;
        $('#radarSummary').textContent = `${list.children.length} candidatos · ${removed.duplicates + duplicates} duplicados · ${removed.platforms} com indícios de plataforma · ${removed.other} outros descartados`;
        $('#radarSource').textContent = `Brave Search · ${new Date(searchMeta.searchedAt).toLocaleString('pt-BR')} · Consulta: ${searchMeta.query}`;
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
        const selected = active ? a.hash === '#radar' : a.hash === (location.hash === '#workspace' ? '#workspace' : '#app');
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
    $('#radarNewSearch').addEventListener('click', () => $('#radarNiche').focus());
    $('#radarForm').addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      if (!getKey()) { message('Entre no CRM para usar o Radar.'); return; }
      busy = true; $('#radarSearch').disabled = true; $('#radarCheck').disabled = true;
      $('#radarSearch').textContent = '◎ Buscando…';
      engine('BUSCANDO', true);
      $('#radarOutput').classList.remove('is-revealed');
      $('#radarResults').setAttribute('aria-busy', 'true');
      results = []; searchMeta = null; $('#radarResults').replaceChildren(); $('#radarSummary').textContent = ''; $('#radarSource').textContent = '';
      message('Buscando fontes públicas e filtrando resultados…');
      try {
        const data = await api('POST', { niche: $('#radarNiche').value.trim(), region: $('#radarRegion').value.trim() });
        results = data.results; searchMeta = data; render();
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
    navigate();
  }
};
