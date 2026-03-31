import * as React from 'react';

import { cn } from '@/lib/utils';

const TableVariantContext = React.createContext('default');

/** Excel-like grid: borders, zebra rows, compact padding */
const excelTableClass =
	'border-collapse border border-[#9ca3af] bg-[#fafafa] text-[13px] leading-snug tabular-nums text-neutral-900 dark:border-neutral-600 dark:bg-card dark:text-neutral-100 [&_th]:border [&_th]:border-[#a8a8a8] [&_th]:bg-[#e4e4e4] [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-neutral-900 dark:[&_th]:bg-neutral-800 dark:[&_th]:text-neutral-100 [&_td]:border [&_td]:border-[#c6c6c6] dark:[&_td]:border-neutral-600 [&_tbody_tr:nth-child(even)]:bg-[#f7f9fb] dark:[&_tbody_tr:nth-child(even)]:bg-neutral-900/40 [&_tbody_tr:hover]:bg-amber-50/70 dark:[&_tbody_tr:hover]:bg-amber-950/30';

const Table = React.forwardRef(({ className, variant = 'excel', ...props }, ref) => (
	<TableVariantContext.Provider value={variant}>
		<div className="relative w-full overflow-auto">
			<table
				ref={ref}
				className={cn('w-full caption-bottom text-sm', variant === 'excel' && excelTableClass, className)}
				{...props}
			/>
		</div>
	</TableVariantContext.Provider>
));
Table.displayName = 'Table';

const TableHeader = React.forwardRef(({ className, ...props }, ref) => (
	<thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef(({ className, ...props }, ref) => (
	<tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef(({ className, ...props }, ref) => (
	<tfoot ref={ref} className={cn('bg-primary font-medium text-primary-foreground', className)} {...props} />
));
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef(({ className, ...props }, ref) => {
	const variant = React.useContext(TableVariantContext);
	return (
		<tr
			ref={ref}
			className={cn(
				variant === 'excel'
					? 'border-0 transition-colors'
					: 'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
				className
			)}
			{...props}
		/>
	);
});
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef(({ className, ...props }, ref) => {
	const variant = React.useContext(TableVariantContext);
	return (
		<th
			ref={ref}
			className={cn(
				variant === 'excel'
					? 'h-9 px-2 py-2 text-left align-middle font-semibold text-neutral-900 dark:text-neutral-100 [&:has([role=checkbox])]:pr-0'
					: 'h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
				className
			)}
			{...props}
		/>
	);
});
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef(({ className, ...props }, ref) => {
	const variant = React.useContext(TableVariantContext);
	return (
		<td
			ref={ref}
			className={cn(
				variant === 'excel'
					? 'px-2 py-1.5 align-middle [&:has([role=checkbox])]:pr-0'
					: 'p-4 align-middle [&:has([role=checkbox])]:pr-0',
				className
			)}
			{...props}
		/>
	);
});
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef(({ className, ...props }, ref) => (
	<caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption, TableVariantContext };
