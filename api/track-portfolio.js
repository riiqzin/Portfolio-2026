const SUPABASE_URL = "https://iwaebalwypjvxxeyvfln.supabase.co";
const SUPABASE_KEY = "sb_publishable_uwIBBOevkarh4yYzHPPbcw_EH7V65U6";

function clean(value, max = 200) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function decodeHeader(value, max = 200) {
  if (!value) return null;
  try {
    return clean(decodeURIComponent(value), max);
  } catch {
    return clean(value, max);
  }
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json(
        { ok: false, error: "method_not_allowed" },
        { status: 405, headers: { Allow: "POST" } }
      );
    }

    try {
      const body = await request.json();

      const forwardedFor = request.headers.get("x-forwarded-for") || "";
      const ip = clean(forwardedFor.split(",")[0], 80);
      const country = clean(request.headers.get("x-vercel-ip-country"), 2);
      const region = decodeHeader(request.headers.get("x-vercel-ip-country-region"), 100);
      const city = decodeHeader(request.headers.get("x-vercel-ip-city"), 150);

      const payload = {
        p_event_name: body.event_name,
        p_visitor_id: body.visitor_id,
        p_session_id: body.session_id,
        p_path: body.path,
        p_page_title: body.page_title || null,
        p_referrer: body.referrer || null,
        p_referrer_host: body.referrer_host || null,
        p_utm_source: body.utm_source || null,
        p_utm_medium: body.utm_medium || null,
        p_utm_campaign: body.utm_campaign || null,
        p_device_type: body.device_type || null,
        p_browser: body.browser || null,
        p_os: body.os || null,
        p_language: body.language || null,
        p_metadata: body.metadata || {},
        p_ip_address: ip,
        p_country_code: country,
        p_region: region,
        p_city: city
      };

      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/track_portfolio_analytics_event`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        const detail = await response.text();
        console.error(
          "Portfolio analytics Supabase error:",
          response.status,
          detail
        );

        return Response.json(
          { ok: false, error: "supabase_error", detail },
          { status: 502 }
        );
      }

      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" }
      });
    } catch (error) {
      console.error("Portfolio analytics function error:", error);
      return Response.json(
        { ok: false, error: "internal_error" },
        { status: 500 }
      );
    }
  }
};
