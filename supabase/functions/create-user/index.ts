import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

function formatErr(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { message?: string; details?: string; hint?: string; status?: number };
    const parts = [o.message, o.details, o.hint].filter(Boolean);
    if (parts.length) return parts.join(" — ");
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Compare UUIDs from DB vs JSON (case / whitespace). */
function normUuid(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === "") return null;
  return t.toLowerCase();
}

function normRole(r: string | null | undefined): string {
  return (r ?? "").trim().toLowerCase();
}

/** Role / branch from JWT when public.users row is missing or out of sync. */
function roleBranchFromJwt(user: {
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}): { role: string | null; branchId: string | null } {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const app = user.app_metadata as Record<string, unknown> | undefined;
  const rawRole =
    (typeof meta?.role === "string" ? meta.role : null) ??
    (typeof app?.role === "string" ? app.role : null);
  const rawBranch =
    (typeof meta?.branch_id === "string" ? meta.branch_id : null) ??
    (typeof app?.branch_id === "string" ? app.branch_id : null);
  return {
    role: rawRole ? normRole(rawRole) : null,
    branchId: rawBranch ? String(rawBranch).trim() : null,
  };
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

    const { data: callerRow, error: callerErr } = await supabaseAdmin
      .from("users")
      .select("role, branch_id")
      .eq("id", jwtUser.user.id)
      .maybeSingle();

    const jwtRB = roleBranchFromJwt(jwtUser.user);

    let callerRole: string;
    let callerBranchId: string | null;

    if (callerRow && !callerErr) {
      callerRole = normRole(callerRow.role);
      callerBranchId = callerRow.branch_id;
    } else if (jwtRB.role && ["admin", "manager", "officer"].includes(jwtRB.role)) {
      // No users row (or query issue): trust JWT so admins/managers can still work.
      callerRole = jwtRB.role;
      callerBranchId = jwtRB.branchId;
    } else {
      return new Response(
        JSON.stringify({
          error:
            "No profile in users table and no role in your session. Add a row in public.users for this account or sign in again.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { full_name, email, password, role, branch_id } = body;

    const name = typeof full_name === "string" ? full_name.trim() : "";
    const mail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const pwd = typeof password === "string" ? password : "";

    const branchRaw = branch_id;
    const branchId =
      branchRaw == null || String(branchRaw).trim() === ""
        ? null
        : String(branchRaw).trim();

    if (!mail || !pwd || !role || !name) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newRole = normRole(role);
    if (!["admin", "manager", "officer"].includes(newRole)) {
      return new Response(JSON.stringify({ error: "Invalid role" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (newRole === "manager" || newRole === "officer") {
      if (!branchId) {
        return new Response(
          JSON.stringify({ error: "branch_id is required for manager and officer roles" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (callerRole === "admin") {
      // admins may create admin, manager, or officer
    } else if (callerRole === "manager") {
      const meta = jwtUser.user.user_metadata as Record<string, unknown> | undefined;
      const callerBranch =
        normUuid(callerBranchId) ?? normUuid(meta?.branch_id as string | undefined);
      const incoming = normUuid(branchId);
      if (newRole !== "officer") {
        return new Response(
          JSON.stringify({ error: "Managers can only create loan officers" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!incoming || !callerBranch || incoming !== callerBranch) {
        return new Response(
          JSON.stringify({
            error:
              "Branch mismatch: your profile must have a branch assigned. Sign out and sign in again, or contact an admin.",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email: mail,
        password: pwd,
        email_confirm: true,
        user_metadata: {
          full_name: name,
          role: newRole,
          branch_id: newRole === "admin" ? null : branchId,
        },
      });
    if (authError) throw authError;
    if (!authData.user) throw new Error("No user returned");

    const row = {
      id: authData.user.id,
      full_name: name,
      email: mail,
      role: newRole,
      branch_id: newRole === "admin" ? null : branchId,
    };

    const { error: upsertError } = await supabaseAdmin.from("users").upsert(row, {
      onConflict: "id",
    });
    if (upsertError) throw upsertError;

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
