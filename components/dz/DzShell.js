'use client';

// DZ: the app shell — header, navigation, studios and notifications.
// Replaces the upstream StandaloneShell (API-key handling, promo banners and
// tabs for services we do not use). Studios come from the `studio` package.

import { useState, useEffect, useCallback } from 'react';
import { ImageStudio, VideoStudio, DzCinemaStudio } from 'studio';
import { DZ_SESSION_PLACEHOLDER, dzFetchMe, dzFetchBalances, dzFormatBalances } from './session';
import ThemeToggle from '../ThemeToggle';

const ICONS = {
  image: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  cinema: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2.18" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" /><line x1="2" y1="7" x2="7" y2="7" /><line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="17" x2="22" y2="17" /><line x1="17" y1="7" x2="22" y2="7" />
    </svg>
  ),
  video: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  ),
};

export const DZ_TABS = [
  { id: 'cinema', label: 'Cinema' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
];
const TAB_IDS = new Set(DZ_TABS.map((t) => t.id));
const DEFAULT_TAB = 'cinema';
const labelOf = (tabId) => DZ_TABS.find((t) => t.id === tabId)?.label || tabId;
const tabFromPath = (path) => {
  const id = String(path || '').split('/').filter(Boolean)[1];
  return TAB_IDS.has(id) ? id : DEFAULT_TAB;
};

const NOTIFICATION_TTL = 12_000;
const MAX_NOTIFICATIONS = 3;

export default function DzShell() {
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(null);
  const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [running, setRunning] = useState({});
  const [dragging, setDragging] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState(null);

  // Session check (the gateway already required sign-in) and initial tab.
  useEffect(() => {
    setActiveTab(tabFromPath(window.location.pathname));
    try { setCollapsed(localStorage.getItem('dz_sidebar_collapsed') === '1'); } catch { /* storage is optional */ }
    dzFetchMe().then((u) => u && setUser(u)).catch((err) => console.error(err));
    const onPop = () => setActiveTab(tabFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Provider balances (admins only), refreshed every minute.
  const refreshBalance = useCallback(async () => {
    try { setBalance(dzFormatBalances(await dzFetchBalances())); } catch { /* shown as empty */ }
  }, []);
  useEffect(() => {
    if (!user) return undefined;
    refreshBalance();
    const timer = setInterval(refreshBalance, 60_000);
    return () => clearInterval(timer);
  }, [user, refreshBalance]);

  const openTab = useCallback((tabId) => {
    if (!TAB_IDS.has(tabId)) return;
    window.history.pushState(null, '', `/studio/${tabId}`);
    setActiveTab(tabId);
    setMobileOpen(false);
  }, []);

  const toggleSidebar = () => setCollapsed((prev) => {
    try { localStorage.setItem('dz_sidebar_collapsed', prev ? '0' : '1'); } catch { /* optional */ }
    return !prev;
  });

  // ── Notifications ─────────────────────────────────────────────────────
  const push = useCallback((n) => {
    const entry = { ...n, id: `${Date.now()}-${Math.random()}`, expiresAt: Date.now() + NOTIFICATION_TTL };
    setNotifications((prev) => [...prev, entry].slice(-MAX_NOTIFICATIONS));
  }, []);
  const dismiss = useCallback((id) => setNotifications((prev) => prev.filter((n) => n.id !== id)), []);
  useEffect(() => {
    if (!notifications.length) return undefined;
    const next = Math.min(...notifications.map((n) => n.expiresAt));
    const timer = setTimeout(() => setNotifications((prev) => prev.filter((n) => n.expiresAt > Date.now())), Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [notifications]);

  const callbacks = useCallback((tabId) => ({
    onGenerationStart: () => setRunning((prev) => ({ ...prev, [tabId]: (prev[tabId] || 0) + 1 })),
    onGenerationEnd: () => setRunning((prev) => {
      const next = { ...prev, [tabId]: (prev[tabId] || 1) - 1 };
      if (next[tabId] <= 0) delete next[tabId];
      return next;
    }),
    onGenerationComplete: (data) => { push({ type: 'success', tabId, url: data?.url || null }); refreshBalance(); },
    onGenerationError: (err) => {
      const message = typeof err === 'string' ? err : (err?.message || err?.error || 'Generation failed');
      push({ type: 'error', tabId, message: String(message) });
    },
  }), [push, refreshBalance]);

  // ── Drag and drop (Image and Video studios accept dropped files) ─────
  const onDragEnter = (e) => {
    e.preventDefault();
    if (Array.from(e.dataTransfer?.types || []).includes('Files')) setDragging(true);
  };
  const onDragLeave = (e) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) setDroppedFiles(files);
  };

  if (!user) return <div className="h-screen bg-[#030303]" />;

  const studioProps = { apiKey: DZ_SESSION_PLACEHOLDER, locale: 'en' };
  const isCollapsed = collapsed && !mobileOpen;
  const runningTabs = Object.keys(running);

  return (
    <div
      className="h-screen bg-[#030303] flex flex-col overflow-hidden text-white relative"
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="fixed inset-0 z-[100] bg-[#22d3ee]/10 backdrop-blur-sm border-2 border-dashed border-[#22d3ee]/50 flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl border border-white/10 bg-[#0d0d10] px-6 py-4 text-sm font-semibold text-white/80">Drop files to use them as references</div>
        </div>
      )}

      {/* Header */}
      <header className="flex-shrink-0 h-14 border-b border-white/[0.06] flex items-center justify-between px-4 bg-[#0a0a0b]/90 backdrop-blur-md z-50 gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setMobileOpen((v) => !v)} className="md:hidden p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70" aria-label="Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <button onClick={toggleSidebar} className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/5" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={collapsed ? 'rotate-180' : ''}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="M14 9l-3 3 3 3" /></svg>
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-[#22d3ee] rounded-lg flex items-center justify-center shadow-lg shadow-[#22d3ee]/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3" /></svg>
            </div>
            <span className="text-sm font-bold tracking-tight hidden sm:block">Director</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/5" title={balance ? 'Provider balances' : undefined}>
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs font-bold text-white/90">{balance || user.displayName}</span>
          </div>
          <a href="/dz/settings" className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-white/10 bg-white/5 text-[13px] font-bold text-white/80 hover:text-white hover:bg-white/10">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 7 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 1.17 14H1a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 2.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 7 4.6 1.65 1.65 0 0 0 8 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.36.15.67.4.88.72.21.32.33.7.32 1.08V11a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            <span className="hidden sm:inline">Settings</span>
          </a>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {mobileOpen && <div className="fixed inset-0 bg-black/70 z-40 md:hidden" onClick={() => setMobileOpen(false)} />}

        {/* Sidebar */}
        <aside className={`fixed top-14 bottom-0 left-0 md:static md:h-full z-30 bg-[#0a0a0b]/95 border-r border-white/[0.06] flex flex-col transition-all duration-300 flex-shrink-0 select-none
          ${mobileOpen ? 'translate-x-0 w-56 z-50' : '-translate-x-full md:translate-x-0'} ${collapsed ? 'md:w-16' : 'md:w-48'}`}>
          <nav aria-label="Studios" className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
            {DZ_TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <a
                  key={tab.id}
                  href={`/studio/${tab.id}`}
                  onClick={(e) => { if (e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openTab(tab.id); } }}
                  aria-current={active ? 'page' : undefined}
                  title={isCollapsed ? tab.label : undefined}
                  className={`relative flex items-center rounded-xl text-[13px] font-semibold transition-colors
                    ${isCollapsed ? 'h-11 w-11 justify-center mx-auto' : 'px-3 py-2.5 gap-3'}
                    ${active ? 'bg-[#22d3ee]/12 text-[#22d3ee] border border-[#22d3ee]/20' : 'text-white/60 hover:text-white hover:bg-white/[0.04] border border-transparent'}`}
                >
                  {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#22d3ee]" />}
                  <span className="flex-shrink-0">{ICONS[tab.id]}</span>
                  {!isCollapsed && <span className="truncate">{tab.label}</span>}
                  {running[tab.id] > 0 && <span className={`${isCollapsed ? 'absolute top-1.5 right-1.5' : 'ml-auto'} h-2 w-2 rounded-full bg-[#22d3ee] animate-pulse`} />}
                </a>
              );
            })}
          </nav>
        </aside>

        {/* Studios stay mounted, so running generations survive switching tabs */}
        <main className="flex-1 min-h-0 h-full relative overflow-hidden bg-[#030303]">
          <div className={activeTab === 'cinema' ? 'h-full w-full' : 'hidden'}>
            <DzCinemaStudio {...studioProps} {...callbacks('cinema')} />
          </div>
          <div className={activeTab === 'image' ? 'h-full w-full' : 'hidden'}>
            <ImageStudio {...studioProps} {...callbacks('image')} droppedFiles={activeTab === 'image' ? droppedFiles : null} onFilesHandled={() => setDroppedFiles(null)} />
          </div>
          <div className={activeTab === 'video' ? 'h-full w-full' : 'hidden'}>
            <VideoStudio {...studioProps} {...callbacks('video')} droppedFiles={activeTab === 'video' ? droppedFiles : null} onFilesHandled={() => setDroppedFiles(null)} />
          </div>
        </main>
      </div>

      {/* Notifications: dark cards, bottom-right */}
      {(runningTabs.length > 0 || notifications.length > 0) && (
        <div aria-live="polite" className="fixed bottom-5 right-5 z-[200] flex w-[320px] max-w-[calc(100vw-32px)] flex-col gap-2 pointer-events-none">
          {runningTabs.map((tabId) => (
            <div key={tabId} role="status" className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#121215]/95 backdrop-blur-md px-3.5 py-3 text-[13px] shadow-[0_12px_32px_rgba(0,0,0,0.55)]">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#22d3ee]/25 border-t-[#22d3ee]" />
              <span className="font-semibold text-white/90">{labelOf(tabId)}</span>
              <span className="text-white/45">generating{running[tabId] > 1 ? ` · ${running[tabId]}` : ''}…</span>
            </div>
          ))}
          {notifications.map((n) => (
            <div key={n.id} role={n.type === 'error' ? 'alert' : 'status'} className="dz-toast pointer-events-auto flex items-start gap-3 overflow-hidden rounded-xl border border-white/[0.08] bg-[#121215]/95 backdrop-blur-md p-2.5 pr-3 text-[13px] shadow-[0_12px_32px_rgba(0,0,0,0.55)]">
              <span className={`w-1 self-stretch rounded-full ${n.type === 'error' ? 'bg-red-400' : 'bg-[#22d3ee]'}`} />
              {n.type === 'success' && n.url && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(n.url) && (
                <img src={n.url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover border border-white/10" />
              )}
              <div className="min-w-0 flex-1 py-0.5">
                <p className="font-semibold text-white/90">
                  {labelOf(n.tabId)} <span className="font-normal text-white/45">{n.type === 'error' ? '· failed' : '· ready'}</span>
                </p>
                {n.type === 'error' && <p className="mt-0.5 line-clamp-2 text-[12px] text-red-300/90" title={n.message}>{n.message}</p>}
                {n.type === 'success' && n.tabId !== activeTab && (
                  <button type="button" onClick={() => { openTab(n.tabId); dismiss(n.id); }} className="mt-0.5 text-[12px] font-semibold text-[#22d3ee] hover:text-[#67e8f9]">Open</button>
                )}
              </div>
              <button type="button" onClick={() => dismiss(n.id)} className="mt-0.5 h-6 w-6 shrink-0 rounded-md text-white/35 hover:bg-white/10 hover:text-white" aria-label="Dismiss">✕</button>
            </div>
          ))}
        </div>
      )}
      <style>{`.dz-toast{animation:dzToastIn 260ms cubic-bezier(.16,1,.3,1)}@keyframes dzToastIn{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}`}</style>
    </div>
  );
}
