import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { validatePasswordStrength } from "../_shared/passwordPolicy.ts";

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
    const setupSecret = Deno.env.get("ADMIN_SETUP_SECRET");
    if (!setupSecret || setupSecret.trim() === "") {
      return new Response(
        JSON.stringify({
          error: "Admin signup is disabled. Use scripts/create-admin-user.mjs or set ADMIN_SETUP_SECRET.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const body = await req.json();
    const { email, password, fullName, setup_secret: setupSecretBody } = body;
    if (!email || !password || !fullName) {
      return new Response(JSON.stringify({ error: "email, password, fullName required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const provided = typeof setupSecretBody === "string" ? setupSecretBody : "";
    if (provided !== setupSecret) {
      return new Response(JSON.stringify({ error: "Invalid setup secret" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pwdCheck = validatePasswordStrength(password);
    if (!pwdCheck.ok) {
      return new Response(JSON.stringify({ error: pwdCheck.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          role: "admin",
          branch_id: null,
        },
      });
    if (authError) throw authError;
    if (!authData.user) throw new Error("No user returned");

    const { error: insertError } = await supabaseAdmin.from("users").insert({
      id: authData.user.id,
      full_name: fullName,
      email,
      role: "admin",
      branch_id: null,
    });
    if (insertError) throw insertError;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
