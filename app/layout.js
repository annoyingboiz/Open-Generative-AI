import './globals.css';
import { Inter } from "next/font/google";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
});

export const metadata = {
  title: 'Director',
  description: 'Private AI image and video studio.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Package 11: the browser tab icon (SVG, .ico fallback), iOS home screen icon, web app manifest.
            The ?v= changes when the files change, so no hard reload is needed. */}
        <link rel="icon" href="/favicon.ico?v=1" sizes="32x32" />
        <link rel="icon" href="/dz/brand/favicon.svg?v=1" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=1" />
        <link rel="manifest" href="/manifest.webmanifest?v=1" />
        <meta name="theme-color" content="#0C0C0D" />
        {/* DZ: model list from your providers; must load before the studio code. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/dz/catalog.js" />
        {/* Apply the saved theme before first paint to avoid a dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('theme')==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}" }} />
      </head>
      <body className={inter.variable}>{children}</body>
    </html>
  );
}
