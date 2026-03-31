================================================================================
REMAINING STEPS (summary)
================================================================================

1) DATABASE (if not already applied)
   - Open: supabase/ALL_MIGRATIONS_ONE_FILE.sql
   - Supabase Dashboard → SQL Editor → paste all → Run
   - (Or run migrations 1, 2, 3 separately if you already applied part of the schema.)

2) EDGE FUNCTIONS (not deployed via SQL)
   - Deploy with CLI from a machine logged into an account that owns the project:
       supabase login
       supabase link --project-ref <REF from .env URL> -p '<database password>'
       npm run supabase:functions
   - If link says "access denied": use the project owner's email with supabase login.

3) AUTH URL
   - Authentication → URL Configuration → Site URL + Redirect URLs for your app.

4) FIRST ADMIN
   - Admin signup or create-admin-user after (2).

================================================================================
NOTE: If the CLI could not link a project due to account permissions, that is
not only a password issue — use an account with access to the project.
================================================================================
