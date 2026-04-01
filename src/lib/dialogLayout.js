import { cn } from '@/lib/utils';

const wideDialogShell =
  'flex max-h-[min(92dvh,900px)] w-[calc(100vw-1rem)] flex-col overflow-hidden p-4 sm:p-6';

/** Wide schedule / table dialogs: fixed header, scrollable body (pairs with base Dialog). */
export const SCHEDULE_DIALOG_CONTENT = cn(wideDialogShell, 'max-w-5xl gap-3');

export const SCHEDULE_DIALOG_SCROLL =
  'min-h-0 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]';

/** Tall two-column loan edit form */
export const LOAN_EDIT_WIDE_CONTENT = cn(wideDialogShell, 'max-w-4xl gap-0');
