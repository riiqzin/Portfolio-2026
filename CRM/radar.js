/* Search results are untrusted public snippets, never an audit or verified contact. */
window.RickyRadar = {
  mount({ getKey, getLeads, createLead }) {
    const $ = s => document.querySelector(s);
    const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const domain = s => { try { return new URL(s).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
    let results = [], searchMeta = null, busy = false;
    const message = value => { $('#radarStatus').textContent = value; };
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
      results.forEach(row => {
        if (existing(row)) { duplicates++; return; }
        const card = node('article', '', 'prospect-card');
        card.append(node('span', 'REVISÃO MANUAL', 'prospect-label'), node('h3', row.name), node('p', row.description || 'Sem descrição pública retornada pelo provedor.'));
        card.append(node('small', `${row.domain} · Plataforma não verificada`, 'prospect-meta'));
        const actions = node('div', '', 'prospect-actions');
        const link = node('a', 'Consultar fonte ↗', 'ghost');
        // Defense in depth: only web URLs, even if an upstream response is malformed.
        try { const url = new URL(row.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return; link.href = url.href; } catch { return; }
        link.target = '_blank'; link.rel = 'noopener noreferrer';
        const add = node('button', 'Preparar lead', 'primary'); add.type = 'button';
        add.addEventListener('click', () => createLead(row));
        actions.append(link, add); card.append(actions); list.append(card);
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
      message('Verificando disponibilidade…');
      try { const data = await api('GET'); message(`Pronto para buscar · até ${data.limits.daily} consultas/dia e ${data.limits.monthly}/mês (UTC). Cada busca usa uma consulta.`); }
      catch (error) { message(error.message); }
    }
    function navigate() {
      const active = location.hash === '#radar';
      document.body.classList.toggle('radar-active', active);
      $('#radarPanel').hidden = !active;
      document.querySelectorAll('.sidebar nav .nav-item').forEach(a => {
        const selected = active ? a.hash === '#radar' : a.hash === (location.hash === '#workspace' ? '#workspace' : '#app');
        a.classList.toggle('selected', selected);
        if (selected) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      $('.brand-copy b').textContent = active ? 'Radar de Clientes' : 'Visão geral';
      if (active && !busy && !searchMeta) status();
      if (active && searchMeta) render();
    }
    $('#radarCheck').addEventListener('click', () => { if (!busy) status(); });
    $('#radarForm').addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      if (!getKey()) { message('Entre no CRM para usar o Radar.'); return; }
      busy = true; $('#radarSearch').disabled = true; $('#radarCheck').disabled = true;
      $('#radarPanel').setAttribute('aria-busy', 'true');
      results = []; searchMeta = null; $('#radarResults').replaceChildren(); $('#radarSummary').textContent = ''; $('#radarSource').textContent = '';
      message('Buscando fontes públicas e filtrando resultados…');
      try {
        const data = await api('POST', { niche: $('#radarNiche').value.trim(), region: $('#radarRegion').value.trim() });
        results = data.results; searchMeta = data; render();
        message(`Busca concluída. Uso: ${data.usage.daily}/${data.usage.limits.daily} no dia e ${data.usage.monthly}/${data.usage.limits.monthly} no mês (UTC).`);
      } catch (error) { message(error.message); }
      finally { busy = false; $('#radarSearch').disabled = false; $('#radarCheck').disabled = false; $('#radarPanel').removeAttribute('aria-busy'); }
    });
    window.addEventListener('hashchange', navigate);
    navigate();
  }
};
