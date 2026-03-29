/** Client IP from Supabase / proxy headers (Edge Functions). */
export function getClientIp(req: Request): string | null {
  const h =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "";
  const first = h.split(",")[0]?.trim();
  return first || null;
}

/** Best-effort city/region/country from IP (ipapi.co). */
export async function geoLabelFromIp(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  try {
    const r = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      signal: AbortSignal.timeout(5000),
    });
    const j = await r.json() as Record<string, unknown>;
    if (j.error) return null;
    const city = j.city as string | undefined;
    const region = j.region as string | undefined;
    const country = j.country_name as string | undefined;
    const parts = [city, region, country].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  } catch {
    return null;
  }
}
