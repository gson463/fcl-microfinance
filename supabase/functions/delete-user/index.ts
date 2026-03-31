import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { totalAndMessage } from "../_shared/userAssociations.ts";

type AuthUserLike = {
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

function normUuid(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === "") return null;
  return t.toLowerCase();
}

function roleFromAuthUser(u: AuthUserLike): string {
  const m = u.user_metadata as Record<string, unknown> | undefined;
  const a = u.app_metadata as Record<string, unknown> | undefined;
  const r =
    (typeof m?.role === "string" ? m.role : null) ??
    (typeof a?.role === "string" ? a.role : null);
  return (r ?? "").trim().toLowerCase();
}

function branchFromAuthUser(u: AuthUserLike): string | null {
  const m = u.user_metadata as Record<string, unknown> | undefined;
  const b = typeof m?.branch_id === "string" ? m.branch_id : null;
  return b ? String(b).trim() : null;
}

function jsonErr(
  stage: string,
  message: string,
  hint?: string,
): Response {
  return new Response(
    JSON.stringify({
      error: message,
      stage,
      hint:
        hint ??
        "Check the stage field above: it shows which step failed. In Supabase: Edge Functions → delete-user → Logs.",
    }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function jsonMsg(
  status: number,
  error: string,
  stage: string,
): Response {
  return new Response(JSON.stringify({ error, stage }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonConflict(
  stage: string,
  message: string,
  counts: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({ error: message, stage, counts }),
    { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

async function assertNoAssociatedData(
  supabaseAdmin: ReturnType<typeof createClient>,
  userIdNorm: string,
): Promise<Response | null> {
  const { data: summary, error: sumErr } = await supabaseAdmin.rpc(
    "user_associated_data_summary",
    { p_user_id: userIdNorm },
  );
  if (sumErr) {
    return jsonErr("user_associated_data_summary", sumErr.message);
  }
  const summaryObj = (summary ?? {}) as Record<string, unknown>;
  const { total, message } = totalAndMessage(summaryObj);
  if (total > 0) {
    return jsonConflict("has_associated_data", message, summaryObj);
  }
  return null;
}

/**
 * Deletes auth user + public.users row only when no business data references this user.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonMsg(405, "Method not allowed", "method");
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonMsg(401, "Missing Authorization Bearer token", "auth_header");
    }
    const jwt = authHeader.replace("Bearer ", "");
    const { data: jwtUser, error: jwtErr } = await supabaseAdmin.auth.getUser(jwt);
    if (jwtErr || !jwtUser.user) {
      return jsonMsg(401, "Invalid or expired session", "auth_getUser");
    }
    const callerId = jwtUser.user.id;

    const { data: callerRow } = await supabaseAdmin
      .from("users")
      .select("role, branch_id")
      .eq("id", callerId)
      .maybeSingle();

    const meta = jwtUser.user.user_metadata as Record<string, unknown> | undefined;
    const callerRole = (callerRow?.role?.trim().toLowerCase() ??
      (typeof meta?.role === "string" ? meta.role.trim().toLowerCase() : null)) as
        | string
        | null;
    const callerBranchId = callerRow?.branch_id ??
      (typeof meta?.branch_id === "string" ? meta.branch_id : null);

    if (!callerRole || !["admin", "manager"].includes(callerRole)) {
      return jsonMsg(403, "Forbidden: admin or manager only", "authorization");
    }

    const body = await req.json();
    const rawId = body?.userId ?? body?.user_id;
    const userIdNorm = normUuid(
      rawId == null ? null : typeof rawId === "string" ? rawId : String(rawId),
    );
    if (!userIdNorm) {
      return jsonErr("validate_input", "userId required");
    }

    if (userIdNorm === normUuid(callerId)) {
      return jsonMsg(403, "Cannot delete your own account", "authorization");
    }

    const { data: targetRow, error: targetErr } = await supabaseAdmin
      .from("users")
      .select("id, role, branch_id")
      .eq("id", userIdNorm)
      .maybeSingle();

    if (targetErr) {
      return jsonErr("target_lookup", targetErr.message);
    }

    /** No public.users row — try auth-only (orphan account cleanup). */
    if (!targetRow) {
      const { data: authData, error: authGetErr } = await supabaseAdmin.auth.admin.getUserById(
        userIdNorm,
      );
      if (authGetErr || !authData?.user) {
        return jsonErr(
          "target_lookup",
          "User not found (no row in public.users and no auth account for this id).",
        );
      }
      const ar = roleFromAuthUser(authData.user);
      if (ar === "admin") {
        return jsonMsg(403, "Cannot delete admin accounts", "authorization");
      }
      if (callerRole === "manager") {
        if (ar !== "officer") {
          return jsonMsg(403, "Managers can only delete loan officers", "authorization");
        }
        const tBranch = branchFromAuthUser(authData.user);
        const cBranch = callerBranchId ? String(callerBranchId) : null;
        if (!cBranch || !tBranch || tBranch !== cBranch) {
          return jsonMsg(403, "Can only delete officers in your branch", "authorization");
        }
      }
      const blocked = await assertNoAssociatedData(supabaseAdmin, userIdNorm);
      if (blocked) return blocked;

      const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(userIdNorm);
      if (authDelErr) {
        return jsonErr("auth.admin_deleteUser", authDelErr.message);
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetRole = targetRow.role?.trim().toLowerCase() ?? "";
    if (targetRole === "admin") {
      return jsonMsg(403, "Cannot delete admin accounts", "authorization");
    }

    if (callerRole === "manager") {
      if (targetRole !== "officer") {
        return jsonMsg(403, "Managers can only delete loan officers", "authorization");
      }
      const tBranch = targetRow.branch_id ? String(targetRow.branch_id) : null;
      const cBranch = callerBranchId ? String(callerBranchId) : null;
      if (!cBranch || tBranch !== cBranch) {
        return jsonMsg(403, "Can only delete officers in your branch", "authorization");
      }
    }

    const blocked = await assertNoAssociatedData(supabaseAdmin, userIdNorm);
    if (blocked) return blocked;

    const { error: pubErr } = await supabaseAdmin.from("users").delete().eq("id", userIdNorm);
    if (pubErr) {
      return jsonErr(
        "public.users_delete",
        pubErr.message,
        "There may still be a foreign key referencing this user (see the Postgres error message for the constraint name).",
      );
    }

    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userIdNorm);
    if (authErr) {
      return jsonErr("auth.admin_deleteUser", authErr.message);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErr("unexpected", msg);
  }
});
