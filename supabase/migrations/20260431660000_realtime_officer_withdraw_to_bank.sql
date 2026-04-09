-- Broadcast withdraw-to-bank rows so admin Field wallet trace can subscribe for live updates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'officer_withdraw_to_bank'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.officer_withdraw_to_bank;
  END IF;
END $$;
