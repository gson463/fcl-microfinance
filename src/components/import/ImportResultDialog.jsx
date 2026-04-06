import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Shows bulk import summary: counts + optional detail lines (scrollable).
 */
export function ImportResultDialog({ open, onOpenChange, title = 'Import report', summary, details }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {summary && <DialogDescription className="text-left text-base text-foreground">{summary}</DialogDescription>}
        </DialogHeader>
        {details ? (
          <pre className="max-h-[50vh] overflow-y-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words">
            {details}
          </pre>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
