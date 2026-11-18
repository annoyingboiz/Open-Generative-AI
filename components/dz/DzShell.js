'use client';

// DZ: the app shell — header, navigation, studios and notifications.
// Replaces the upstream StandaloneShell (API-key handling, promo banners and
// tabs for services we do not use). Studios come from the `studio` package.

import { useState, useEffect, useCallback, useRef } from 'react';
import { DzCinemaStudio, DzCreateStudio, DzDirector, DZ_SEND_EVENT, DzUpscaleStudio, DzUpscalePanel, DzLibrary, dzUpscaleSpec, dzIsOwnImage, SidePanel, Button,
  DzChatPanel, dzGetStudioState, DZ_INSERT_EVENT,
  DzProjectsPage, DzElementsPage, ToElementDialog, ProjectSwitcher, FolderTree, NewProjectDialog, NameDialog, MoveDialog, dzProjectsApi, dzSetContext } from 'studio';
import { DZ_SESSION_PLACEHOLDER, dzFetchMe, dzFetchBalances, dzFormatBalances } from './session';
import ThemeToggle from '../ThemeToggle';

const ICONS = {
  create: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" /><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
    </svg>
  ),
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
  library: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  elements: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
  ),
  projects: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
  ),
  director: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M4 11l-.6-3.2a1 1 0 0 1 .8-1.2l13.8-2.5a1 1 0 0 1 1.2.8L19.6 8 4 11z" /><path d="M8.5 6.2l2.4 3.6M13.5 5.3l2.4 3.6" />
    </svg>
  ),
  upscale: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  ),
  liked: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" /></svg>
  ),
  trash: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>
  ),
};

// Tools make things (grid of the current place + panel); the rest shows it.
export const DZ_TABS = [
  { id: 'create', label: 'Create', tool: true },
  // Quick single-purpose studios on the same adaptive engine as Create.
  { id: 'image', label: 'Image', tool: true },
  { id: 'video', label: 'Video', tool: true },
  { id: 'upscale', label: 'Upscale', tool: true },
  // AI Director: scene → shots → start frames → videos (storyboards).
  { id: 'director', label: 'Director', tool: true },
  // The old Cinema stays for now, in the Library only.
  { id: 'cinema', label: 'Cinema (old)', tool: true, libraryOnly: true },
  { id: 'library', label: 'All work' },
  { id: 'liked', label: 'Liked' },
  { id: 'elements', label: 'Elements' },
  { id: 'trash', label: 'Trash' },
  { id: 'projects', label: 'Projects', projectLabel: 'Settings' },
];
const TAB_IDS = new Set(DZ_TABS.map((t) => t.id));
// Tabs whose prompt the side chat can write into.
const INSERT_TABS = new Set(['create', 'image', 'video', 'director']);
const DEFAULT_TAB = 'create';
const labelOf = (tabId) => DZ_TABS.find((t) => t.id === tabId)?.label || tabId;
const WORK_TABS = { library: 'all', liked: 'liked', trash: 'trash' };
// Folder names from the top down to `id`.
const pathOf = (folders, id) => {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = [];
  for (let f = byId.get(id), n = 0; f && n < 10; f = byId.get(f.parent_id), n += 1) out.unshift(f.name);
  return out;
};
// /studio/<tab> — Library (personal);  /p/<project slug>/<tab> — inside a project.
const parsePath = (path) => {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts[0] === 'p' && parts[1]) return { slug: decodeURIComponent(parts[1]), tab: TAB_IDS.has(parts[2]) ? parts[2] : DEFAULT_TAB };
  return { slug: null, tab: TAB_IDS.has(parts[1]) ? parts[1] : DEFAULT_TAB };
};
const tabFromPath = (path) => parsePath(path).tab;
const LIBRARY_ONLY = new Set(DZ_TABS.filter((t) => t.libraryOnly).map((t) => t.id));
// A Library-only tool has no place in a project: there it is Create.
const tabIn = (project, tab) => (project && LIBRARY_ONLY.has(tab) ? DEFAULT_TAB : tab);
const pathFor = (project, tab) => (project ? `/p/${encodeURIComponent(project.slug)}/${tab}` : `/studio/${tab}`);
const folderKey = (projectId) => `dz_folder_${projectId}`;

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
  // Upscale from anywhere: a side drawer next to the work, plus a right-click menu.
  const [upscaleDrawer, setUpscaleDrawer] = useState(null); // { url, result }
  const [upscaleTabPick, setUpscaleTabPick] = useState(null); // { url } — a new object each time
  const [chatOpen, setChatOpen] = useState(false); // side chat with assistants
  const [imageMenu, setImageMenu] = useState(null); // { x, y, url }
  // Projects: the list, the open one (with its folders) and the folder for new work.
  const [projects, setProjects] = useState([]);
  const [colors, setColors] = useState([]);
  const [project, setProject] = useState(null); // { id, slug, name, color, role, archived }
  const [folders, setFolders] = useState([]);
  const [folder, setFolder] = useState(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [folderDialog, setFolderDialog] = useState(null); // { mode: 'new', parent } | { mode: 'rename', folder }
  const [moveItem, setMoveItem] = useState(null);
  const [toElement, setToElement] = useState(null); // chosen results → an element
  // Only the latest project switch counts; until the first one resolves the studios wait.
  const navSeq = useRef(0);
  const [switching, setSwitching] = useState(true);

  // Session check (the gateway already required sign-in) and initial tab.
  useEffect(() => {
    setActiveTab(tabFromPath(window.location.pathname));
    try { setCollapsed(localStorage.getItem('dz_sidebar_collapsed') === '1'); } catch { /* storage is optional */ }
    dzFetchMe().then((u) => u && setUser(u)).catch((err) => console.error(err));
    const onPop = () => { setActiveTab(tabFromPath(window.location.pathname)); loadProjectFromPath(); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Projects ──────────────────────────────────────────────────────────
  const reloadProjects = useCallback(() => dzProjectsApi.list().then((r) => { setProjects(r.projects || []); setColors(r.colors || []); }).catch(() => {}), []);
  const applyProject = useCallback((details) => {
    if (!details) { setProject(null); setFolders([]); setFolder(null); return; }
    const p = details.project;
    setProject(p);
    setFolders(details.folders || []);
    let f = null;
    try { f = localStorage.getItem(folderKey(p.id)); } catch { /* optional */ }
    setFolder((details.folders || []).some((x) => x.id === f) ? f : null);
  }, []);
  const loadProjectFromPath = useCallback(async () => {
    const seq = ++navSeq.current;
    const { slug, tab } = parsePath(window.location.pathname);
    if (!slug) { applyProject(null); setSwitching(false); return; }
    setSwitching(true);
    try {
      const details = await dzProjectsApi.details(slug);
      if (seq !== navSeq.current) return;
      applyProject(details);
      if (LIBRARY_ONLY.has(tab)) { setActiveTab(DEFAULT_TAB); window.history.replaceState(null, '', pathFor(details.project, DEFAULT_TAB)); }
      dzProjectsApi.touch(details.project.id).catch(() => {});
    } catch {
      if (seq !== navSeq.current) return;
      applyProject(null);
      window.history.replaceState(null, '', pathFor(null, tab));
      push({ type: 'error', tabId: tab, message: 'That project was not found, or you are not in it. Back in your Library.' });
    }
    setSwitching(false);
  }, [applyProject]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!user) return;
    reloadProjects();
    loadProjectFromPath();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  // Everyone reads where new work goes from here (uploads, generations, history).
  useEffect(() => { dzSetContext({ project, folder, folderPath: pathOf(folders, folder), pending: switching }); }, [project, folder, folders, switching]);
  const pickFolder = (id) => {
    setFolder(id);
    try { if (project) { if (id) localStorage.setItem(folderKey(project.id), id); else localStorage.removeItem(folderKey(project.id)); } } catch { /* optional */ }
  };
  const openProject = async (p, wanted = activeTab) => {
    const seq = ++navSeq.current;
    const tab = tabIn(p, wanted);
    setActiveTab(tab);
    if (!p) {
      applyProject(null);
      setSwitching(false);
      window.history.pushState(null, '', pathFor(null, tab));
      return;
    }
    setSwitching(true);
    try {
      const details = await dzProjectsApi.details(p.id);
      if (seq !== navSeq.current) return;
      applyProject(details);
      window.history.pushState(null, '', pathFor(details.project, tab));
      dzProjectsApi.touch(details.project.id).then(reloadProjects).catch(() => {});
    } catch (e) {
      if (seq !== navSeq.current) return;
      push({ type: 'error', tabId: tab, message: e.message });
    }
    setSwitching(false);
  };
  const refreshProject = async () => {
    reloadProjects();
    if (!project) return;
    try {
      const details = await dzProjectsApi.details(project.id);
      setProject(details.project);
      setFolders(details.folders || []);
      if (folder && !(details.folders || []).some((x) => x.id === folder)) pickFolder(null);
      // A rename can change nothing in the slug; the URL keeps working.
    } catch { openProject(null); }
  };
  useEffect(() => {
    const onMove = (e) => { if (e.detail?.id || e.detail?.items?.length) setMoveItem(e.detail); };
    window.addEventListener('dz:move', onMove);
    return () => window.removeEventListener('dz:move', onMove);
  }, []);
  useEffect(() => {
    const onTo = (e) => { if (e.detail?.items?.length) setToElement(e.detail.items); };
    window.addEventListener('dz:to-element', onTo);
    return () => window.removeEventListener('dz:to-element', onTo);
  }, []);
  // Messages from anywhere (Move / Copy / Trash on many items, …).
  useEffect(() => {
    const onNotify = (e) => { if (e.detail?.message) push({ type: e.detail.type === 'error' ? 'error' : 'notice', title: e.detail.title, message: e.detail.message }); };
    window.addEventListener('dz:notify', onNotify);
    return () => window.removeEventListener('dz:notify', onNotify);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Folders: new / rename / delete from the sidebar tree.
  const reloadFolders = async () => {
    if (!project) return;
    try { const d = await dzProjectsApi.details(project.id); setFolders(d.folders || []); return d.folders || []; } catch { return null; }
  };
  const deleteFolder = async (f) => {
    if (!window.confirm(`Delete the folder “${f.name}”? Its work and folders move one level up.`)) return;
    try {
      await dzProjectsApi.deleteFolder(f.id);
      const list = await reloadFolders();
      if (list && folder && !list.some((x) => x.id === folder)) pickFolder(f.parent_id && list.some((x) => x.id === f.parent_id) ? f.parent_id : null);
      window.dispatchEvent(new CustomEvent('dz:history', { detail: { status: 'changed' } }));
    } catch (e) { push({ type: 'error', title: 'Folder', message: e.message }); }
  };
  // Cards dropped on a folder or a project: move them there (the author's own).
  const dropItems = async (ids, projectId, folderId) => {
    try {
      const r = await dzProjectsApi.batch('move', ids, projectId, folderId);
      const done = r.done?.length || 0;
      const failed = r.failed?.length || 0;
      push(failed
        ? { type: done ? 'notice' : 'error', title: 'Move', message: `Moved ${done} of ${done + failed}. ${r.failed[0]?.error || ''} Use Copy to… for work by others.` }
        : { type: 'notice', title: 'Moved', message: `Moved ${done} item${done === 1 ? '' : 's'}.` });
      if (done) window.dispatchEvent(new CustomEvent('dz:moved'));
    } catch (e) { push({ type: 'error', title: 'Move', message: e.message }); }
  };

  useEffect(() => {
    const onUpscale = (e) => { if (e.detail?.url) { setImageMenu(null); setChatOpen(false); setUpscaleDrawer({ url: e.detail.url, result: null }); } };
    // Videos open straight in the Upscale tab (big preview, before/after).
    const onUpscaleVideo = (e) => { if (e.detail?.url) { setImageMenu(null); setUpscaleDrawer(null); setUpscaleTabPick({ url: e.detail.url, kind: 'video' }); openTabRef.current?.('upscale'); } };
    window.addEventListener('dz:upscale-video', onUpscaleVideo);
    const closeMenu = () => setImageMenu(null);
    window.addEventListener('dz:upscale', onUpscale);
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('dz:upscale', onUpscale);
      window.removeEventListener('dz:upscale-video', onUpscaleVideo);
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
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

  // Provider changes waiting for the admin (Settings → Provider changes).
  const [changes, setChanges] = useState(null);
  useEffect(() => {
    if (user?.role !== 'admin') return undefined;
    const load = () => fetch('/dz/api/changes/summary', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).then(setChanges).catch(() => {});
    load();
    const timer = setInterval(load, 600_000);
    return () => clearInterval(timer);
  }, [user?.role]);

  const openTab = useCallback((tabId) => {
    if (!TAB_IDS.has(tabId)) return;
    window.history.pushState(null, '', pathFor(project, tabId));
    setActiveTab(tabId);
    setMobileOpen(false);
  }, [project]);
  const openTabRef = useRef(openTab);
  openTabRef.current = openTab;

  // Animate in the Image tab → open the Video tab (it picks the picture up itself).
  useEffect(() => {
    const onSend = (e) => { if (e.detail?.to === 'video') openTab('video'); };
    const onUse = () => openTab('create');
    window.addEventListener(DZ_SEND_EVENT, onSend);
    window.addEventListener('dz:use-element', onUse);
    return () => { window.removeEventListener(DZ_SEND_EVENT, onSend); window.removeEventListener('dz:use-element', onUse); };
  }, [openTab]);

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

  // Right-click on any of our images: Upscale, open in the Upscale tab, download.
  const onContextMenu = (e) => {
    const img = e.target?.closest?.('img');
    // A grid shows a small preview (?w=…); actions work on the original file.
    const url = (img?.getAttribute('src') || '').replace(/([?&])w=\d+(&|$)/, (m, a, b) => (b ? a : '')).replace(/[?&]$/, '');
    if (!img || !dzIsOwnImage(url)) return;
    e.preventDefault();
    setImageMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 140), url });
  };
  const downloadUrl = async (url) => {
    try {
      const blob = await (await fetch(url)).blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = url.split('/').pop().split('?')[0] || 'image';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch { window.open(url, '_blank'); }
  };
  const openInUpscaleTab = (url) => {
    setUpscaleTabPick({ url });
    setUpscaleDrawer(null);
    openTab('upscale');
  };

  // Splash while the session loads (instead of a black screen).
  // Splash until the session and the project in the URL are known (nothing can go to the wrong place).
  if (!user || (switching && !project && parsePath(typeof window !== 'undefined' ? window.location.pathname : '').slug)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/25">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3" /></svg>
        </div>
        <span className="text-lg font-semibold text-foreground/80">Director</span>
      </div>
    );
  }

  const studioProps = { apiKey: DZ_SESSION_PLACEHOLDER, locale: 'en' };
  const navLink = (tab) => {
    const active = activeTab === tab.id;
    const label = project && tab.projectLabel ? tab.projectLabel : tab.label;
    const icon = project && tab.id === 'projects' ? ICONS.settings : ICONS[tab.id];
    return (
      <a
        key={tab.id}
        href={pathFor(project, tab.id)}
        onClick={(e) => { if (e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openTab(tab.id); } }}
        aria-current={active ? 'page' : undefined}
        title={isCollapsed ? label : undefined}
        className={`relative flex items-center rounded-xl text-base font-semibold transition-colors
          ${isCollapsed ? 'h-11 w-11 justify-center mx-auto' : 'px-3 py-2 gap-3'}
          ${active ? 'bg-primary/15 text-primary border border-primary/25' : 'text-muted-foreground hover:text-foreground hover:bg-accent/60 border border-transparent'}`}
      >
        {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#22d3ee]" />}
        <span className="flex-shrink-0">{icon}</span>
        {!isCollapsed && <span className="truncate">{label}</span>}
        {running[tab.id] > 0 && <span className={`${isCollapsed ? 'absolute top-1.5 right-1.5' : 'ml-auto'} h-2 w-2 rounded-full bg-[#22d3ee] animate-pulse`} />}
      </a>
    );
  };
  // Notifications move left of a right-hand panel instead of covering its button.
  const rightPanelOpen = Boolean(upscaleDrawer) || activeTab === 'upscale';
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
          <div className="rounded-2xl border border-border bg-card px-6 py-4 text-lg font-semibold text-foreground">Drop files to use them as references</div>
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
            <span className="text-lg font-bold tracking-tight hidden lg:block">Director</span>
          </div>
          {/* Where you are: Library or a project (and the folder new work goes to) */}
          <div className="flex min-w-0 items-center gap-1">
            <ProjectSwitcher ctx={{ project, folder }} projects={projects} onOpen={openProject} onNew={() => setNewProjectOpen(true)} onAll={() => openProject(null, 'projects')} />
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => { setUpscaleDrawer(null); setChatOpen((v) => !v); }} aria-pressed={chatOpen} title="Chat with assistants"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-base font-semibold ${chatOpen ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-foreground/90 hover:bg-accent'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span className="hidden sm:inline">Chat</span>
          </button>
          <ThemeToggle />
          {balance ? (
            <div className="hidden min-w-0 items-center gap-1.5 xl:flex" aria-label="Provider balances">
              {balance.map((b) => (
                <span key={b.id} title={b.hint} className={`flex items-center gap-2 rounded-full border px-3 py-1 text-base ${b.low ? 'border-amber-400/40 text-amber-300' : 'border-border text-foreground/90'}`}>
                  <span className="text-muted-foreground">{b.name}</span>
                  <span className="font-semibold tabular-nums">{b.text}</span>
                </span>
              ))}
            </div>
          ) : null}
          <span className="flex min-w-0 max-w-[180px] items-center gap-2 rounded-full border border-border px-3 py-1 text-base text-foreground/90" title={balance ? balance.map((b) => `${b.name} ${b.text}`).join(' · ') : user.displayName}>
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
            <span className="truncate">{user.displayName}</span>
          </span>
          <a href={changes?.unseen ? '/dz/settings#changes' : '/dz/settings'} title={changes?.unseen ? `${changes.unseen} new provider change(s) — applied automatically` : undefined} className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-base font-semibold text-foreground/90 hover:bg-accent">
            {changes?.unseen > 0 && (
              <span className="absolute -right-1.5 -top-1.5 min-w-5 h-5 px-1 rounded-full bg-primary text-[13px] leading-5 text-center font-bold text-primary-foreground">{changes.unseen}</span>
            )}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 7 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 1.17 14H1a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 2.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 7 4.6 1.65 1.65 0 0 0 8 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.36.15.67.4.88.72.21.32.33.7.32 1.08V11a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            <span className="hidden sm:inline">Settings</span>
          </a>
        </div>
      </header>
      {/* The project's color under the header: you always see you're inside it */}
      {project && <div className="h-[3px] w-full flex-shrink-0" style={{ background: project.color }} aria-hidden="true" />}

      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {mobileOpen && <div className="fixed inset-0 bg-black/70 z-40 md:hidden" onClick={() => setMobileOpen(false)} />}

        {/* Sidebar */}
        <aside className={`fixed top-14 bottom-0 left-0 md:static md:h-full z-30 bg-[#0a0a0b]/95 border-r border-white/[0.06] flex flex-col transition-all duration-300 flex-shrink-0 select-none
          ${mobileOpen ? 'translate-x-0 w-64 z-50' : '-translate-x-full md:translate-x-0'} ${collapsed ? 'md:w-16' : 'md:w-56'}`}>
          <nav aria-label="Navigation" className="flex-1 overflow-y-auto custom-scrollbar py-3 px-2 space-y-1">
            {project && (
              <>
                <a href={pathFor(null, activeTab === 'projects' ? 'create' : activeTab)} onClick={(e) => { if (e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openProject(null, activeTab === 'projects' ? 'create' : activeTab); setMobileOpen(false); } }}
                  title={isCollapsed ? 'Back to Library' : undefined}
                  className={`flex items-center rounded-xl text-base text-muted-foreground hover:text-foreground hover:bg-accent/60 ${isCollapsed ? 'h-11 w-11 justify-center mx-auto' : 'px-3 py-2 gap-3'}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                  {!isCollapsed && <span>Library</span>}
                </a>
                {!isCollapsed && (
                  <div className="flex min-w-0 items-center gap-2 px-3 pb-1 pt-1">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: project.color }} />
                    <span className="truncate text-lg font-bold text-foreground" title={project.name}>{project.name}</span>
                    {project.archived && <span className="shrink-0 text-muted-foreground">· archived</span>}
                  </div>
                )}
              </>
            )}
            {DZ_TABS.filter((t) => t.tool && !(project && t.libraryOnly)).map(navLink)}
            {project && (
              <div className="py-1">
                <FolderTree project={project} folders={folders} current={folder} collapsed={isCollapsed}
                  onPick={(id) => { pickFolder(id); if (!DZ_TABS.find((t) => t.id === activeTab)?.tool && !WORK_TABS[activeTab]) openTab('create'); setMobileOpen(false); }}
                  onNew={(parent) => setFolderDialog({ mode: 'new', parent })}
                  onRename={(f) => setFolderDialog({ mode: 'rename', folder: f })}
                  onDelete={deleteFolder}
                  onDropItems={(ids, folderId) => dropItems(ids, project.id, folderId)} />
              </div>
            )}
            <div className="mx-2 my-2 border-t border-white/[0.06]" />
            {DZ_TABS.filter((t) => !t.tool && (project || t.id !== 'projects')).map(navLink)}
            {!project && (
              <>
                <div className="mx-2 my-2 border-t border-white/[0.06]" />
                {!isCollapsed ? (
                  <div className="flex items-center justify-between px-3 pb-1 pt-1">
                    <a href="/studio/projects" onClick={(e) => { if (e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openTab('projects'); } }} className="text-base font-semibold text-muted-foreground/80 hover:text-foreground">Projects</a>
                    <button type="button" onClick={() => setNewProjectOpen(true)} className="rounded-md px-1.5 text-lg leading-6 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="New project" title="New project">+</button>
                  </div>
                ) : navLink(DZ_TABS.find((t) => t.id === 'projects'))}
                {!isCollapsed && projects.filter((p) => !p.archived).slice(0, 8).map((p) => (
                  <a key={p.id} href={pathFor(p, 'create')}
                    onClick={(e) => { if (e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openProject(p, 'create'); setMobileOpen(false); } }}
                    onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('application/x-dz-items')) { e.preventDefault(); e.stopPropagation(); e.currentTarget.dataset.over = '1'; } }}
                    onDragLeave={(e) => { delete e.currentTarget.dataset.over; }}
                    onDrop={(e) => { delete e.currentTarget.dataset.over; const raw = e.dataTransfer.getData('application/x-dz-items'); if (!raw) return; e.preventDefault(); e.stopPropagation(); try { dropItems(JSON.parse(raw), p.id, null); } catch { /* not ours */ } }}
                    className="flex h-9 min-w-0 items-center gap-2.5 rounded-lg px-3 text-base text-muted-foreground hover:bg-accent/60 hover:text-foreground data-[over]:ring-2 data-[over]:ring-primary">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                    <span className="truncate">{p.name}</span>
                  </a>
                ))}
                {!isCollapsed && projects.filter((p) => !p.archived).length > 8 && (
                  <button type="button" onClick={() => openTab('projects')} className="flex h-9 w-full items-center px-3 text-base text-muted-foreground hover:text-foreground">All projects…</button>
                )}
              </>
            )}
          </nav>
        </aside>

        {/* Studios stay mounted, so running generations survive switching tabs */}
        <main className="flex-1 min-h-0 h-full relative overflow-hidden bg-[#030303]" onContextMenu={onContextMenu}>
          <div className={activeTab === 'create' ? 'h-full w-full' : 'hidden'}>
            <DzCreateStudio {...studioProps} {...callbacks('create')} droppedFiles={activeTab === 'create' ? droppedFiles : null} onFilesHandled={() => setDroppedFiles(null)} />
          </div>
          <div className={activeTab === 'elements' ? 'h-full w-full' : 'hidden'}>
            {activeTab === 'elements' && <DzElementsPage projects={projects} apiKey={DZ_SESSION_PLACEHOLDER} onError={(message) => push({ type: 'error', tabId: 'elements', message })} />}
          </div>
          <div className={activeTab === 'projects' ? 'h-full w-full' : 'hidden'}>
            {activeTab === 'projects' && (
              <DzProjectsPage ctx={{ project, folder }} projects={projects} colors={colors} userId={user.id} onOpen={(p) => openProject(p, p ? 'create' : 'projects')} onNew={() => setNewProjectOpen(true)} onChanged={refreshProject}
                onError={(message) => push({ type: 'error', tabId: 'projects', message })} />
            )}
          </div>
          <div className={activeTab === 'director' ? 'h-full w-full' : 'hidden'}>
            <DzDirector key={project?.id || 'library'} {...studioProps} {...callbacks('director')} />
          </div>
          <div className={activeTab === 'cinema' ? 'h-full w-full' : 'hidden'}>
            <DzCinemaStudio {...studioProps} {...callbacks('cinema')} />
          </div>
          <div className={activeTab === 'image' ? 'h-full w-full' : 'hidden'}>
            <DzCreateStudio mode="image" {...studioProps} {...callbacks('image')} droppedFiles={activeTab === 'image' ? droppedFiles : null} onFilesHandled={() => setDroppedFiles(null)} />
          </div>
          <div className={activeTab === 'video' ? 'h-full w-full' : 'hidden'}>
            <DzCreateStudio mode="video" {...studioProps} {...callbacks('video')} droppedFiles={activeTab === 'video' ? droppedFiles : null} onFilesHandled={() => setDroppedFiles(null)} />
          </div>
          {WORK_TABS[activeTab] && (
            <div className="h-full w-full">
              <DzLibrary key={activeTab} section={WORK_TABS[activeTab]} onGenerationError={callbacks('library').onGenerationError} />
            </div>
          )}
          <div className={activeTab === 'upscale' ? 'h-full w-full' : 'hidden'}>
            <DzUpscaleStudio key={project?.id || 'library'} {...studioProps} {...callbacks('upscale')} isAdmin={user.role === 'admin'} initial={upscaleTabPick} droppedFiles={activeTab === 'upscale' ? droppedFiles : null} onFilesHandled={() => setDroppedFiles(null)} />
          </div>
        </main>

        {/* Side chat with assistants: answers go into the prompt of the open studio. */}
        <DzChatPanel open={chatOpen} onOpenChange={setChatOpen} activeTab={activeTab} apiKey={DZ_SESSION_PLACEHOLDER}
          canInsert={() => INSERT_TABS.has(activeTab) && dzGetStudioState(activeTab)?.writable !== false}
          getStudio={() => dzGetStudioState(activeTab)}
          onInsert={(text, how) => window.dispatchEvent(new CustomEvent(DZ_INSERT_EVENT, { detail: { tab: activeTab, text, how } }))} />

        {/* Upscale drawer: opens next to the work, from an image's button or menu.
            Non-modal: the page behind stays usable. */}
        <SidePanel
          open={Boolean(upscaleDrawer)}
          onOpenChange={(open) => { if (!open) setUpscaleDrawer(null); }}
          title="Upscale"
          actions={upscaleDrawer && <Button variant="ghost" size="sm" className="text-primary" onClick={() => openInUpscaleTab(upscaleDrawer.url)}>Open in Upscale tab</Button>}
        >
          {upscaleDrawer && (
            <div className="flex h-full flex-col">
              <div className="flex gap-3 border-b border-border p-4">
                <img src={upscaleDrawer.url} alt="Original" className="h-28 min-w-0 flex-1 rounded-xl bg-background object-contain" />
                {upscaleDrawer.result && (
                  <button type="button" onClick={() => downloadUrl(upscaleDrawer.result)} title="Download the upscaled image" className="relative h-28 min-w-0 flex-1">
                    <img src={upscaleDrawer.result} alt="Upscaled" className="h-full w-full rounded-xl border border-primary/50 bg-background object-contain" />
                    <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/75 px-2 py-0.5 text-base font-semibold text-white">Download</span>
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1">
                <DzUpscalePanel
                  apiKey={DZ_SESSION_PLACEHOLDER}
                  imageUrl={upscaleDrawer.url}
                  isAdmin={user.role === 'admin'}
                  compact
                  onStart={() => callbacks('upscale').onGenerationStart()}
                  onDone={(r) => {
                    const cb = callbacks('upscale');
                    cb.onGenerationEnd();
                    cb.onGenerationComplete({ url: r.url });
                    setUpscaleDrawer((d) => (d && d.url === r.source ? { ...d, result: r.url } : d));
                  }}
                  onError={(msg) => { const cb = callbacks('upscale'); cb.onGenerationEnd(); cb.onGenerationError(msg); }}
                />
              </div>
            </div>
          )}
        </SidePanel>

        {imageMenu && (
          <div role="menu" className="fixed z-[210] w-52 overflow-hidden rounded-xl border border-white/[0.08] bg-[#151519] py-1 text-base shadow-[0_12px_32px_rgba(0,0,0,0.6)]" style={{ left: imageMenu.x, top: imageMenu.y }} onClick={(e) => e.stopPropagation()}>
            {dzUpscaleSpec() && (
              <button type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-white/85 hover:bg-white/[0.06]" onClick={() => { setUpscaleDrawer({ url: imageMenu.url, result: null }); setImageMenu(null); }}>Upscale…</button>
            )}
            <button type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-white/85 hover:bg-white/[0.06]" onClick={() => { openInUpscaleTab(imageMenu.url); setImageMenu(null); }}>Open in Upscale tab</button>
            <button type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-white/85 hover:bg-white/[0.06]" onClick={() => { downloadUrl(imageMenu.url); setImageMenu(null); }}>Download</button>
          </div>
        )}
      </div>

      {/* Notifications: dark cards, top-right under the header (never over the
          prompt panel and its buttons). "Generating…" only for other tabs —
          on the open one the card in the grid already shows it. */}
      {(runningTabs.some((t) => t !== activeTab) || notifications.length > 0) && (
        <div aria-live="polite" className={`fixed top-16 right-3 z-[200] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2 pointer-events-none ${rightPanelOpen ? 'md:right-[440px]' : 'md:right-5'}`}>
          {runningTabs.filter((t) => t !== activeTab).map((tabId) => (
            <div key={tabId} role="status" className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#121215]/95 backdrop-blur-md px-3.5 py-3 text-base shadow-[0_12px_32px_rgba(0,0,0,0.55)]">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#22d3ee]/25 border-t-[#22d3ee]" />
              <span className="font-semibold text-white/90">{labelOf(tabId)}</span>
              <span className="text-white/45">generating{running[tabId] > 1 ? ` · ${running[tabId]}` : ''}…</span>
            </div>
          ))}
          {notifications.map((n) => (
            <div key={n.id} role={n.type === 'error' ? 'alert' : 'status'} className="dz-toast pointer-events-auto flex items-start gap-3 overflow-hidden rounded-xl border border-white/[0.08] bg-[#121215]/95 backdrop-blur-md p-2.5 pr-3 text-base shadow-[0_12px_32px_rgba(0,0,0,0.55)]">
              <span className={`w-1 self-stretch rounded-full ${n.type === 'error' ? 'bg-red-400' : 'bg-[#22d3ee]'}`} />
              {n.type === 'success' && n.url && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(n.url) && (
                <img src={n.url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover border border-white/10" />
              )}
              <div className="min-w-0 flex-1 py-0.5">
                <p className="font-semibold text-white/90">
                  {n.title || labelOf(n.tabId)} {n.type !== 'notice' && !n.title && <span className="font-normal text-white/45">{n.type === 'error' ? '· failed' : '· ready'}</span>}
                </p>
                {n.type === 'error' && <p className="mt-0.5 line-clamp-2 text-base text-red-300/90" title={n.message}>{n.message}</p>}
                {n.type === 'notice' && <p className="mt-0.5 line-clamp-3 text-base text-white/70" title={n.message}>{n.message}</p>}
                {n.type === 'success' && n.tabId !== activeTab && (
                  <button type="button" onClick={() => { openTab(n.tabId); dismiss(n.id); }} className="mt-0.5 text-base font-semibold text-[#22d3ee] hover:text-[#67e8f9]">Open</button>
                )}
              </div>
              <button type="button" onClick={() => dismiss(n.id)} className="mt-0.5 h-6 w-6 shrink-0 rounded-md text-white/35 hover:bg-white/10 hover:text-white" aria-label="Dismiss">✕</button>
            </div>
          ))}
        </div>
      )}
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} colors={colors} onCreated={(p) => { reloadProjects(); openProject(p); }} />
      <NameDialog open={Boolean(folderDialog)} onOpenChange={(o) => { if (!o) setFolderDialog(null); }}
        title={folderDialog?.mode === 'rename' ? 'Rename folder' : folderDialog?.parent ? `New folder in “${folderDialog.parent.name}”` : 'New folder'}
        description={folderDialog?.mode === 'rename' ? undefined : 'It opens right away; new work goes into it.'}
        placeholder="Folder name" initial={folderDialog?.mode === 'rename' ? folderDialog.folder.name : ''} submitLabel={folderDialog?.mode === 'rename' ? 'Save' : 'Create'}
        onSubmit={async (name) => {
          if (folderDialog?.mode === 'rename') { await dzProjectsApi.updateFolder(folderDialog.folder.id, { name }); await reloadFolders(); return; }
          const r = await dzProjectsApi.createFolder(project.id, name, folderDialog?.parent?.id || null);
          setFolders(r.folders || []);
          pickFolder(r.folder.id);
        }} />
      {toElement && <ToElementDialog items={toElement} onClose={() => setToElement(null)} onError={(message) => push({ type: 'error', title: 'Elements', message })} />}
      <MoveDialog item={moveItem} onOpenChange={(o) => { if (!o) setMoveItem(null); }} projects={projects} />
      <style>{`.dz-toast{animation:dzToastIn 260ms cubic-bezier(.16,1,.3,1)}@keyframes dzToastIn{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}.dz-sheet{animation:dzDrawerIn 240ms cubic-bezier(.16,1,.3,1)}@keyframes dzDrawerIn{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}`}</style>
    </div>
  );
}
