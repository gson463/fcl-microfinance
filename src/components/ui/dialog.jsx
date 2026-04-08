
import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = ({ ...props }) => (
  <DialogPrimitive.Portal {...props} />
);
DialogPortal.displayName = DialogPrimitive.Portal.displayName;

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/** Clicks/focus on portaled Popover, Select, Dropdown, etc. must not be treated as "outside" the Dialog. */
function isRadixFloatingLayerTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(
    target.closest('[data-radix-popper-content-wrapper]') ||
      target.closest('[data-radix-select-content]') ||
      target.closest('[data-radix-dropdown-menu-content]'),
  );
}

const DialogContent = React.forwardRef(({ className, children, onPointerDownOutside, onFocusOutside, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onPointerDownOutside={(event) => {
        const raw = event.detail?.originalEvent;
        const t = raw?.target ?? event.target;
        if (isRadixFloatingLayerTarget(t)) {
          event.preventDefault();
        }
        onPointerDownOutside?.(event);
      }}
      onFocusOutside={(event) => {
        const raw = event.detail?.originalEvent;
        const related = raw && 'relatedTarget' in raw ? raw.relatedTarget : null;
        const t =
          related instanceof Element ? related : raw?.target instanceof Element ? raw.target : event.target;
        if (isRadixFloatingLayerTarget(t)) {
          event.preventDefault();
        }
        onFocusOutside?.(event);
      }}
      className={cn(
        /* Mobile: top-anchored + max height so tall forms are not clipped by translate(-50%,-50%). Desktop: centered. */
        'fixed left-1/2 top-4 z-50 grid w-[calc(100vw-1rem)] max-w-lg -translate-x-1/2 translate-y-0 gap-4 border bg-background p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-lg duration-200',
        'max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'sm:top-1/2 sm:max-h-[min(90vh,900px)] sm:w-full sm:-translate-y-1/2 sm:rounded-lg sm:pb-6',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }) => (
  <div
    className={cn(
      'flex flex-col space-y-1.5 text-center sm:text-left',
      className
    )}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg font-semibold leading-none tracking-tight',
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
