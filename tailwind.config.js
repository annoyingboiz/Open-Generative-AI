/** @type {import('tailwindcss').Config} */
// Colours, radii and shadows come from the tokens in app/globals.css, so the
// two themes change in one place. Redesign package 01 (docs/ux/handoff/01-studio).
const hsl = (name) => `hsl(var(--${name}) / <alpha-value>)`;

module.exports = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./packages/studio/src/**/*.{js,jsx}",
    ],
    theme: {
        extend: {
            colors: {
                border: hsl('border'),
                input: hsl('input'),
                ring: hsl('ring'),
                background: hsl('background'),
                foreground: hsl('foreground'),
                primary: { DEFAULT: hsl('primary'), foreground: hsl('primary-foreground'), hover: hsl('primary-hover') },
                secondary: { DEFAULT: hsl('secondary'), foreground: hsl('secondary-foreground') },
                card: { DEFAULT: hsl('card'), foreground: hsl('card-foreground') },
                popover: { DEFAULT: hsl('popover'), foreground: hsl('popover-foreground') },
                accent: { DEFAULT: hsl('accent'), foreground: hsl('accent-foreground') },
                muted: { DEFAULT: hsl('muted'), foreground: hsl('muted-foreground') },
                destructive: { DEFAULT: hsl('destructive'), foreground: hsl('destructive-foreground') },
                // The accent: selection, tags, the active group, running state and focus only.
                signal: hsl('signal'),
                success: hsl('success'),
                warning: hsl('warning'),
                subtle: hsl('subtle'),
                // Labels and buttons on top of a picture or video (dark in both themes).
                overlay: { DEFAULT: hsl('overlay'), foreground: hsl('overlay-foreground') },
                scrim: 'var(--scrim)',
            },
            borderRadius: {
                xs: 'var(--radius-xs)',
                sm: 'var(--radius-sm)',
                DEFAULT: 'var(--radius)',
                md: 'var(--radius)',
                lg: 'var(--radius)',
                slot: 'var(--radius-slot)',
                xl: 'var(--radius-lg)',
                '2xl': 'var(--radius-xl)',
                '3xl': '20px',
            },
            fontFamily: {
                sans: ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
            },
            // Type scale (section 3.2): body 14 px; 16 px is the prompt only; nothing
            // under 12 px except the 11 px caps overline.
            fontSize: {
                overline: ['11px', { lineHeight: '14px', letterSpacing: '0.08em', fontWeight: '600' }],
                xs: ['12px', { lineHeight: '16px' }],      // caption
                sm: ['13px', { lineHeight: '18px' }],      // meta
                base: ['14px', { lineHeight: '20px' }],    // body
                lg: ['16px', { lineHeight: '22px' }],      // panel title
                prompt: ['16px', { lineHeight: '24px' }],
                xl: ['20px', { lineHeight: '26px', letterSpacing: '-0.015em' }], // screen title
                '2xl': ['24px', { lineHeight: '30px', letterSpacing: '-0.015em' }],
                '3xl': ['28px', { lineHeight: '34px', letterSpacing: '-0.02em' }], // display
                '4xl': ['36px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
                '5xl': ['48px', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
            },
            boxShadow: {
                popover: 'var(--shadow-popover)',
                float: 'var(--shadow-float)',
                dialog: 'var(--shadow-dialog)',
            },
            transitionTimingFunction: {
                soft: 'cubic-bezier(.2, .8, .2, 1)',
            },
            transitionDuration: {
                state: '120ms',
                popover: '180ms',
                sheet: '260ms',
            },
        },
    },
    plugins: [require('tailwindcss-animate')],
}
