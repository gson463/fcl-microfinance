-- Enable Supabase Realtime for dashboard live refresh (disbursements, repayments, loan updates).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'loans'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.loans;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'repayments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.repayments;
  END IF;
END $$;
