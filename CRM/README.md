# CRM visual redesign

## Workbench redesign (November 2026)

`workbench.css` provides the shared graphite / amber visual system for the local CRM, legacy e-commerce workspace and public onboarding form. `workbench.js` handles short navigation and value-update animations, modal keyboard containment and focus restoration. System reduced-motion preference cancels active animations. The Radar scope only sweeps during a real search. The globe retains its existing lazy loading and frame-rate limit with a new palette.

The local client view supports stage columns and the existing list. Both use the same filtered leads, edit dialog and original save/status actions. No API, database, authentication, sending, quota or billing contracts were changed. All changes are confined to `CRM/`.

From `CRM/tests`, install with `npm ci`, then run `npm run test:workbench` (local CRM and onboarding) and `npm test` (legacy CRM). Set `CRM_BROWSER_CHANNEL=msedge` for the legacy suite on Windows, or select another installed Playwright channel. Both suites intercept APIs and external traffic; they do not query production data or spend API credits. The workbench suite covers seven routes, responsive layouts, login, filters, stage/list switching, lead creation and editing, status changes, globe selection, scan/history, templates, onboarding display, cost errors and reduced motion. The legacy suite now targets `legacy.html` and checks the current approach composer instead of retired visual-audit controls. Screenshots remain ignored under `tests/artifacts/`.

The notes below describe the earlier legacy implementation.

The CRM remains a static HTML page. `crm.css` contains the responsive design tokens, navigation, cards, lead list, dialogs and reduced-motion rules. Radar now has an isolated UI (`radar.js`/`radar.css`) and server-side discovery endpoint (`api/radar.js`). See [Radar setup, limitations and staged roadmap](RADAR.md). Search stays disabled until server credentials and explicit usage limits are configured.

## Preserved contracts

- Dashboard: `crm_get_dashboard_v2` with `p_key`; same 30-second refresh, unread-event storage and own-network recognition.
- Lead creation: `crm_create_lead`; same name, slug, project URL, email and scheduled timestamp fields.
- Lead edits/status: `crm_update_lead`; response, sent, archive/reactivate and prospect email patches unchanged.
- Event cleanup: `crm_clear_lead_events`; confirmation retained.
- Tracked URLs keep the `r` token and existing query-string handling. Project pages, their `track_lead_event` calls, portfolio analytics/API and analytics authentication are unchanged.
- Existing local/session access-key storage retained. No backend schema or credentials changed.

## Verification

From `CRM/tests`, run `npm install`, `npx playwright install chromium`, then `npm test`. To use an installed Edge browser, set `CRM_BROWSER_CHANNEL=msedge`. Screenshots are saved in ignored `artifacts/`; override with `CRM_ARTIFACTS`.

Tests start an ephemeral local server and intercept all external requests. Supabase responses and mutations are simulated; no production requests or database writes occur. Coverage includes invalid/valid login, metrics, own events, filters/search, keyboard opening, link copy, email edits, replies, archive/reactivate, clearing events with confirm/cancel, lead creation and scheduling, marking sent/seen, reduced motion and 320/390/768/1024/1440px overflow checks.

Visual review covers desktop, mobile and lead details. A live authenticated Supabase smoke test remains for the owner in a safe test environment. There is no build step or production deployment in this change.
