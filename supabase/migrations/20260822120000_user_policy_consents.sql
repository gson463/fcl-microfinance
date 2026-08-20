-- Security policy consent tracking (one row per user per policy version).

CREATE TABLE IF NOT EXISTS public.user_policy_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  policy_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  locale text,
  ip_address text,
  user_agent text,
  UNIQUE (user_id, policy_version)
);

CREATE INDEX IF NOT EXISTS user_policy_consents_user_id_idx
  ON public.user_policy_consents (user_id);

ALTER TABLE public.user_policy_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_policy_consents_admin_select ON public.user_policy_consents;
CREATE POLICY user_policy_consents_admin_select ON public.user_policy_consents
  FOR SELECT TO authenticated
  USING (public.auth_is_admin());

REVOKE ALL ON public.user_policy_consents FROM PUBLIC;
GRANT SELECT ON public.user_policy_consents TO authenticated;

CREATE OR REPLACE FUNCTION public.user_has_policy_consent(p_policy_version text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_policy_consents
    WHERE user_id = auth.uid()
      AND policy_version = trim(p_policy_version)
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_has_policy_consent(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_user_policy_consent(
  p_policy_version text,
  p_locale text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_ip_address text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.user_policy_consents (
    user_id,
    policy_version,
    locale,
    user_agent,
    ip_address
  )
  VALUES (
    v_uid,
    trim(p_policy_version),
    NULLIF(trim(p_locale), ''),
    NULLIF(trim(p_user_agent), ''),
    NULLIF(trim(p_ip_address), '')
  )
  ON CONFLICT (user_id, policy_version) DO UPDATE SET
    accepted_at = now(),
    locale = EXCLUDED.locale,
    user_agent = EXCLUDED.user_agent,
    ip_address = EXCLUDED.ip_address
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_user_policy_consent(text, text, text, text) TO authenticated;

-- Default security consent copy (general safety language — no location/GPS wording).

INSERT INTO public.system_config (key, value)
VALUES
  ('privacyPolicyVersion', '1'),
  ('securityConsentTitleSw', 'Masharti ya Usalama wa Mfumo'),
  ('securityConsentTitleEn', 'System Security Terms'),
  (
    'securityConsentSummarySw',
    'Kwa usalama wako na wa shirika, mfumo unatumia taarifa za akaunti, kifaa, na shughuli za uendeshaji ili kuweka mazingira salama, kuzuia matumizi yasiyo idhiniwa, na kuwezesha uwajibikaji wa kazi.'
  ),
  (
    'securityConsentSummaryEn',
    'For your safety and the organisation''s, the system uses account, device, and operational activity information to maintain a secure environment, prevent unauthorised use, and support accountability.'
  ),
  (
    'securityConsentBodySw',
    E'Masharti ya Usalama wa Mfumo\n\n1. Kusudi\nMfumo huu unatumika na wafanyakazi wa shirika kwa uendeshaji wa mikopo na shughuli zinazohusiana. Kwa usalama wako na wa shirika, tunakusanya na kutumia taarifa za uendeshaji ili kuhakikisha matumizi salama na yenye uwajibikaji.\n\n2. Taarifa tunazotumia\n• Taarifa za akaunti yako (mf. barua pepe, jina)\n• Taarifa za kifaa na kivinjari unachotumia kuingia\n• Rekodi za shughuli zako ndani ya mfumo\n• Taarifa za uthibitisho wa session ili kuhakikisha ni wewe unatumia akaunti yako\n\n3. Jinsi tunavyowafanya salama\n• Tunathibitisha kila session ili kuzuia matumizi yasiyo halali\n• Tunahifadhi rekodi za shughuli kwa ukaguzi wa ndani na uwajibikaji\n• Tunatumia hatua za kiufundi kulinda data dhidi ya ufikiaji usioruhusiwa\n\n4. Uhifadhi\nBaadhi ya taarifa zinaweza kuhifadhiwa kwa muda unaohitajika kwa madhumuni ya usalama, ukaguzi, na ubora wa huduma.\n\n5. Haki zako\nUnaweza kuwasiliana na msimamizi wa mfumo kwa maswali kuhusu matumizi ya data. Taarifa zako haziuzwi kwa wahusika wa nje.\n\n6. Kukubali\nKwa kubali, unathibitisha kuwa unaelewa na unakubali matumizi haya ya data kwa madhumuni ya ulinzi na uendeshaji salama wa mfumo. Ukikataa, hutaweza kuendelea kutumia mfumo.'
  ),
  (
    'securityConsentBodyEn',
    E'System Security Terms\n\n1. Purpose\nThis system is used by authorised staff for loan operations and related work. For your safety and the organisation''s, we collect and use operational information to ensure secure, accountable use.\n\n2. Information we use\n• Your account details (e.g. email, name)\n• Device and browser information used to sign in\n• Records of your activity within the system\n• Session verification data to confirm you are using your account\n\n3. How we keep you safe\n• We verify each session to prevent unauthorised access\n• We retain activity records for internal review and accountability\n• We apply technical safeguards to protect data from unauthorised access\n\n4. Retention\nSome information may be retained for as long as needed for security, audit, and service quality purposes.\n\n5. Your rights\nYou may contact your system administrator with questions about data use. Your information is not sold to third parties.\n\n6. Acceptance\nBy accepting, you confirm that you understand and agree to this use of data for protection and safe operation of the system. If you decline, you cannot continue using the system.'
  )
ON CONFLICT (key) DO NOTHING;
