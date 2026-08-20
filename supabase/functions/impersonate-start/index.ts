import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { requireJwtUser } from "../_shared/authJwt.ts";

const SUPER_ADMIN_EMAIL = "admin@faharicredits.co.tz";

function json(status: number, body: Record<string, unknown>) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...corsHeaders, "Content-Type": "application/json" },
	});
}

Deno.serve(async (req: Request) => {
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: corsHeaders });
	}
	if (req.method !== "POST") {
		return json(405, { error: "Method not allowed" });
	}

	try {
		const supabaseAdmin = createClient(
			Deno.env.get("SUPABASE_URL") ?? "",
			Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
			{ auth: { autoRefreshToken: false, persistSession: false } },
		);

		const authHeader = req.headers.get("Authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			return json(401, { error: "Unauthorized" });
		}

		const authResult = await requireJwtUser(req, supabaseAdmin);
		if ("error" in authResult) {
			return authResult.error;
		}
		const jwtData = { user: authResult.user };

		const callerEmail = String(jwtData.user.email ?? "").trim().toLowerCase();
		if (callerEmail !== SUPER_ADMIN_EMAIL) {
			return json(403, { error: "Impersonation is limited to the designated admin account." });
		}

		const { data: callerRow, error: callerRowErr } = await supabaseAdmin
			.from("users")
			.select("role")
			.eq("id", jwtData.user.id)
			.maybeSingle();

		if (callerRowErr || callerRow?.role !== "admin") {
			return json(403, { error: "Caller must have an admin profile." });
		}

		let body: { user_id?: string };
		try {
			body = await req.json();
		} catch {
			body = {};
		}
		const targetId = typeof body?.user_id === "string" ? body.user_id.trim() : "";
		if (!targetId) {
			return json(400, { error: "user_id is required" });
		}
		if (targetId === jwtData.user.id) {
			return json(400, { error: "Cannot impersonate yourself" });
		}

		const { data: pubTarget, error: pubErr } = await supabaseAdmin
			.from("users")
			.select("id, full_name, email, role, is_active")
			.eq("id", targetId)
			.maybeSingle();

		if (pubErr || !pubTarget?.id) {
			return json(404, { error: "User not found in directory" });
		}
		if (pubTarget.is_active === false) {
			return json(400, { error: "Cannot impersonate an inactive user" });
		}

		const { data: targetAuth, error: targetAuthErr } = await supabaseAdmin.auth.admin.getUserById(targetId);
		if (targetAuthErr || !targetAuth.user?.email) {
			return json(404, { error: "Target auth user not found or has no email" });
		}

		const targetEmail = String(targetAuth.user.email).trim();

		const { data: linkOut, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
			type: "magiclink",
			email: targetEmail,
		});

		if (linkErr || !linkOut?.properties) {
			console.error("generateLink failed:", linkErr);
			return json(502, { error: linkErr?.message ?? "Could not create impersonation token" });
		}

		const props = linkOut.properties as Record<string, unknown>;
		const hashed_token =
			(typeof props.hashed_token === "string" && props.hashed_token) ||
			(typeof props.token_hash === "string" && props.token_hash) ||
			null;

		if (!hashed_token) {
			console.error("generateLink missing hashed_token", props);
			return json(502, { error: "Malformed auth link response" });
		}

		const { error: auditErr } = await supabaseAdmin.from("audit_logs").insert({
			user_id: jwtData.user.id,
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

		return json(200, {
			token_hash: hashed_token,
			email: targetEmail,
			target_user_id: targetId,
			target_full_name: pubTarget.full_name ?? "",
			target_role: pubTarget.role ?? "",
		});
	} catch (e) {
		console.error(e);
		return json(500, { error: e instanceof Error ? e.message : "Server error" });
	}
});
