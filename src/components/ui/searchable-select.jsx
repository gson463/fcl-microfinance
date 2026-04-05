import React, { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * Searchable dropdown: type to filter options, then click to select.
 * Optional "all" row when allValue + allLabel are provided.
 */
export function SearchableSelect({
  value,
  onValueChange,
  options = [],
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches.',
  allLabel,
  allValue,
  disabled = false,
  className,
  triggerClassName,
  id,
}) {
  const [open, setOpen] = useState(false);

  const normalizedValue = value === undefined || value === null ? '' : value;
  const selected = options.find((o) => o.value === value || o.value === normalizedValue);
  const hasAllRow = allLabel != null && allValue !== undefined && allValue !== null;
  const isAll =
    hasAllRow &&
    (allValue === '' ? normalizedValue === '' : normalizedValue === allValue);
  const displayLabel = isAll ? allLabel : selected?.label ?? placeholder;

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('justify-between font-normal', triggerClassName, className)}
        >
          <span className="truncate text-left">{displayLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[200] w-[var(--radix-popover-trigger-width)] min-w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {hasAllRow && (
                <CommandItem
                  value={`__all__-${String(allValue)}`}
                  keywords={[allLabel, 'all', 'any']}
                  onSelect={() => {
                    onValueChange(allValue);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4 shrink-0', isAll ? 'opacity-100' : 'opacity-0')} />
                  {allLabel}
                </CommandItem>
              )}
              {options.map((opt) => (
                <CommandItem
                  key={String(opt.value)}
                  value={String(opt.value)}
                  keywords={[opt.label, String(opt.value)]}
                  onSelect={() => {
                    onValueChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4 shrink-0',
                      normalizedValue === opt.value || value === opt.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="truncate">{opt.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
