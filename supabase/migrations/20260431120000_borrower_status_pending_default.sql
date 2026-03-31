-- New borrowers default to pending; eligible is set by manager (app enforces; default aligns DB inserts)
ALTER TABLE public.borrowers ALTER COLUMN status SET DEFAULT 'pending';
