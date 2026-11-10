/* Private job results use textContent; remote HTML and model output are never executed. */
window.RadarAudit = {
  mount({ getKey, render }) {
    const node = (tag, text, cls) => { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; return el; };
    const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    async function api(method, body, id) {
      const response = await fetch('/api/radar-audit' + (id ? '?id=' + encodeURIComponent(id) : ''), { method, cache: 'no-store', headers: { Authorization: `Bearer ${getKey()}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
      let data; try { data = await response.json(); } catch { throw new Error('Auditoria indisponível nesta implantação.'); }
      if (!response.ok) throw new Error(data.message || 'Auditoria indisponível.');
      return data;
    }
    async function status() {
      const output = document.querySelector('#auditStatus');
      try {
        const data = await api('GET');
        output.textContent = `${data.workerOnline ? 'Executor conectado' : 'Executor Windows desconectado'} · ${money(data.reservedCents)} reservados de ${money(data.budgetCents)} · Reserva por auditoria: ${money(data.auditReserveCents)} · Até ${data.dailyLimit}/dia. Reservas não são cobrança medida.`;
      } catch (error) { output.textContent = error.message; }
    }
    async function refresh(row) {
      try { row.audit = await api('GET', null, row.auditId); row.auditError = ''; }
      catch (error) { row.auditError = error.message; }
      render();
    }
    async function start(row) {
      if (row.auditBusy || row.auditId) return;
      row.auditBusy = true; row.auditError = ''; render();
      try {
        const result = await api('POST', { ticket: row.ticket }); row.auditId = result.id;
        await refresh(row); status();
        let polls = 0;
        const poll = async () => {
          if (++polls > 18 || !getKey() || !['queued', 'running'].includes(row.audit?.status)) return;
          if (!document.hidden && location.hash === '#radar') await refresh(row);
          setTimeout(poll, 10000);
        };
        setTimeout(poll, 10000);
      } catch (error) { row.auditError = error.message; }
      finally { row.auditBusy = false; render(); }
    }
    function append(row, card, actions) {
      const button = node('button', row.auditBusy ? 'Reservando…' : row.auditId ? 'Atualizar auditoria' : 'Auditar site', 'ghost');
      button.type = 'button'; button.disabled = !!row.auditBusy;
      button.addEventListener('click', () => row.auditId ? refresh(row) : start(row)); actions.append(button);
      if (row.auditError) card.append(node('p', row.auditError, 'audit-warning'));
      const job = row.audit;
      if (!job) return;
      const labels = { queued: 'Na fila do executor', running: 'Capturando e analisando', completed: 'Auditoria disponível', failed: 'Auditoria não concluída', interrupted: 'Executor interrompido' };
      card.append(node('p', labels[job.status] || 'Estado desconhecido', 'audit-state'));
      if (job.message) card.append(node('p', job.message, 'audit-warning'));
      if (!job.evidence) return;
      const priority = job.priority;
      card.append(node('strong', `${priority.label}${priority.score === null ? '' : ` · ${priority.score}/15 (provisório)`}`));
      card.append(node('p', priority.reason, 'prospect-meta'));
      const details = node('details', '', 'audit-details'); details.append(node('summary', 'Ver capturas e evidências'));
      details.append(node('p', `Capturado em ${new Date(job.evidence.capturedAt).toLocaleString('pt-BR')}. Retenção: 24 horas.`));
      for (const limitation of job.evidence.limitations) details.append(node('p', limitation, 'audit-warning'));
      for (const shot of job.evidence.screenshots) {
        if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(shot.data) || shot.data.length > 340000) continue;
        const figure = node('figure', '', 'audit-shot'), img = document.createElement('img');
        img.src = shot.data; img.alt = `Captura estática ${shot.id} de ${row.domain}`; img.loading = 'lazy';
        figure.append(img, node('figcaption', `${shot.id} · ${shot.width} × ${shot.height}`)); details.append(figure);
      }
      details.append(node('h4', 'Verificações técnicas'));
      for (const finding of job.technical) details.append(node('p', `${finding.observation} Evidência: ${finding.evidence}`));
      if (!job.technical.length) details.append(node('p', 'Nenhum problema detectado nas verificações limitadas executadas.'));
      details.append(node('h4', 'Revisão visual por IA'));
      details.append(node('p', job.visual.summary || job.visual.message));
      if (job.visual.uncertainty) details.append(node('p', `Incerteza: ${job.visual.uncertainty}`, 'audit-warning'));
      for (const f of job.visual.findings || []) {
        const region = ['x', 'y', 'width', 'height'].map(k => `${k}: ${Math.round(f.box[k] * 100)}%`).join(', ');
        details.append(node('p', `${f.observation} Sugestão: ${f.recommendation} Confiança: ${f.confidence}. Evidência: ${f.screenshot} (${region}).`));
      }
      details.append(node('p', job.pagespeed.message, 'prospect-meta'));
      const copy = node('button', 'Copiar relatório para revisão', 'ghost'); copy.type = 'button';
      copy.addEventListener('click', async () => {
        const report = `${row.name}\nFonte: ${row.url}\n${details.innerText}\nNenhum contato automático. Revisar antes de usar em proposta.`;
        try { await navigator.clipboard.writeText(report); copy.textContent = 'Relatório copiado'; } catch { copy.textContent = 'Não foi possível copiar'; }
      });
      details.append(copy); card.append(details);
    }
    return { start, append, status };
  }
};
