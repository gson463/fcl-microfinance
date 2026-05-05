import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

/** Only this account may start impersonation (same as app + impersonate-start function). */
const SUPER_ADMIN_IMPERSONATION_EMAIL = "admin@faharicredits.co.tz";

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

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    // -------------------------------------------------------------------------
    // Super-admin impersonation (avoids deploying a separate Edge Function)
    // -------------------------------------------------------------------------
    if (body?.action === "impersonate_start") {
      const callerEmail = String(jwtUser.user.email ?? "").trim().toLowerCase();
      if (callerEmail !== SUPER_ADMIN_IMPERSONATION_EMAIL) {
        return new Response(
          JSON.stringify({ error: "Impersonation is limited to the designated admin account." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (callerRow?.role?.trim().toLowerCase() !== "admin") {
        return new Response(JSON.stringify({ error: "Caller must have an admin profile." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const targetId = typeof body.target_user_id === "string" ? body.target_user_id.trim() : "";
      if (!targetId) {
        return new Response(JSON.stringify({ error: "target_user_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (targetId === jwtUser.user.id) {
        return new Response(JSON.stringify({ error: "Cannot impersonate yourself" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: pubTarget, error: pubErr } = await supabaseAdmin
        .from("users")
        .select("id, full_name, email, role, is_active")
        .eq("id", targetId)
        .maybeSingle();

      if (pubErr || !pubTarget?.id) {
        return new Response(JSON.stringify({ error: "User not found in directory" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (pubTarget.is_active === false) {
        return new Response(JSON.stringify({ error: "Cannot impersonate an inactive user" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: targetAuth, error: targetAuthErr } = await supabaseAdmin.auth.admin.getUserById(targetId);
      if (targetAuthErr || !targetAuth.user?.email) {
        return new Response(JSON.stringify({ error: "Target auth user not found or has no email" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const targetEmail = String(targetAuth.user.email).trim();

      const { data: linkOut, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: targetEmail,
      });

      if (linkErr || !linkOut?.properties) {
        console.error("generateLink failed:", linkErr);
        return new Response(
          JSON.stringify({ error: linkErr?.message ?? "Could not create impersonation token" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const props = linkOut.properties as Record<string, unknown>;
      const hashed_token =
        (typeof props.hashed_token === "string" && props.hashed_token) ||
        (typeof props.token_hash === "string" && props.token_hash) ||
        null;

      if (!hashed_token) {
        console.error("generateLink missing hashed_token", props);
        return new Response(JSON.stringify({ error: "Malformed auth link response" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: auditErr } = await supabaseAdmin.from("audit_logs").insert({
        user_id: jwtUser.user.id,
        action: "admin.impersonation.start",
        entity_type: "user",
        entity_id: targetId,
        metadata: {
          target_email: targetEmail,
          target_name: pubTarget.full_name ?? null,
          target_role: pubTarget.role ?? null,
        },
      });
      if (auditErr) console.warn("audit_logs impersonation insert:", auditErr);

      return new Response(
        JSON.stringify({
          token_hash: hashed_token,
          email: targetEmail,
          target_user_id: targetId,
          target_full_name: pubTarget.full_name ?? "",
          target_role: pubTarget.role ?? "",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!callerRole || !["admin", "manager"].includes(callerRole)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { userId, password } = body as { userId?: string; password?: string };
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
