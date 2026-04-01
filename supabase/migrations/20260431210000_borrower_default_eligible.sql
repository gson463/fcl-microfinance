-- New registrations are eligible immediately (no manager approval step for borrower status)
ALTER TABLE public.borrowers ALTER COLUMN status SET DEFAULT 'eligible';
