import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "./cors.ts";

export function bearerJwt(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.replace("Bearer ", "").trim();
  return jwt || null;
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Validate caller JWT. Uses anon client + Authorization header first (reliable on Edge),
 * then falls back to service-role auth.getUser(jwt).
 */
export async function requireJwtUser(
  req: Request,
  supabaseAdmin: SupabaseClient,
): Promise<{ user: User } | { error: Response }> {
  const jwt = bearerJwt(req);
  if (!jwt) {
    return { error: unauthorized("Unauthorized") };
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (anonKey && url) {
    const supabaseUser = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (!userErr && userData.user) {
      return { user: userData.user };
    }
  }

  const { data, error } = await supabaseAdmin.auth.getUser(jwt);
  if (error || !data.user) {
    return { error: unauthorized("Invalid or expired session") };
  }
  return { user: data.user };
}
