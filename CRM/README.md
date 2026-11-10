# CRM visual redesign

The CRM remains a static HTML page. `crm.css` contains the responsive design tokens, navigation, cards, lead list, dialogs and reduced-motion rules. The Radar entry is explicitly a future module, not an implemented discovery service.

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
