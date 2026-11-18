'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'theme';

function readStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

// Dark is the default; light is data-theme="light" on <html> (set before first paint in layout.js).
export function useTheme() {
  const [theme, setThemeState] = useState('dark');
  useEffect(() => { setThemeState(readStoredTheme()); }, []);
  const setTheme = useCallback((next) => {
    setThemeState(next);
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage is optional */ }
  }, []);
  return [theme, setTheme];
}

export default function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  return (
    <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={label} title={label}
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground">
      {theme === 'light' ? '☾' : '☀'}
    </button>
  );
}
