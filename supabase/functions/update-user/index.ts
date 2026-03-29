import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

function normUuid(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === "") return null;
  return t.toLowerCase();
}

function formatErr(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { message?: string; details?: string; hint?: string };
    const parts = [o.message, o.details, o.hint].filter(Boolean);
    if (parts.length) return parts.join(" — ");
  }
  if (e instanceof Error) return e.message;
  return String(e);
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
    const jwt = authHeader.replace("Bearer ", "");
    const { data: jwtUser, error: jwtErr } = await supabaseAdmin.auth.getUser(jwt);
    if (jwtErr || !jwtUser.user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerRow } = await supabaseAdmin
      .from("users")
      .select("role, branch_id")
      .eq("id", jwtUser.user.id)
      .maybeSingle();

    const meta = jwtUser.user.user_metadata as Record<string, unknown> | undefined;
    const callerRole = callerRow?.role?.trim().toLowerCase() ??
      (typeof meta?.role === "string" ? meta.role.trim().toLowerCase() : null);
    const callerBranchId = callerRow?.branch_id ??
      (typeof meta?.branch_id === "string" ? meta.branch_id : null);

    if (!callerRole || !["admin", "manager"].includes(callerRole)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { userId, password } = body;
    if (!userId || !password) {
      return new Response(JSON.stringify({ error: "userId and password required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (callerRole === "manager") {
      const { data: target } = await supabaseAdmin
        .from("users")
        .select("id, role, branch_id")
        .eq("id", userId)
        .maybeSingle();

      if (!target || target.role !== "officer") {
        return new Response(
          JSON.stringify({ error: "Managers can only reset passwords for loan officers" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const a = normUuid(callerBranchId);
      const b = normUuid(target.branch_id);
      if (!a || !b || a !== b) {
        return new Response(
          JSON.stringify({ error: "You can only reset passwords for officers in your branch" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: String(password),
    });
    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = formatErr(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
