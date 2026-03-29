import React from 'react';
import { Palette } from 'lucide-react';
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
import { SIDEBAR_PRESET_IDS, sidebarPresets } from '@/lib/sidebarPresets';
import { cn } from '@/lib/utils';

export function SidebarPaletteMenu({ className, variant = 'outline', size = 'icon', align = 'end' }) {
	const { sidebarPreset, setSidebarPreset } = useTheme();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant={variant}
					size={size}
					className={cn('shrink-0', className)}
					aria-label="Sidebar color"
					title="Sidebar color"
				>
					<Palette className="h-4 w-4" strokeWidth={2} />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align={align} className="min-w-[13rem]">
				<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
					Sidebar color
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuRadioGroup value={sidebarPreset} onValueChange={setSidebarPreset}>
					{SIDEBAR_PRESET_IDS.map((id) => {
						const preset = sidebarPresets[id];
						return (
							<DropdownMenuRadioItem key={id} value={id} className="gap-2.5">
								<span
									className={cn(
										'h-3.5 w-3.5 shrink-0 rounded-full bg-gradient-to-br ring-1 ring-black/15 dark:ring-white/20',
										preset.swatch
									)}
									aria-hidden
								/>
								<span>{preset.label}</span>
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
