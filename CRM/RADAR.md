# Radar de Clientes — primeira versão

O Radar abre em `/CRM/#radar`, preserva o painel existente e consulta a API oficial do Brave Search pelo endpoint server-side `/api/radar`. Cada clique faz no máximo **uma consulta**, com até 20 resultados. Não há paginação automática, repetição em falhas, scraping de sites, IA, envio de mensagens ou gravação automática de leads.

## Ativação em Preview antes de produção

No projeto Vercel, configure estas variáveis **somente no servidor**, inicialmente no ambiente Preview da branch `feat/radar-clientes-v1`. Não cole chaves em HTML, JavaScript público, Git, logs, issues ou no PR.

| Variável | Valor |
| --- | --- |
| `RADAR_DASHBOARD_KEY` | A mesma chave privada já usada para entrar no CRM. Configure pelo painel seguro da Vercel. |
| `BRAVE_SEARCH_API_KEY` | Chave de um plano com acesso a Web Search. |
| `UPSTASH_REDIS_REST_URL` | URL HTTPS da base Upstash Redis (`https://…upstash.io`). |
| `UPSTASH_REDIS_REST_TOKEN` | Token privado com permissão para executar EVAL e os comandos do contador. |
| `RADAR_DAILY_LIMIT` | Máximo de consultas por dia UTC; inteiro positivo escolhido conforme o orçamento. |
| `RADAR_MONTHLY_LIMIT` | Máximo de consultas por mês UTC; inteiro positivo escolhido conforme o orçamento. |

Use uma base Redis separada para Preview, para não consumir os contadores de produção. Defina os limites a partir do preço atual contratado no Brave e inclua custos de Redis e Vercel no orçamento. **Nenhuma cobrança ou limite monetário foi presumido**: sem os dois limites explicitamente configurados, a busca fica bloqueada. Configure também os tetos de gasto nos provedores; os contadores da aplicação limitam consultas de busca, não as demais despesas da infraestrutura nem uso da chave fora deste endpoint. Não habilite upgrades automáticos de plano sem revisar o orçamento.

A configuração replica a chave existente exclusivamente para autorizar o novo endpoint. Não altera a autenticação Supabase. Ao trocar/revogar a chave do painel, atualize também `RADAR_DASHBOARD_KEY` e reimplante. Não utilizamos `crm_get_dashboard_v2` no servidor para autenticar, evitando que o IP do servidor interfira na identificação de rede do CRM. Não há necessidade de service-role key ou migração de banco.

Depois de salvar variáveis, gere uma nova implantação **Preview**. Entre no CRM, abra Radar e use “Verificar conexão”: essa operação não chama Brave nem Redis e apenas verifica a presença/formato da configuração. Faça uma busca controlada para validar as credenciais reais e o contador; falhas no provedor podem consumir uma consulta e são contabilizadas conservadoramente. Não há reembolso automático de reservas. Aguarde cinco segundos entre buscas.

## O que os resultados significam

- O nome é o título indexado, não uma razão social verificada. A descrição é um trecho público do provedor; cada cartão oferece sua URL de origem e a consulta/data ficam visíveis.
- A região é um termo de busca, não geolocalização confirmada. Não inventamos endereços, telefones, e-mails, notas de qualidade ou análises.
- Removemos repetição de domínio normalizado (incluindo `www`, caminhos e parâmetros de campanha). No navegador, também removemos correspondências exatas de nome normalizado ou domínio de projeto com os leads carregados no CRM, inclusive arquivados. Variações de nome, diferentes domínios e títulos com sufixos podem escapar: revise antes de criar um lead.
- Excluímos indícios de Nuvemshop/Tiendanube, Shopify, Wix, Loja Integrada, Tray Commerce, VTEX, WooCommerce, Squarespace e BigCommerce no domínio/título/trechos. Também descartamos alguns diretórios, marketplaces e redes sociais. Uma referência a uma plataforma pode causar falso positivo, e um domínio próprio pode ocultar sua tecnologia. Por isso todos os restantes dizem **Plataforma não verificada**. Não prometemos detecção completa.
- “Preparar lead” preenche apenas nome e slug no formulário existente. O usuário precisa revisar e informar a URL **do projeto que vai apresentar**, não a URL da empresa encontrada. E-mail permanece vazio. Criar o lead continua usando o contrato `crm_create_lead`; nenhuma mensagem é enviada.
- Resultados ficam em memória durante a sessão da página, sem retenção em Redis. Redis armazena somente contadores e cooldown. Revisite os termos do plano antes de adicionar armazenamento persistente de dados de busca.

## Segurança e limites

A chave do painel é enviada em Authorization, nunca na URL. Comparação no servidor usa hashes de tamanho fixo e comparação constante. Requisições com Origin diferente são recusadas e respostas não são cacheadas. Os destinos de rede são fixos: Brave e a URL Redis configurada pelo administrador. URLs dos candidatos nunca são acessadas pelo servidor. Cartões usam textContent e somente links HTTP(S). Não registramos corpos de resposta dos provedores ou segredos em logs.

Uma reserva Redis Lua atômica limita todas as instâncias simultâneas por dia/mês UTC e impõe cinco segundos entre buscas. Falha no Redis bloqueia a busca. Falhas e timeouts de Brave mantêm a reserva, pois a consulta pode ter sido cobrada. Não apague a base ou os contadores durante um período ativo: isso reinicia o orçamento. Compartilhe a mesma base entre instâncias de uma implantação. Configure proteção de implantação/firewall na Vercel contra abuso de requisições, pois o contador protege chamadas autorizadas ao Brave, não todo o tráfego de infraestrutura.

## Verificação

Em `CRM/tests`, execute `npm ci`, `npm run test:api` e `npm test`. Instale Chromium com Playwright ou selecione Edge usando `CRM_BROWSER_CHANNEL=msedge`.

Os testes da API cobrem autorização, origem, validação, configuração incompleta, orçamento/cooldown, erros/timeouts, limites de resultados, URLs e filtros. Os testes de navegador exercitam o handler real com Brave/Redis simulados, verificam resultados, preparação manual, estados de erro e layout em 320/390/768/1024/1440 px. Também repetem os fluxos de login, leads, rastreamento, edição e agendamento do CRM com Supabase simulado. As fixtures são identificadas como fixtures e nunca são usadas pela aplicação.

Antes de merge/publicação, ainda é necessário validar uma busca real com credenciais de Preview, verificar a reserva atômica no Redis real e executar um smoke test autenticado de CRM/Supabase em ambiente seguro. Não houve alteração de schema nem escrita de teste em produção.

## Próximas etapas (não implementadas)

1. Validar precisão de resultados e plataformas com uma pequena amostra real; melhorar nomes/domínios e medir falsos positivos sem aumentar consultas automaticamente.
2. Adicionar auditoria técnica **sob demanda**, com timeout, limite de tamanho, proteção SSRF/DNS/redirect, respeito aos termos dos sites e evidências explícitas por achado. Nenhuma auditoria roda nesta versão.
3. Avaliar análise visual/IA somente após definir provedor, consentimento para envio de conteúdo, teto de gasto e critérios de qualidade. Mostrar evidências e incerteza, nunca pontuação inventada.
4. Se necessário, adicionar prospects persistentes em tabela separada com autorização e migração revisadas, sem alterar leads existentes. Rascunhos personalizados dependerão de revisão humana; envio em massa permanece fora do escopo.

Referências: [Brave Web Search](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started), [Upstash REST API](https://upstash.com/docs/redis/features/restapi), [Vercel Functions](https://vercel.com/docs/functions).
