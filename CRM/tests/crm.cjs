const { chromium, expect } = require("@playwright/test");
const fs = require("fs"),
  http = require("http"),
  path = require("path");
const root = path.resolve(__dirname, "../..");
const artifacts =
  process.env.CRM_ARTIFACTS || path.join(__dirname, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const ago = (n) => new Date(Date.now() - n * 60000).toISOString();
const base = (id, name, extra = {}) => ({
  id,
  name,
  active: true,
  project_url: "https://example.test/" + id,
  tracking_token: "token-" + id,
  created_at: ago(500),
  email_sent_at: ago(300),
  opened_count: 0,
  interaction_count: 0,
  ...extra,
});
(async () => {
  const { createHandler } = await import('../../api/radar.js');
  let radarMode = 'ready';
  const radarEnv = { RADAR_DASHBOARD_KEY: 'test-key', BRAVE_SEARCH_API_KEY: 'fixture-key', UPSTASH_REDIS_REST_URL: 'https://fixture.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'fixture-token', RADAR_DAILY_LIMIT: '10', RADAR_MONTHLY_LIMIT: '30', RADAR_BUDGET_CENTS: '8000', RADAR_SEARCH_RESERVE_CENTS: '10', RADAR_AUDIT_RESERVE_CENTS: '100' };
  const radarCalls = [];
  const auditCalls = [];
  const auditFixture = { id: '11111111-1111-4111-8111-111111111111', status: 'completed', evidence: { capturedAt: '2026-11-10T12:00:00Z', limitations: ['Fixture: captura estática sem JavaScript.'], screenshots: [] }, technical: [{ observation: 'Fixture: viewport ausente', evidence: 'meta[name=viewport] ausente' }], visual: { status: 'completed', summary: 'Fixture: <script>não executar</script>', uncertainty: 'Fixture: revisar manualmente', findings: [] }, priority: { score: 0, label: 'Sem problema forte identificado', reason: 'Fixture: prioridade provisória, sem métricas de conversão.' }, pagespeed: { message: 'PageSpeed não consultado.' } };
  const radar = createHandler({ env: radarEnv, fetcher: async (url, options) => {
    radarCalls.push(String(url));
    if (String(url).includes('upstash')) return Response.json({ result: radarMode === 'quota' ? [0, 10, 10] : JSON.parse(options.body)[2] === 1 ? [1, 10] : [1, 1, 1] });
    if (radarMode === 'error') return Response.json({}, { status: 429 });
    return Response.json({ web: { results: radarMode === 'empty' ? [] : [
      { title: 'Batcaverna', url: 'https://batcaverna.example.com', description: 'Fixture: existing CRM lead' },
      { title: 'Clínica Horizonte — fixture', url: 'https://horizonte.example.com', description: 'Fixture: atendimento odontológico em Campinas.' },
      { title: 'Outra página', url: 'https://www.horizonte.example.com/contato' },
      { title: 'Loja excluída', url: 'https://loja.example.com', description: 'Nuvemshop' },
      { title: '<img src=x onerror=alert(1)>Consultório — fixture', url: 'https://consultorio.example.com', description: 'Fixture: descrição pública sem contatos.' }
    ] } });
  } });
  const server = http
    .createServer((req, res) => {
      const f = path.join(
        root,
        req.url.split("?")[0].replace(/\/$/, "/index.html"),
      );
      if (!f.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      try {
        res.setHeader(
          "Content-Type",
          f.endsWith(".css") ? "text/css" : f.endsWith('.js') ? 'text/javascript' : "text/html",
        );
        res.end(fs.readFileSync(f));
      } catch {
        res.writeHead(404).end();
      }
    })
    .listen(4173, "127.0.0.1");
  const browser = await chromium.launch({
    ...(process.env.CRM_BROWSER_CHANNEL
      ? { channel: process.env.CRM_BROWSER_CHANNEL }
      : {}),
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      reducedMotion: "reduce",
    });
    let leads = [
      base("1", "Batcaverna", {
        opened_count: 4,
        interaction_count: 2,
        first_opened_at: ago(150),
        last_activity: ago(5),
        prospect_email: "contato@batcaverna.test",
        notes: "Retomar a conversa após a apresentação.",
      }),
      base("2", "MW Informática", {
        opened_count: 2,
        first_opened_at: ago(180),
        responded_at: ago(30),
      }),
      base("3", "Isabela Boscov"),
      base("4", "Brunox", {
        email_sent_at: null,
        email_scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      }),
      base("5", "Central HQs", { active: false }),
      base("6", "Novo projeto", { email_sent_at: null }),
    ];
    let events = [
      {
        lead_id: "1",
        event_type: "engaged",
        created_at: ago(5),
        network_id: "7",
        device: "desktop",
      },
      {
        lead_id: "1",
        event_type: "opened",
        created_at: ago(8),
        is_self: true,
        device: "mobile",
      },
      {
        lead_id: "2",
        event_type: "opened",
        created_at: ago(180),
        network_id: "8",
        device: "desktop",
      },
    ];
    const calls = [],
      errors = [];
    await context.route("**/*", async (r) => {
      let u = new URL(r.request().url());
      if (u.hostname === '127.0.0.1' && u.pathname === '/api/radar-audit') {
        auditCalls.push(r.request().method());
        if (r.request().method() === 'POST') return r.fulfill({ status: 202, json: { id: auditFixture.id } });
        return r.fulfill({ json: u.searchParams.has('id') ? auditFixture : { workerOnline: true, reservedCents: 100, budgetCents: 8000, auditReserveCents: 100, dailyLimit: 10 } });
      }
      if (u.hostname === '127.0.0.1' && u.pathname === '/api/radar') {
        const req = r.request();
        const response = await radar(new Request(req.url(), { method: req.method(), headers: req.headers(), ...(req.method() === 'POST' ? { body: req.postData() } : {}) }));
        return r.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
      }
      if (u.hostname === "127.0.0.1") return r.continue();
      if (!u.hostname.endsWith(".supabase.co")) return r.abort();
      const name = u.pathname.split("/").pop(),
        body = r.request().postDataJSON();
      calls.push({ name, body });
      if (body.p_key !== "test-key")
        return r.fulfill({
          headers: { "access-control-allow-origin": "*" },
          status: 401,
          json: { message: "Invalid key" },
        });
      let data = {};
      if (name === "crm_get_dashboard_v2")
        data = {
          leads,
          events,
          current_ip: "192.0.2.10",
          current_network_id: 3,
          own_networks_count: 1,
          network_tracking_active: true,
        };
      if (name === "crm_update_lead")
        Object.assign(
          leads.find((l) => l.id === body.p_lead_id),
          body.p_patch,
        );
      if (name === "crm_create_lead") {
        leads.push(
          base("7", body.p_name, {
            project_url: body.p_project_url,
            prospect_email: body.p_email,
            email_scheduled_at: body.p_scheduled_at,
          }),
        );
        data = { tracked_url: body.p_project_url + "?r=new-token" };
      }
      if (name === "crm_clear_lead_events") {
        data = { deleted: events.length };
        events = events.filter((e) => e.lead_id !== body.p_lead_id);
      }
      return r.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: data,
      });
    });
    await context.addInitScript(
      ({ last }) => {
        localStorage.setItem("ricky_crm_last_seen", last);
        Object.defineProperty(navigator, "clipboard", {
          value: {
            writeText: async (text) => {
              window.copied = text;
            },
          },
        });
      },
      { last: ago(60) },
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:4173/CRM/");
    await expect(page.locator("#loginOverlay")).toBeVisible();
    await page.locator("#loginKey").fill("invalid");
    await page.locator("#loginBtn").click();
    await expect(page.locator("#loginError")).toBeVisible();
    await page.locator("#loginKey").fill("test-key");
    await page.locator("#loginBtn").click();
    await expect(page.locator("#loginOverlay")).toBeHidden();
    await expect(page.locator(".lead-row")).toHaveCount(5);
    await expect(page.locator("#mNews")).toHaveText("1");
    await expect(page.locator("#mOpened")).toHaveText("2");
    await expect(page.locator("#mReplied")).toHaveText("1");
    await expect(page.locator("#mWaiting")).toHaveText("1");
    await page.screenshot({
      path: path.resolve(artifacts, "crm-desktop.png"),
      fullPage: true,
    });
    await page.locator("#markSeenBtn").click();
    await expect(page.locator("#mNews")).toHaveText("0");
    await page.locator("#leadSearch").fill("BATCAVERNA");
    await expect(page.locator(".lead-row")).toHaveCount(1);
    await page.locator("#leadSearch").fill("no-match");
    await expect(page.locator(".empty")).toContainText("Nenhum contato");
    await page.locator("#leadSearch").fill("");
    await page.locator('[data-filter="waiting"]').click();
    await expect(page.locator(".lead-row")).toHaveCount(1);
    await page.locator('[data-filter="all"]').click();
    await expect(page.locator(".lead-row")).toHaveCount(6);
    await page.locator('[data-filter="active"]').click();
    await page.locator('[data-id="1"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#drawerWrap")).toHaveClass("drawer-wrap open");
    await expect(page.locator(".event")).toHaveCount(2);
    await expect(page.locator(".own-event")).toHaveCount(1);
    await page.locator("#drawerCopy").click();
    expect(await page.evaluate(() => window.copied)).toBe(
      "https://example.test/1?r=token-1",
    );
    await page.locator("#drawerLeadEmail").fill("novo@example.test");
    await page.locator("#saveLeadEmail").click();
    await expect(page.locator("#drawerLeadEmail")).toHaveValue(
      "novo@example.test",
    );
    await page.locator('[data-action="reply"]').click();
    await expect(page.locator('[data-action="unreply"]')).toBeVisible();
    await page.locator('[data-action="unreply"]').click();
    await expect(page.locator('[data-action="reply"]')).toBeVisible();
    await page.locator('[data-action="archive"]').click();
    await expect(page.locator('[data-action="activate"]')).toBeVisible();
    await page.locator('[data-action="activate"]').click();
    await expect(page.locator('[data-action="archive"]')).toBeVisible();
    await page.screenshot({
      path: path.resolve(artifacts, "crm-detalhes.png"),
    });
    page.once("dialog", (d) => d.dismiss());
    await page.locator("#clearTrackingBtn").click();
    expect(
      calls.filter((c) => c.name === "crm_clear_lead_events"),
    ).toHaveLength(0);
    page.once("dialog", (d) => d.accept());
    await page.locator("#clearTrackingBtn").click();
    await expect(page.locator(".event")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.locator('.sidebar nav a[href="#radar"]').click();
    await expect(page.locator('#radarPanel')).toBeVisible();
    await expect(page.locator('.dashboard-layout')).toBeHidden();
    await expect(page.locator('#radarStatus')).toContainText('Pronto para buscar');
    expect(radarCalls).toHaveLength(0);
    await page.locator('#radarNiche').fill('Dentistas');
    await page.locator('#radarRegion').fill('Campinas, SP');
    await page.locator('#radarSearch').click();
    await expect(page.locator('.prospect-card')).toHaveCount(2);
    await expect(page.locator('#radarSummary')).toContainText('2 duplicados');
    await expect(page.locator('#radarSummary')).toContainText('1 com indícios');
    await expect(page.locator('#radarSource')).toContainText('Brave Search');
    expect(radarCalls).toHaveLength(3);
    expect(await page.locator('.prospect-card img').count()).toBe(0);
    const writesBefore = calls.filter(c => c.name === 'crm_create_lead').length;
    await page.locator('.prospect-card button').first().click();
    await expect(page.locator('#leadName')).toHaveValue('Clínica Horizonte — fixture');
    await expect(page.locator('#leadUrl')).toHaveValue('');
    await expect(page.locator('#leadEmail')).toHaveValue('');
    expect(calls.filter(c => c.name === 'crm_create_lead').length).toBe(writesBefore);
    await page.locator('#modalClose').click();
    await page.locator('#toast').evaluate(e => e.classList.remove('show'));
    expect(auditCalls.filter(method => method === 'POST')).toHaveLength(0);
    await page.getByRole('button', { name: 'Auditar site', exact: true }).first().click();
    await expect(page.locator('.audit-state').first()).toContainText('Auditoria disponível');
    await page.locator('.audit-details summary').first().click();
    await expect(page.locator('.audit-details').first()).toContainText('Fixture: <script>não executar</script>');
    expect(await page.locator('.audit-details script').count()).toBe(0);
    expect(calls.filter(c => c.name === 'crm_create_lead').length).toBe(writesBefore);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.activeElement?.blur());
      expect(await page.locator('#radarAutoAudit').evaluate(el => el.getBoundingClientRect().width)).toBe(18);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if ([390, 1440].includes(width)) await page.screenshot({ path: path.resolve(artifacts, `radar-${width}.png`), fullPage: true });
    }
    await page.locator('#radarAutoAudit').check();
    await page.locator('#radarSearch').click();
    await expect(page.locator('#radarSearch')).toBeEnabled();
    expect(auditCalls.filter(method => method === 'POST')).toHaveLength(3);
    await page.locator('#radarAutoAudit').uncheck();
    radarMode = 'empty';
    await page.locator('#radarSearch').click();
    await expect(page.locator('#radarResults')).toContainText('Nenhum candidato novo');
    radarMode = 'quota';
    await page.locator('#radarSearch').click();
    await expect(page.locator('#radarStatus')).toContainText('Limite diário ou mensal atingido');
    radarMode = 'error';
    await page.locator('#radarSearch').click();
    await expect(page.locator('#radarStatus')).toContainText('O provedor atingiu seu limite');
    radarEnv.BRAVE_SEARCH_API_KEY = '';
    await page.locator('#radarCheck').click();
    await expect(page.locator('#radarStatus')).toContainText('Configure Brave Search');
    await expect(page.locator('#radarSearch')).toBeEnabled();
    await page.locator('.sidebar nav a[href="#app"]').click();
    await expect(page.locator('.dashboard-layout')).toBeVisible();
    await expect(page.locator('#radarPanel')).toBeHidden();
    await page.locator("#newLeadBtn").click();
    await page.locator("#leadName").fill("Conexão Nova");
    await expect(page.locator("#leadSlug")).toHaveValue("conexao-nova");
    await page.locator("#leadUrl").fill("https://example.test/new");
    await page.locator("#leadEmail").fill("lead@example.test");
    await page.locator("#leadSchedule").fill("2027-01-02T10:30");
    await page.locator("#saveLead").click();
    await expect(page.locator("#leadName")).toHaveValue("");
    await expect
      .poll(() => calls.some((c) => c.name === "crm_create_lead"))
      .toBe(true);
    expect(calls.find((c) => c.name === "crm_create_lead").body).toMatchObject({
      p_name: "Conexão Nova",
      p_slug: "conexao-nova",
      p_email: "lead@example.test",
    });
    await page.locator("#modalClose").click();
    await page.locator('[data-id="4"]').click();
    await page.locator('[data-action="sent"]').click();
    await expect(page.locator('[data-action="sent"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 390) {
        await page
          .locator("#toast")
          .evaluate((e) => e.classList.remove("show"));
      }
      if (width === 390)
        await page.screenshot({
          path: path.resolve(artifacts, "crm-mobile.png"),
          fullPage: true,
        });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".workspace")
        .evaluate((e) => getComputedStyle(e).animationName),
    ).toBe("none");
    expect(errors).toEqual([]);
    console.log(
      JSON.stringify(
        {
          result: "PASS",
          checks: [
            "login valid/invalid",
            "metrics and own event exclusion",
            "search and filters",
            "keyboard lead opening",
            "tracked link copy",
            "email edit",
            "reply/unreply",
            "archive/reactivate",
            "clear events cancel/confirm",
            "create lead schedule slug payload",
            "mark sent",
            "mark seen",
            "5 responsive widths no overflow",
            "reduced motion",
            "no JavaScript errors",
            "Radar real handler with mocked provider: setup, auth, search, dedup, platform filtering, quota, provider error, empty state",
            "Radar safe rendering, manual lead preparation without write, navigation and 5 responsive widths",
          ],
          rpcCalls: calls.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
