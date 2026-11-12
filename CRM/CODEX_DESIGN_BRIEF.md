# Ricky CRM — briefing curto para redesign no Codex

Redesenhe **somente a apresentação** das áreas **Prospecção** e da parte inferior do **Radar** (histórico de varreduras, estados de carregamento e cards de resultados). Preserve a primeira parte do Radar — seu motor, formulário e identidade visual — porque já foi aprovada.

Busque uma experiência dark, premium, original, muito intuitiva, com tipografia clara, espaços bem aproveitados, poucas ações por card, microinterações elegantes e responsividade impecável. A Central de Prospecção atual está visualmente confusa; reorganize-a com **uma ação principal por vez**, uma **fila de envios evidente** e a **biblioteca de modelos** em espaço secundário. O usuário precisa concluir **Radar → site → Preparar abordagem → escolher modelo → revisar → enviar/agendar** sem se perder.

Tenha liberdade criativa, mas evite telas genéricas de dashboards e excesso de caixas/botões.

**Não altere a lógica ou contratos de API**, tokens, autenticação, controles de aprovação, limites de envio, histórico, variáveis de ambiente, cron nem nomes de IDs que o JavaScript usa. Não recrie auditoria visual por screenshot. Não transforme envio manual em disparo em massa. Confira navegação e estados em desktop/mobile e preserve acessibilidade. Priorize CSS e ajustes de marcação bem localizados.

Arquivos principais: `CRM/index.html`, `CRM/radar.css`, `CRM/outreach.css`, `CRM/radar.js`, `CRM/outreach.js`. Teste visualmente os fluxos e mantenha as funções existentes.
