/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: ['class'],
	content: [
		'./pages/**/*.{js,jsx}',
		'./components/**/*.{js,jsx}',
		'./app/**/*.{js,jsx}',
		'./src/**/*.{js,jsx}',
	],
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px',
			},
		},
		extend: {
			fontFamily: {
				sans: ['Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'],
				display: ['"Plus Jakarta Sans"', 'Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'],
			},
			boxShadow: {
				'gold-glow': '0 0 60px -12px rgba(212, 175, 55, 0.45)',
				'gold-glow-sm': '0 8px 32px -8px rgba(212, 175, 55, 0.35)',
				card: '0 25px 50px -12px rgba(0, 0, 0, 0.45)',
			},
			colors: {
				brand: {
					gold: '#D4AF37',
					'gold-deep': '#B8860B',
					'gold-muted': '#C9A961',
					/** Login / CTA — mustard gold (reference UI) */
					'gold-cta': '#b8923a',
					'gold-cta-hover': '#c9a040',
					/** Dark shell (GitHub-style) */
					'login-bg': '#0d1117',
					'login-card': '#161b22',
					blue: '#00AEEF',
					'blue-deep': '#0054A6',
					sidebar: '#0b0f14',
					'sidebar-elevated': '#121a24',
				},
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))',
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))',
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))',
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))',
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))',
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))',
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))',
				},
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)',
			},
			keyframes: {
				'accordion-down': {
					from: { height: 0 },
					to: { height: 'var(--radix-accordion-content-height)' },
				},
				'accordion-up': {
					from: { height: 'var(--radix-accordion-content-height)' },
					to: { height: 0 },
				},
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
			},
		},
	},
	plugins: [require('tailwindcss-animate')],
};