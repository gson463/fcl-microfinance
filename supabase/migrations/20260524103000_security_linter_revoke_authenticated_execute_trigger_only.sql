-- Supabase linter 0029_authenticated_security_definer_function_executable
--
-- SECURITY DEFINER trigger bodies are still required (RLS, cross-table reads) but callers
-- should never invoke these via PostgREST. For TRIGGER-returning trigger functions,
-- Postgres checks EXECUTE on the trigger function when the TRIGGER is attached, not when
-- each row change fires — so revoking EXECUTE from `authenticated` blocks /rpc spam while
-- leaving triggers unchanged.
--
-- Edge jobs using service_role retain EXECUTE (see 20260523180000_security_revoke_public_execute_drop_logos_list_policy).

REVOKE EXECUTE ON FUNCTION public.enforce_expense_field_wallet_nonnegative() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_loan_field_wallet_nonnegative() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.repayments_enforce_working_payment_date() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.repayments_normalize_for_field_wallet() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.trigger_officer_wallet_balance_recalc() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_sync_borrower_paid_up() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_system_config_application_fee_wallet() FROM authenticated;
