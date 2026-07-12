import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export function bearerJwt(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.replace("Bearer ", "").trim();
  return jwt || null;
}

/** Validate JWT and return auth user via service-role client. */
export async function requireJwtUser(
  req: Request,
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<{ user: User } | { error: Response }> {
  const jwt = bearerJwt(req);
  if (!jwt) {
    return {
      error: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  const { data, error } = await supabaseAdmin.auth.getUser(jwt);
  if (error || !data.user) {
    return {
      error: new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  return { user: data.user };
}
