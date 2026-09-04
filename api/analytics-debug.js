const SUPABASE_URL = "https://iwaebalwypjvxxeyvfln.supabase.co";

export default {
  async fetch(request) {
    let body = {};
    try { body = await request.json(); } catch {}
    const url = new URL(request.url);
    const key = String(body.key || url.searchParams.get("k") || "");
    if (!key.startsWith("sb_publishable_")) {
      return Response.json({ ok: false, error: "missing_key" }, { status: 400 });
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_portfolio_analytics_public`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_days: 30 })
    });

    const text = await response.text();
    console.log("analytics-debug", response.status, text.slice(0, 2000));

    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "text/plain",
        "Cache-Control": "no-store"
      }
    });
  }
};
