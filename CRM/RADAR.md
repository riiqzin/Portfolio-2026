# Radar de Clientes — descoberta e auditoria

## O que está implementado

`/CRM/#radar` pesquisa até 20 resultados no Brave, filtra plataformas/diretórios e duplicados, e mantém a preparação manual do lead. O checkbox de auditoria automática envia no máximo três candidatos novos para uma fila privada. Também é possível auditar cada cartão individualmente.

A Vercel hospeda as APIs e o CRM. O executor em `worker/` roda no Windows com Playwright/Edge e consulta a fila no Redis. Não exige servidor de navegador pago. Captura desktop (1365×900) e celular (390×844), registra verificações técnicas e, se explicitamente habilitada, chama uma API de IA com as duas imagens. O CRM mostra estado, evidências, incerteza e prioridade provisória. Não há envio comercial, coleta automática de contatos, alteração de Supabase ou migração de tabelas.

**Limites reais desta versão:** a captura é estática, sem JavaScript e sem recursos de terceiros; lojas dependentes de scripts/CDNs podem ficar incompletas. Redirecionamentos, HTTP e destinos privados são bloqueados. Não há PageSpeed nesta versão; seu estado é explicitamente “não consultado”. Não foram validadas empresas reais nem qualidade de diagnósticos com chamadas pagas. O sistema não comprova país, nicho, faturamento ou intenção de comprar redesign: são candidatos para revisão.

## Ativar primeiro em Preview

1. Use a branch `codex/radar-visual-audit` e uma base Redis dedicada ao Preview. Não reutilize contadores de produção.
2. Configure as variáveis abaixo no painel seguro da Vercel, no ambiente Preview. Nunca coloque segredos em HTML, Git, PR, screenshots ou chat.
3. Reimplante o Preview. Configure e inicie o executor Windows com a mesma base Redis.
4. Entre com a chave do CRM e use **Diagnosticar conexão**. Esse botão não chama Brave nem IA. Ele consulta o estado privado do executor e das reservas no Redis; presença de configuração não comprova validade das chaves dos provedores.
5. Somente após conferir preços/limites dos seus planos, faça uma busca e uma auditoria controlada. Confira contadores, imagens e erros antes de habilitar o lote de três. Não há aprovação automática para merge em produção.

### Vercel — variáveis privadas

| Variável | Configuração |
| --- | --- |
| `RADAR_DASHBOARD_KEY` | Mesma chave privada usada para entrar no CRM. |
| `BRAVE_SEARCH_API_KEY` | Sua chave Web Search. |
| `UPSTASH_REDIS_REST_URL` | `https://…upstash.io`. |
| `UPSTASH_REDIS_REST_TOKEN` | Token Redis com EVAL/GET/SET/MGET/ZADD/ZRANGE/ZREM/INCR/INCRBY/EXPIRE/EXISTS. |
| `RADAR_DAILY_LIMIT`, `RADAR_MONTHLY_LIMIT` | Limites positivos de consultas Brave por período UTC; exemplo conservador: 5 e 30. |
| `RADAR_BUDGET_CENTS` | Até `8000` (R$80) de **reservas cumulativas**, sem renovação automática. |
| `RADAR_SEARCH_RESERVE_CENTS` | Reserva conservadora por busca; obrigatório, sem valor presumido. |
| `RADAR_AUDIT_RESERVE_CENTS` | Reserva conservadora máxima por auditoria; obrigatório, sem valor presumido. |
| `RADAR_AUDIT_DAILY_LIMIT` | 1 a 30 auditorias/dia UTC; sugestão inicial 10. |
| `RADAR_AUDIT_ENABLED` | `true` somente quando estiver pronto para executar. |

Sem reservas e orçamento configurados, buscas e auditorias ficam bloqueadas. A chave do painel continua no Authorization; a autenticação Supabase e os RPCs existentes não mudaram. Não é necessária service-role key. Ao trocar a chave do CRM, atualize a Vercel: isso também invalida tickets antigos.

### Windows — executor

Instale Node.js 22+ e Edge. No PowerShell, dentro da pasta `worker`:

```powershell
npm ci
Copy-Item .env.example .env
notepad .env
npm start
```

Preencha `.env` privadamente. O arquivo é ignorado pelo Git. Use as mesmas variáveis Redis, orçamento, reservas e limite diário do Preview. Configure `RADAR_BROWSER_CHANNEL=msedge` e `RADAR_AUDIT_ENABLED=true`. Após revisar os termos dos sites/fontes e permitir sua consulta automatizada, configure `RADAR_CRAWL_TERMS_ACCEPTED=true`. Robots.txt é respeitado, mas não substitui permissão nem termos de uso. Não contorne bloqueios, login, CAPTCHA ou conteúdo restrito.

A IA é opcional. Para ativar, configure **somente no executor** `OPENAI_API_KEY`, `RADAR_AI_MODEL` (modelo de sua conta compatível com imagens e Structured Outputs na Responses API) e `RADAR_AI_ENABLED=true`. Confira previamente o preço desse modelo e o limite do projeto no provedor. Nenhum modelo, preço ou acesso é presumido; a integração usa endpoint fixo, duas imagens e no máximo 2.000 tokens de saída. Nenhuma chave de IA passa pelo navegador ou pela Vercel.

O executor encerra após 30 minutos ou Ctrl+C após concluir o trabalho atual. Não se instala como serviço nem inicia com o Windows. Quando fecha, o indicador de conexão expira em até 45 segundos. Reinicie com `npm start` para outra sessão. O executor não expõe porta local.

## Custos: o que o teto significa

O Redis reserva centavos em `radar:v2:reserved-cents`, compartilhado entre buscas e auditorias. Esse contador **não expira**. Busca: reserva antes de Brave; auditoria: reserva, cota diária, deduplicação e criação da fila na mesma transação Lua. Falha/timeout não devolve reserva, porque o provedor pode ter cobrado. Não há repetição automática de chamadas pagas. Resultados do mesmo domínio reutilizam a auditoria por 24 horas, sem nova reserva.

As reservas são um limite operacional calculado a partir de valores configurados por você, **não uma leitura da fatura nem garantia cambial**. Defina valores que cubram o pior caso do seu modelo, tamanho de imagens, tokens, impostos e câmbio. O código limita 2 imagens JPEG de até 250 KB, 2.000 tokens de saída, uma chamada de IA por trabalho e uma chamada Brave por busca. Custos fixos de hospedagem/Redis, tráfego, uso externo das chaves e alterações de preço não entram no contador. Configure também limites nos provedores e evite upgrades automáticos.

Exemplo apenas aritmético, não cotação: reservar R$0,10 por busca e R$1 por auditoria permite 30 buscas + 77 auditorias dentro de R$80. Se seu custo máximo contratado for maior, aumente a reserva e reduza volume. Não foi feito gasto pago durante os testes.

Não apague/reduza contadores nem troque de base para contornar o teto. Redis deve manter dados sem eviction e com persistência; perda do contador perde o histórico de reservas. Atingir R$80 exige revisar o gasto real e tomar uma decisão consciente de novo orçamento fora desta versão. O servidor rejeita configuração acima de 8000 centavos.

O polling de cada cartão dura no máximo 18 ciclos de 10 segundos, apenas com o Radar visível; depois use “Atualizar auditoria”. O executor verifica fila a cada 10 segundos, com heartbeat a cada 15, durante no máximo 30 minutos por sessão. Essas operações usam a cota Redis, não chamadas Brave/IA.

## Evidências, prioridade e CRM

- Resultados da busca são trechos indexados, não auditorias. Domínio, nome e snippets podem gerar falsos positivos/negativos nos filtros. A região é um termo de busca, não localização confirmada.
- Cada candidato recebe um ticket assinado, válido por uma hora. A API de auditoria não aceita URLs arbitrárias sem um ticket da busca autenticada.
- O executor procura indícios de plataformas também no HTML. Plataforma excluída ou ausência de indício de loja evita a chamada de IA.
- Cada achado visual precisa indicar captura, região, observação, sugestão e confiança. A resposta é validada; recusa, truncamento ou saída inválida aparecem como falha, preservando as evidências técnicas.
- Prioridade provisória 0–15 = soma de severidade 1/2/3 dos até cinco achados visuais de alta confiança. Não é taxa de conversão, nota estética ou probabilidade de venda. Recursos bloqueados, imagens/estilos indisponíveis, pouco texto, IA incompleta ou loja não confirmada resultam em **sem nota**. Mesmo alta confiança do modelo exige revisão humana.
- Checks técnicos: título, viewport, overflow horizontal, imagens sem atributo alt e disponibilidade de recursos. Não são uma auditoria WCAG completa nem medição de desempenho. Imagens decorativas com alt vazio não são classificadas como ausência do atributo.
- “Preparar lead” continua preenchendo nome e slug no formulário existente. A URL do projeto apresentado e contatos continuam manuais. Nenhum RPC de criação é chamado antes de salvar o formulário. “Copiar relatório” permite levar evidências à revisão/proposta; o relatório não é salvo automaticamente no Supabase.
- Cartões e IDs ficam na memória da página. Recarregar perde a lista; uma nova busca e “Auditar” no mesmo domínio recupera o trabalho retido sem nova reserva. Resultados/capturas expiram 24 horas após a última gravação do estado. Copie o relatório se precisar retê-lo; revisão humana continua necessária.

## Proteções e operação

O navegador usa contexto efêmero sem cookies, permissões, downloads, scripts, service workers, formulários ou frames. Cada recurso permitido é obtido pelo Node via HTTPS, com certificado verificado e DNS fixado ao IP público validado no socket; respostas DNS mistas privadas/públicas são recusadas. IPv6 e endereços literais são recusados nesta primeira versão. O browser recebe a resposta pela interceptação e nunca recebe autorização para acessar diretamente os destinos. Recursos de terceiros e qualquer redirecionamento são bloqueados, incluindo redirects de robots.txt. Toda consulta de robots falha fechada, exceto ausência explícita 404/410. Respeita regras e intervalo de crawl; intervalo acima de 5 segundos bloqueia a auditoria nesta versão.

Limites por auditoria: até 40 recursos, 2 MB por recurso, 12 MB de corpos acumulados, 8 segundos por socket e 75 segundos por contexto. Capturas limitadas à primeira tela. HTML remoto não é inserido no CRM; textos/modelo são renderizados com textContent e imagens aceitam somente JPEG base64 limitado. Chaves não entram em logs ou URLs. Jobs e capturas ficam no Redis privado e são acessíveis apenas com a chave do painel. Imagens são enviadas à OpenAI apenas com IA habilitada; `store:false` desativa armazenamento de resposta, mas não altera por si só as políticas de retenção do provedor.

Consumo da fila é atômico e sem reexecução: se o executor morrer após pegar um trabalho, ele não será repetido. Após cinco minutos, trabalhos sem conclusão aparecem como interrompidos. Reservas permanecem. Trabalhos com mais de cinco minutos na fila não são processados. Falha de persistência encerra o executor, evitando continuar chamadas sem controle. Use apenas uma base dedicada e mantenha o token privado.

## Testes e validação

```powershell
cd CRM/tests
npm ci
npm run test:api
$env:CRM_BROWSER_CHANNEL='msedge'
npm test
cd ../../worker
npm ci
npm test
```

Os testes usam provedores e rede simulados. Cobrem API de busca/fila, autenticação, origem, tickets expirados, configuração, orçamento, erros, deduplicação, DNS privado/misto, IP fixado, redirects, robots, schema/recusa de IA, ranking sem evidências, capturas reais em Edge com conteúdo fixture e regressão do CRM em 320/390/768/1024/1440 px. Nenhum teste exige chaves pagas. Antes de produção, ainda valide transações Lua em Redis real, uma busca real e uma auditoria autorizada com configuração de Preview. Faça revisão manual de uma amostra antes de confiar na classificação. Não foram alterados os RPCs de autenticação, tracking ou leads.

Referências de implementação: [Playwright network](https://playwright.dev/docs/network), [OpenAI imagens](https://developers.openai.com/api/docs/guides/images-vision), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Upstash REST](https://upstash.com/docs/redis/features/restapi), [Brave Web Search](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started).
