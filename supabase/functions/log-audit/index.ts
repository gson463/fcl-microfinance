import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { getClientIp, geoLabelFromIp } from "../_shared/audit.ts";
import { isAuditExemptEmail } from "../_shared/auditExempt.ts";

type Body = {
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  metadata?: Record<string, unknown>;
  user_agent?: string | null;
  device_summary?: string | null;
  client_ip?: string | null;
  client_location_label?: string | null;
  client_latitude?: number | null;
  client_longitude?: number | null;
  client_location_accuracy_m?: number | null;
  client_location_source?: string | null;
};

function formatGpsLabel(
  lat: number | null | undefined,
  lng: number | null | undefined,
  acc: number | null | undefined,
): string | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const accStr =
    acc != null && Number.isFinite(acc) ? ` (±${Math.round(acc)}m)` : "";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}${accStr}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const jwt = authHeader.replace("Bearer ", "");
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (isAuditExemptEmail(userData.user.email)) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = (await req.json()) as Body;
    const {
      action,
      entity_type,
      entity_id,
      metadata,
      user_agent,
      device_summary,
      client_ip,
      client_location_label,
      client_latitude,
      client_longitude,
      client_location_accuracy_m,
      client_location_source,
    } = body;
    if (!action || typeof action !== "string") {
      return new Response(JSON.stringify({ error: "action required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headerIp = getClientIp(req);
    const ip = headerIp || client_ip || null;

    const hasGps =
      client_latitude != null &&
      client_longitude != null &&
      Number.isFinite(Number(client_latitude)) &&
      Number.isFinite(Number(client_longitude));

    let location_label: string | null = client_location_label ?? null;
    if (!location_label && hasGps) {
      location_label = formatGpsLabel(
        Number(client_latitude),
        Number(client_longitude),
        client_location_accuracy_m != null ? Number(client_location_accuracy_m) : null,
      );
    }
    if (!location_label && ip) {
      location_label = await geoLabelFromIp(ip);
    }

    const ua = user_agent ?? req.headers.get("user-agent") ?? null;

    const { error: insErr } = await supabaseAdmin.from("audit_logs").insert({
      user_id: userData.user.id,
      action: action.trim(),
      entity_type: entity_type ?? null,
      entity_id: entity_id ?? null,
      metadata: metadata ?? {},
      ip_address: ip,
      user_agent: ua,
      device_summary: device_summary ?? null,
      location_label,
      latitude: hasGps ? Number(client_latitude) : null,
      longitude: hasGps ? Number(client_longitude) : null,
      location_accuracy_m:
        client_location_accuracy_m != null && Number.isFinite(Number(client_location_accuracy_m))
          ? Number(client_location_accuracy_m)
          : null,
      location_source: hasGps
        ? (client_location_source ?? "gps_session")
        : null,
    });
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
