import './globals.css';
import { Inter } from "next/font/google";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
