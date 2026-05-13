/** Edge / Deno — same idea as src/lib/formatApiError.js (PostgREST errors are plain objects, not Error). */
export function messageFromUnknown(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (err && typeof err === "object" && "message" in err) {
		const m = (err as { message?: unknown }).message;
		if (m != null) return typeof m === "string" ? m : String(m);
	}
	if (typeof err === "string") return err;
	try {
		return JSON.stringify(err);
	} catch {
		return String(err);
	}
}
