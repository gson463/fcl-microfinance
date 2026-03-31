-- Per-disbursement application fee (wallet cash-in; does not change loan principal). Officers read via system_config.

INSERT INTO public.system_config (key, value)
SELECT 'applicationFeePerDisbursement', '0'
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'applicationFeePerDisbursement');
