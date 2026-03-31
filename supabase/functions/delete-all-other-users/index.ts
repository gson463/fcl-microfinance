import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { totalAndMessage } from "../_shared/userAssociations.ts";

function isAdminRoleFromAuthUser(u: {
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}): boolean {
  const m = u.user_metadata;
  const a = u.app_metadata;
  const r =
    (typeof m?.role === "string" ? m.role : null) ??
    (typeof a?.role === "string" ? a.role : null);
  return (r ?? "").trim().toLowerCase() === "admin";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userData.user.id)
      .single();
    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let deleted = 0;
    let skipped_associated = 0;
    let skipped_admin = 0;
    let page = 1;
    while (true) {
      const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (listErr) throw listErr;
      const users = listData?.users ?? [];
      if (users.length === 0) break;
      for (const u of users) {
        if (u.id === userData.user.id) continue;

        const { data: row } = await supabaseAdmin
          .from("users")
          .select("role")
          .eq("id", u.id)
          .maybeSingle();
        if (row?.role?.trim().toLowerCase() === "admin") {
          skipped_admin++;
          continue;
        }
        if (!row && isAdminRoleFromAuthUser(u)) {
          skipped_admin++;
          continue;
        }

        const { data: summary, error: sumErr } = await supabaseAdmin.rpc(
          "user_associated_data_summary",
          { p_user_id: u.id },
        );
        if (sumErr) {
          skipped_associated++;
          continue;
        }
        const { total } = totalAndMessage((summary ?? {}) as Record<string, unknown>);
        if (total > 0) {
          skipped_associated++;
          continue;
        }

        await supabaseAdmin.from("users").delete().eq("id", u.id);
        const { error } = await supabaseAdmin.auth.admin.deleteUser(u.id);
        if (!error) deleted++;
      }
      if (users.length < 200) break;
      page++;
    }
    return new Response(
      JSON.stringify({
        deleted_count: deleted,
        skipped_associated,
        skipped_admin,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
