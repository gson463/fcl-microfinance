import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';

const labels = {
	light: 'Light',
	dark: 'Dark',
	system: 'System',
};

export function ThemeToggle({ className, variant = 'outline', size = 'icon', align = 'end' }) {
	const { theme, setTheme, resolvedTheme } = useTheme();

	const TriggerIcon =
		theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant={variant}
					size={size}
					className={cn('shrink-0 gap-2', className)}
					aria-label="Theme"
					title="Appearance"
				>
					<TriggerIcon className="h-4 w-4" strokeWidth={2} />
					{size !== 'icon' && (
						<span className="text-sm font-medium">{labels[theme]}</span>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align={align} className="min-w-[11rem]">
				<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
					Appearance
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
					<DropdownMenuRadioItem value="light" className="gap-2">
						<Sun className="h-4 w-4" />
						Light
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="dark" className="gap-2">
						<Moon className="h-4 w-4" />
						Dark
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="system" className="gap-2">
						<Monitor className="h-4 w-4" />
						System
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
