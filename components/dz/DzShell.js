'use client';

// DZ: the app shell — header, navigation, studios and notifications.
// Replaces the upstream StandaloneShell (API-key handling, promo banners and
// tabs for services we do not use). Studios come from the `studio` package.

import { useState, useEffect, useCallback, useRef } from 'react';
import { DzCreateStudio, DzStudio, DzStoryboard, DropOverlay, dzActiveDropTarget, DzTools, DZ_SEND_EVENT, DzUpscaleStudio, DzUpscalePanel, DzLibrary, dzUpscaleSpec, dzIsOwnImage, SidePanel, Button,
  DzChatPanel, dzGetStudioState, DZ_INSERT_EVENT, dzScrollBoxRef, dzWatchScrollers,
  DzProjectsPage, DzElementsPage, ToElementDialog, VideoElementDialog, ProjectSwitcher, FolderTree, NewProjectDialog, NameDialog, MoveDialog, dzProjectsApi, dzSetContext,
  DropdownMenuParts, DialogParts, cn } from 'studio';
import { Image as ImageIcon, VideoCamera, Aperture, FilmSlate, ArrowsOut, SquaresFour, Images, Shapes, Layout, Trash, FolderSimple, Plus,
  SidebarSimple, MagnifyingGlass, ChatCircle, CaretUpDown, GearSix, Sun, Moon, SignOut, List, X, ArrowRight } from '@phosphor-icons/react';
import { DZ_SESSION_PLACEHOLDER, dzFetchMe, dzFetchBalances, dzFormatBalances } from './session';
import { useTheme } from '../ThemeToggle';

// Phosphor icons (redesign package 01, section 3.4). The active sidebar item uses weight Fill.
const ICONS = {
  image: ImageIcon, video: VideoCamera, create: Aperture, director: FilmSlate, upscale: ArrowsOut, tools: SquaresFour,
  library: Images, elements: Shapes, boards: Layout, trash: Trash, projects: FolderSimple,
};

// Navigation (section 4.2). Internal ids stay as before (studios key their state by them);
// the URL and the label follow the new names.
export const DZ_TABS = [
  { id: 'image', label: 'Image', group: 'create' },
  { id: 'video', label: 'Video', group: 'create' },
  { id: 'create', label: 'Studio', group: 'create' },
  { id: 'director', label: 'Storyboard', group: 'create' },
  { id: 'upscale', label: 'Upscale', group: 'tools' },
  { id: 'tools', label: 'All tools', group: 'tools' },
  { id: 'library', label: 'All work', group: 'library' },
  { id: 'elements', label: 'Elements', group: 'library' },
  { id: 'boards', label: 'Boards', group: 'library' },
  { id: 'trash', label: 'Trash' },
  { id: 'projects', label: 'Projects', projectLabel: 'Project settings' },
];
const GROUPS = [['create', 'Create'], ['tools', 'Tools'], ['library', 'Library']];
const TAB_IDS = new Set(DZ_TABS.map((t) => t.id));
// Tabs whose prompt the side chat can write into.
const INSERT_TABS = new Set(['create', 'image', 'video', 'director', 'tools']);
const DEFAULT_TAB = 'create';
const labelOf = (tabId) => DZ_TABS.find((t) => t.id === tabId)?.label || tabId;
const WORK_TABS = { library: 'all', trash: 'trash' };
// URL segment of a tab, and back. Old segments still open the right place.
const SEGMENT = { create: 'studio', director: 'storyboard', library: 'work' };
const segOf = (tab) => SEGMENT[tab] || tab;
const TAB_OF = Object.fromEntries(DZ_TABS.map((t) => [segOf(t.id), t.id]));
const OLD_SEGMENT = { create: 'create', director: 'director', library: 'library', liked: 'library', cinema: 'create' };
const tabOfSeg = (seg) => TAB_OF[seg] || OLD_SEGMENT[seg] || DEFAULT_TAB;
// Folder names from the top down to `id`.
const pathOf = (folders, id) => {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = [];
  for (let f = byId.get(id), n = 0; f && n < 10; f = byId.get(f.parent_id), n += 1) out.unshift(f.name);
  return out;
};
// /library/<tab> — Library (personal);  /p/<project slug>/<tab> — inside a project.
const parsePath = (path) => {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts[0] === 'p' && parts[1]) return { slug: decodeURIComponent(parts[1]), tab: tabOfSeg(parts[2]) };
  return { slug: null, tab: tabOfSeg(parts[1]) };
};
const tabFromPath = (path) => parsePath(path).tab;
// The Library has no project settings page: there "Projects" is the list of projects.
const tabIn = (project, tab) => tab;
const pathFor = (project, tab) => (project ? `/p/${encodeURIComponent(project.slug)}/${segOf(tab)}` : `/library/${segOf(tab)}`);
const folderKey = (projectId) => `dz_folder_${projectId}`;
const isLiked = () => typeof window !== 'undefined' && window.location.hash === '#liked';
const plainClick = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey;

const NOTIFICATION_TTL = 12_000;
const MAX_NOTIFICATIONS = 3;

export default function DzShell() {
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(null);
  const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
  const [liked, setLiked] = useState(false); // All work, Liked tab (/library/work#liked)
  const [paletteOpen, setPaletteOpen] = useState(false); // ⌘K
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
  const [videoElement, setVideoElement] = useState(null); // Storyboard group: Generate video element (package 05)
  // Only the latest project switch counts; until the first one resolves the studios wait.
  const navSeq = useRef(0);
  const [switching, setSwitching] = useState(true);

  // Scrollers that overflow hold the gesture at their end (package 08).
  useEffect(() => { dzWatchScrollers(); }, []);
  // Session check (the gateway already required sign-in) and initial tab.
  useEffect(() => {
    setActiveTab(tabFromPath(window.location.pathname));
    setLiked(isLiked() || /\/liked\/?$/.test(window.location.pathname));
    try { setCollapsed(localStorage.getItem('dz_sidebar_collapsed') === '1'); } catch { /* storage is optional */ }
    dzFetchMe().then((u) => u && setUser(u)).catch((err) => console.error(err));
    const onPop = () => { setActiveTab(tabFromPath(window.location.pathname)); setLiked(isLiked()); loadProjectFromPath(); };
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
    const onVideo = (e) => { if (e.detail?.element) setVideoElement(e.detail.element); };
    window.addEventListener('dz:to-element', onTo);
    window.addEventListener('dz:video-element', onVideo);
    return () => { window.removeEventListener('dz:to-element', onTo); window.removeEventListener('dz:video-element', onVideo); };
  }, []);
  // Messages from anywhere (Move / Copy / Trash on many items, …).
  useEffect(() => {
    const onNotify = (e) => { if (e.detail?.message) push({ type: e.detail.type === 'error' ? 'error' : 'notice', title: e.detail.title, message: e.detail.message, undo: typeof e.detail.undo === 'function' ? e.detail.undo : null }); };
    // Any screen can open another one (e.g. Studio → Elements).
    const onOpen = (e) => { if (e.detail?.tab) openTabRef.current?.(e.detail.tab); };
    window.addEventListener('dz:notify', onNotify);
    window.addEventListener('dz:open-tab', onOpen);
    return () => { window.removeEventListener('dz:notify', onNotify); window.removeEventListener('dz:open-tab', onOpen); };
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
    const onUpscale = (e) => { if (e.detail?.url) { setImageMenu(null); setChatOpen(false); setUpscaleDrawer({ url: e.detail.url, result: null, meta: e.detail.meta || null }); } };
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

  const openTab = useCallback((tabId, { liked: wantLiked = false } = {}) => {
    if (!TAB_IDS.has(tabId)) return;
    window.history.pushState(null, '', pathFor(project, tabId) + (wantLiked ? '#liked' : ''));
    setLiked(wantLiked);
    setActiveTab(tabId);
    // A tab opened from a link starts at its top (package 06, S8.4: Storyboard → the list).
    window.dispatchEvent(new CustomEvent('dz:tab-link', { detail: { tab: tabId } }));
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

  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((v) => !v); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleSidebar = () => setCollapsed((prev) => {
    try { localStorage.setItem('dz_sidebar_collapsed', prev ? '0' : '1'); } catch { /* optional */ }
    return !prev;
  });

  // ── Notifications ─────────────────────────────────────────────────────
  // Every toast closes by itself after NOTIFICATION_TTL (package 07, F3.1): its own
  // timer from the moment it is shown, plus a sweep when the page is shown again
  // (a hidden tab's timers can be held back for minutes).
  const push = useCallback((n) => {
    const entry = { ...n, id: `${Date.now()}-${Math.random()}`, expiresAt: Date.now() + NOTIFICATION_TTL };
    setNotifications((prev) => [...prev, entry].slice(-MAX_NOTIFICATIONS));
    setTimeout(() => setNotifications((prev) => prev.filter((x) => x.id !== entry.id)), NOTIFICATION_TTL + 50);
  }, []);
  const dismiss = useCallback((id) => setNotifications((prev) => prev.filter((n) => n.id !== id)), []);
  useEffect(() => {
    if (!notifications.length) return undefined;
    const sweep = () => setNotifications((prev) => (prev.some((n) => n.expiresAt <= Date.now()) ? prev.filter((n) => n.expiresAt > Date.now()) : prev));
    const next = Math.min(...notifications.map((n) => n.expiresAt));
    const timer = setTimeout(sweep, Math.max(0, next - Date.now()) + 20);
    const onShow = () => { if (!document.hidden) sweep(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); };
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
  // The overlay is for files coming from outside the page. It used to stay on
  // screen after a drop (Loom 19.11, iMac): the composer handles its own drop and
  // stops it, so the shell never heard the drop; and Safari reports a picture
  // dragged inside the page as "Files" and leaves with no relatedTarget.
  // Now: drags that start in the page never show it, and any drop, drag end or
  // leaving the window hides it (listeners on window, capture phase).
  // Package 06, A2: one overlay (DropOverlay) for every surface that takes files. A surface
  // registers itself (useDzDropTarget); its drop is handled here, before any element below
  // the pointer, so a file lands where the surface decides. Image / Video / Studio / Upscale
  // keep their own handling (the composer's slots, droppedFiles).
  const internalDrag = useRef(false);
  useEffect(() => {
    const start = () => { internalDrag.current = true; };
    const take = (e) => {
      if (internalDrag.current) return;
      const files = Array.from(e.dataTransfer?.files || []);
      const t = files.length ? dzActiveDropTarget() : null;
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      t.onDrop(files, { x: e.clientX, y: e.clientY });
    };
    const esc = (e) => { if (e.key === 'Escape') setDragging(false); };
    // Reset the flag after the page's own drop handlers have run.
    const stop = () => { setDragging(false); setTimeout(() => { internalDrag.current = false; }, 0); };
    window.addEventListener('drop', take, true);
    window.addEventListener('keydown', esc, true);
    const leave = (e) => { if (!e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight)) setDragging(false); };
    window.addEventListener('dragstart', start, true);
    window.addEventListener('dragend', stop, true);
    window.addEventListener('drop', stop, true);
    window.addEventListener('dragleave', leave, true);
    return () => {
      window.removeEventListener('drop', take, true);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('dragstart', start, true);
      window.removeEventListener('dragend', stop, true);
      window.removeEventListener('drop', stop, true);
      window.removeEventListener('dragleave', leave, true);
    };
  }, []);
  // Tabs that take files dropped anywhere; the Storyboard handles its own drops (package 05).
  const takesDrop = ['create', 'image', 'video', 'upscale'].includes(activeTab);
  const studioDrop = activeTab === 'upscale'
    ? { title: 'Drop files here', line: 'A picture or a video to upscale' }
    : { title: 'Drop files to use them as references', line: '' };
  const onDragEnter = (e) => {
    e.preventDefault();
    if (internalDrag.current || !Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    const n = Array.from(e.dataTransfer?.items || []).filter((i) => i.kind === 'file').length;
    const t = dzActiveDropTarget();
    if (t) setDragging({ title: t.title || 'Drop files here', line: typeof t.line === 'function' ? t.line(n) : (t.line || '') });
    else if (takesDrop) setDragging(studioDrop);
  };
  const onDragLeave = (e) => {
    e.preventDefault();
    if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setDragging(false);
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (internalDrag.current || !takesDrop) return;
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

  // Splash until the session and the project in the URL are known (nothing can go to the wrong place).
  if (!user || (switching && !project && parsePath(typeof window !== 'undefined' ? window.location.pathname : '').slug)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
        <span className="h-10 w-10 rounded-xl bg-foreground" aria-hidden="true" />
        <span className="text-lg font-semibold text-muted-foreground">Director</span>
      </div>
    );
  }

  const studioProps = { apiKey: DZ_SESSION_PLACEHOLDER, locale: 'en' };
  const isCollapsed = collapsed && !mobileOpen;
  const runningTabs = Object.keys(running);
  const runningCount = runningTabs.reduce((n, t) => n + running[t], 0);
  // Notifications move left of a right-hand panel instead of covering its button.
  const rightPanelOpen = Boolean(upscaleDrawer) || activeTab === 'upscale';
  const go = (tab) => (e) => { if (plainClick(e)) { e.preventDefault(); openTab(tab); } };

  // Sidebar item (section 4.2): 34 px, radius 8, icon + label, optional count or running dot.
  const NavItem = ({ tab, label, href, onClick, icon: Icon, active, dot, trailing, children }) => (
    <a
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={isCollapsed ? label : undefined}
      className={cn('relative flex h-[34px] min-w-0 items-center rounded-md text-base font-medium transition-colors duration-state',
        isCollapsed ? 'mx-auto w-10 justify-center' : 'gap-2.5 px-2.5',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
    >
      {Icon ? <Icon size={16} weight={active ? 'fill' : 'regular'} className="shrink-0" /> : children}
      {!isCollapsed && <span className="truncate">{label}</span>}
      {!isCollapsed && trailing}
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full bg-signal', isCollapsed ? 'absolute right-1.5 top-1.5' : 'ml-auto')} aria-label="Running" />}
    </a>
  );
  const tabItem = (id) => {
    const t = DZ_TABS.find((x) => x.id === id);
    const label = project && t.projectLabel ? t.projectLabel : t.label;
    return <NavItem key={id} tab={id} label={label} href={pathFor(project, id)} onClick={go(id)} icon={ICONS[id]} active={activeTab === id} dot={running[id] > 0} />;
  };
  const GroupTitle = ({ children, action }) => (isCollapsed
    ? <div className="mx-3 my-2 h-px bg-border" />
    : (
      <div className="mb-1 mt-5 flex h-5 items-center justify-between px-2.5 first:mt-1">
        <span className="text-overline uppercase text-muted-foreground">{children}</span>
        {action}
      </div>
    ));
  const activeProjects = projects.filter((p) => !p.archived);

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground"
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && <DropOverlay title={dragging.title} line={dragging.line} />}

      {/* Header, 48 px (section 4.1) */}
      <header className="z-50 grid h-12 flex-shrink-0 grid-cols-[1fr_minmax(0,360px)_1fr] items-center gap-3 border-b border-border bg-background px-3">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => setMobileOpen((v) => !v)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden" aria-label="Menu">
            <List size={18} />
          </button>
          <button type="button" onClick={toggleSidebar} className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground md:flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <SidebarSimple size={18} />
          </button>
          <a href={pathFor(project, DEFAULT_TAB)} onClick={go(DEFAULT_TAB)} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-base font-semibold text-foreground">
            <span className="h-[18px] w-[18px] rounded-[5px] bg-foreground" aria-hidden="true" />
            <span className="hidden sm:inline">Director</span>
          </a>
          {/* Workspace: Library or a project */}
          <ProjectSwitcher ctx={{ project, folder }} projects={projects} onOpen={openProject} onNew={() => setNewProjectOpen(true)} onAll={() => openProject(null, 'projects')} />
        </div>
        <button type="button" onClick={() => setPaletteOpen(true)} className="hidden h-8 min-w-0 items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 text-left text-base text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground md:flex" aria-label="Search or run a command">
          <MagnifyingGlass size={16} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">Search or run a command</span>
          <kbd className="rounded-xs border border-border px-1.5 font-sans text-xs text-muted-foreground">⌘K</kbd>
        </button>
        <div className="flex min-w-0 items-center justify-end gap-2">
          {runningCount > 0 && (
            <button type="button" onClick={() => openTab(runningTabs.includes(activeTab) ? activeTab : runningTabs[0])} title={runningTabs.map((t) => `${labelOf(t)}: ${running[t]}`).join(' · ')}
              className="flex h-8 items-center gap-2 rounded-full border border-border px-3 text-sm font-medium text-foreground transition-colors duration-state hover:bg-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-signal" />
              {runningCount} running
            </button>
          )}
          <button type="button" onClick={() => { setUpscaleDrawer(null); setChatOpen((v) => !v); }} aria-pressed={chatOpen} aria-label="Assistant" title="Assistant"
            className={cn('flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-state', chatOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
            <ChatCircle size={18} weight={chatOpen ? 'fill' : 'regular'} />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {mobileOpen && <div className="fixed inset-0 z-40 bg-scrim md:hidden" onClick={() => setMobileOpen(false)} />}

        {/* Sidebar, 224 px / 56 px collapsed (section 4.2) */}
        <aside className={cn('fixed bottom-0 left-0 top-12 z-30 flex flex-shrink-0 select-none flex-col border-r border-border bg-background transition-[width,transform] duration-sheet ease-soft md:static md:h-full',
          mobileOpen ? 'z-50 w-56 translate-x-0' : '-translate-x-full md:translate-x-0', collapsed ? 'md:w-14' : 'md:w-56')}>
          <nav aria-label="Navigation" className="custom-scrollbar flex-1 overflow-y-auto px-2 pb-2 pt-3">
            {GROUPS.map(([g, title]) => (
              <div key={g}>
                <GroupTitle>{title}</GroupTitle>
                <div className="space-y-0.5">{DZ_TABS.filter((t) => t.group === g).map((t) => tabItem(t.id))}</div>
              </div>
            ))}

            <GroupTitle action={(
              <button type="button" onClick={() => setNewProjectOpen(true)} className="flex h-5 w-5 items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="New project" title="New project"><Plus size={14} /></button>
            )}>
              <a href="/library/projects" onClick={(e) => { if (plainClick(e)) { e.preventDefault(); openProject(null, 'projects'); } }} className="hover:text-foreground">Projects</a>
            </GroupTitle>
            <div className="space-y-0.5">
              {(isCollapsed ? activeProjects.slice(0, 5) : activeProjects.slice(0, 8)).map((p) => {
                const here = project?.id === p.id;
                return (
                  <div key={p.id}>
                    <a href={pathFor(p, here ? activeTab : DEFAULT_TAB)}
                      onClick={(e) => { if (plainClick(e)) { e.preventDefault(); if (!here) openProject(p, DEFAULT_TAB); setMobileOpen(false); } }}
                      onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('application/x-dz-items')) { e.preventDefault(); e.stopPropagation(); e.currentTarget.dataset.over = '1'; } }}
                      onDragLeave={(e) => { delete e.currentTarget.dataset.over; }}
                      onDrop={(e) => { delete e.currentTarget.dataset.over; const raw = e.dataTransfer.getData('application/x-dz-items'); if (!raw) return; e.preventDefault(); e.stopPropagation(); try { dropItems(JSON.parse(raw), p.id, null); } catch { /* not ours */ } }}
                      title={isCollapsed ? p.name : undefined}
                      className={cn('flex h-[34px] min-w-0 items-center rounded-md text-base font-medium transition-colors duration-state data-[over]:ring-2 data-[over]:ring-signal',
                        isCollapsed ? 'mx-auto w-10 justify-center' : 'gap-2.5 px-2.5',
                        here ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
                      <span className="flex w-4 shrink-0 justify-center"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} /></span>
                      {!isCollapsed && <span className="truncate">{p.name}</span>}
                    </a>
                    {here && !isCollapsed && (
                      <div className="ml-3 border-l border-border pl-1.5">
                        <FolderTree project={project} folders={folders} current={folder} collapsed={false}
                          onPick={(id) => { pickFolder(id); if (!DZ_TABS.find((t) => t.id === activeTab)?.group && !WORK_TABS[activeTab]) openTab(DEFAULT_TAB); setMobileOpen(false); }}
                          onNew={(parent) => setFolderDialog({ mode: 'new', parent })}
                          onRename={(f) => setFolderDialog({ mode: 'rename', folder: f })}
                          onDelete={deleteFolder}
                          onDropItems={(ids, folderId) => dropItems(ids, project.id, folderId)} />
                        {tabItem('projects')}
                      </div>
                    )}
                  </div>
                );
              })}
              {project && !activeProjects.some((p) => p.id === project.id) && !isCollapsed && (
                <div className="flex h-[34px] items-center gap-2.5 rounded-md bg-muted px-2.5 text-base font-medium text-foreground">
                  <span className="flex w-4 justify-center"><span className="h-2 w-2 rounded-full" style={{ background: project.color }} /></span>
                  <span className="truncate">{project.name}</span>{project.archived && <span className="text-sm text-muted-foreground">archived</span>}
                </div>
              )}
              {!isCollapsed && activeProjects.length > 8 && (
                <NavItem label="All projects…" href="/library/projects" onClick={(e) => { if (plainClick(e)) { e.preventDefault(); openProject(null, 'projects'); } }}><span className="w-4" /></NavItem>
              )}
              <NavItem label="New project" href="#new-project" onClick={(e) => { e.preventDefault(); setNewProjectOpen(true); }}><Plus size={16} className="shrink-0" /></NavItem>
            </div>

            <div className="mx-2.5 my-3 h-px bg-border" />
            {tabItem('trash')}
          </nav>

          {/* Account row: opens the account menu (balances, settings, theme, sign out) */}
          <div className="border-t border-border p-2">
            <AccountMenu user={user} balance={balance} changes={changes} collapsed={isCollapsed} />
          </div>
        </aside>

        {/* Studios stay mounted, so running generations survive switching tabs */}
        <main className="flex-1 min-h-0 h-full relative overflow-hidden bg-background" onContextMenu={onContextMenu}>
          <div className={activeTab === 'create' ? 'h-full w-full' : 'hidden'}>
            <DzStudio {...studioProps} {...callbacks('create')} droppedFiles={activeTab === 'create' ? droppedFiles : null} onFilesHandled={() => setDroppedFiles(null)} />
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
            <DzStoryboard key={project?.id || 'library'} {...studioProps} {...callbacks('director')} />
          </div>
          <div className={activeTab === 'tools' ? 'h-full w-full' : 'hidden'}>
            <DzTools key={project?.id || 'library'} {...studioProps} {...callbacks('tools')} />
          </div>
          <div className={activeTab === 'image' ? 'h-full w-full' : 'hidden'}>
            <DzStudio mode="image" {...studioProps} {...callbacks('image')} droppedFiles={activeTab === 'image' ? droppedFiles : null} onFilesHandled={() => setDroppedFiles(null)} />
          </div>
          <div className={activeTab === 'video' ? 'h-full w-full' : 'hidden'}>
            <DzStudio mode="video" {...studioProps} {...callbacks('video')} droppedFiles={activeTab === 'video' ? droppedFiles : null} onFilesHandled={() => setDroppedFiles(null)} />
          </div>
          {WORK_TABS[activeTab] && (
            <div className="h-full w-full">
              <DzLibrary key={activeTab} section={WORK_TABS[activeTab]} initialLiked={activeTab === 'library' && liked}
                onLikedChange={(on) => { setLiked(on); window.history.replaceState(null, '', pathFor(project, 'library') + (on ? '#liked' : '')); }}
                onGenerationError={callbacks('library').onGenerationError} />
            </div>
          )}
          {activeTab === 'boards' && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Layout size={24} /></span>
              <p className="text-lg font-semibold">Boards come later</p>
              <p className="max-w-sm text-muted-foreground">Moodboards for a project: pictures, notes and references in one place. They are planned after the redesign.</p>
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
          onInsert={(text, how, refs) => window.dispatchEvent(new CustomEvent(DZ_INSERT_EVENT, { detail: { tab: activeTab, text, how, refs } }))} />

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
                    <img src={upscaleDrawer.result} alt="Upscaled" className="h-full w-full rounded-xl border border-signal/50 bg-background object-contain" />
                    <span className="absolute bottom-1.5 right-1.5 rounded-md bg-overlay/75 px-2 py-0.5 text-base font-semibold text-overlay-foreground">Download</span>
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1">
                <DzUpscalePanel
                  apiKey={DZ_SESSION_PLACEHOLDER}
                  imageUrl={upscaleDrawer.url}
                  meta={upscaleDrawer.meta || null}
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
          <div role="menu" ref={dzScrollBoxRef} className="glass fixed z-[210] w-52 overflow-hidden rounded-xl border border-border p-1 text-base shadow-popover" style={{ left: imageMenu.x, top: imageMenu.y }} onClick={(e) => e.stopPropagation()}>
            {dzUpscaleSpec() && (
              <button type="button" role="menuitem" className="block h-8 w-full rounded-md px-2.5 text-left font-medium text-foreground hover:bg-accent" onClick={() => { setUpscaleDrawer({ url: imageMenu.url, result: null }); setImageMenu(null); }}>Upscale…</button>
            )}
            <button type="button" role="menuitem" className="block h-8 w-full rounded-md px-2.5 text-left font-medium text-foreground hover:bg-accent" onClick={() => { openInUpscaleTab(imageMenu.url); setImageMenu(null); }}>Open in Upscale tab</button>
            <button type="button" role="menuitem" className="block h-8 w-full rounded-md px-2.5 text-left font-medium text-foreground hover:bg-accent" onClick={() => { downloadUrl(imageMenu.url); setImageMenu(null); }}>Download</button>
          </div>
        )}
      </div>

      {/* Toasts (section 5.11): top centre, glass, radius 12. "Generating…" only for other
          tabs — on the open one the tile in the grid already shows it. */}
      {(runningTabs.some((t) => t !== activeTab) || notifications.length > 0) && (
        <div aria-live="polite" className={cn('pointer-events-none fixed left-1/2 top-14 z-[200] flex w-[440px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col items-center gap-2', rightPanelOpen && 'md:left-[calc(50%-220px)]')}>
          {runningTabs.filter((t) => t !== activeTab).map((tabId) => (
            <div key={tabId} role="status" className="dz-toast glass pointer-events-auto flex w-full items-center gap-3 rounded-xl border border-border px-3.5 py-2.5 text-base shadow-popover">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-signal/25 border-t-signal" />
              <span className="font-semibold text-foreground">{labelOf(tabId)}</span>
              <span className="text-muted-foreground">generating{running[tabId] > 1 ? ` · ${running[tabId]}` : ''}…</span>
            </div>
          ))}
          {notifications.map((n) => (
            <div key={n.id} role={n.type === 'error' ? 'alert' : 'status'} className="dz-toast glass pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-border px-3.5 py-2.5 text-base shadow-popover">
              {n.type === 'success' && n.url && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(n.url)
                ? <img src={n.url} alt="" className="h-9 w-9 shrink-0 rounded-sm border border-border object-cover" />
                : <span className={cn('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', n.type === 'error' ? 'bg-destructive' : n.type === 'success' ? 'bg-success' : 'bg-muted-foreground')} />}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">
                  {n.title || labelOf(n.tabId)} {n.type !== 'notice' && !n.title && <span className="font-normal text-muted-foreground">{n.type === 'error' ? '· failed' : '· ready'}</span>}
                </p>
                {n.type === 'error' && <p className="mt-0.5 line-clamp-2 text-destructive" title={n.message}>{n.message}</p>}
                {n.type === 'notice' && <p className="mt-0.5 line-clamp-3 text-muted-foreground" title={n.message}>{n.message}</p>}
              </div>
              {n.undo && (
                <button type="button" onClick={() => { n.undo(); dismiss(n.id); }} className="shrink-0 rounded-md px-1.5 font-semibold text-foreground hover:bg-accent">Undo</button>
              )}
              {n.type === 'success' && n.tabId !== activeTab && (
                <button type="button" onClick={() => { openTab(n.tabId); dismiss(n.id); }} className="shrink-0 rounded-md px-1.5 font-semibold text-foreground hover:bg-accent">Open</button>
              )}
              <button type="button" onClick={() => dismiss(n.id)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Dismiss"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} project={project} projects={activeProjects}
        onTab={(id, opts) => openTab(id, opts)} onProject={(p) => openProject(p, DEFAULT_TAB)} isAdmin={user.role === 'admin'} />
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
      {videoElement && <VideoElementDialog element={videoElement} onClose={() => setVideoElement(null)} onError={(message) => push({ type: 'error', title: 'Elements', message })} apiKey={DZ_SESSION_PLACEHOLDER} />}
      {toElement && <ToElementDialog items={toElement} onClose={() => setToElement(null)} onError={(message) => push({ type: 'error', title: 'Elements', message })} />}
      <MoveDialog item={moveItem} onOpenChange={(o) => { if (!o) setMoveItem(null); }} projects={projects} />
      <style>{`.dz-toast{animation:dzToastIn 260ms cubic-bezier(.2,.8,.2,1)}@keyframes dzToastIn{from{transform:translateY(-12px);opacity:0}to{transform:none;opacity:1}}.dz-sheet{animation:dzDrawerIn 240ms cubic-bezier(.16,1,.3,1)}@keyframes dzDrawerIn{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}`}</style>
    </div>
  );
}

// Account menu (section 4.1/4.2): provider balances moved here from the header.
function AccountMenu({ user, balance, changes, collapsed }) {
  const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } = DropdownMenuParts;
  const [theme, setTheme] = useTheme();
  const initial = (user.displayName || user.username || '?').trim().charAt(0).toUpperCase();
  const unseen = changes?.unseen || 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn('flex w-full items-center rounded-md text-left transition-colors duration-state hover:bg-accent', collapsed ? 'h-10 justify-center' : 'h-11 gap-2.5 px-2')} aria-label="Account menu">
          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
            {initial}
            {unseen > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-signal" />}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium leading-5 text-foreground">{user.displayName}</span>
                <span className="block truncate text-xs capitalize text-muted-foreground">{user.role}</span>
              </span>
              <CaretUpDown size={14} className="shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-64">
        {balance && (
          <>
            <DropdownMenuLabel className="text-overline uppercase text-muted-foreground">Provider balances</DropdownMenuLabel>
            {balance.map((b) => (
              <div key={b.id} title={b.hint} className="flex h-8 items-center justify-between px-2 text-base">
                <span className="text-muted-foreground">{b.name}</span>
                <span className={cn('font-medium tabular-nums', b.low ? 'text-warning' : 'text-foreground')}>{b.text}</span>
              </div>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild>
          <a href={unseen ? '/settings/changes' : '/settings'} className="h-8"><GearSix size={16} /> Settings
            {unseen > 0 && <span className="ml-auto rounded-full bg-signal/15 px-1.5 text-xs font-semibold text-signal" title={`${unseen} new provider change(s) — applied automatically`}>{unseen}</span>}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem className="h-8" onSelect={(e) => { e.preventDefault(); setTheme(theme === 'light' ? 'dark' : 'light'); }}>
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />} {theme === 'light' ? 'Dark theme' : 'Light theme'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-8" onSelect={() => { const f = document.createElement('form'); f.method = 'post'; f.action = '/logout'; document.body.appendChild(f); f.submit(); }}>
          <SignOut size={16} /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ⌘K: go anywhere — screens, projects, settings, theme.
const SETTINGS_LINKS = [
  ['account', 'Settings · My password'], ['text-models', 'Settings · Text models'],
  ['providers', 'Settings · Providers', true], ['changes', 'Settings · Provider changes', true], ['models', 'Settings · Recommended models', true], ['people', 'Settings · Accounts', true],
];
function CommandPalette({ open, onOpenChange, project, projects, onTab, onProject, isAdmin }) {
  const { Dialog, DialogContent, DialogTitle } = DialogParts;
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const [, setTheme] = useTheme();
  useEffect(() => { if (open) { setQ(''); setIndex(0); } }, [open]);
  const items = [
    ...DZ_TABS.filter((t) => t.id !== 'projects').map((t) => ({ key: `t-${t.id}`, label: t.label, hint: project ? project.name : 'Library', icon: ICONS[t.id], run: () => onTab(t.id) })),
    { key: 't-liked', label: 'Liked', hint: 'All work', icon: Images, run: () => onTab('library', { liked: true }) },
    { key: 't-projects', label: project ? 'Project settings' : 'All projects', icon: FolderSimple, run: () => onTab('projects') },
    ...projects.map((p) => ({ key: `p-${p.id}`, label: p.name, hint: 'Project', dot: p.color, run: () => onProject(p) })),
    ...SETTINGS_LINKS.filter(([, , admin]) => isAdmin || !admin).map(([sec, label]) => ({ key: `s-${sec}`, label, icon: GearSix, run: () => { window.location.href = `/settings/${sec}`; } })),
    { key: 'theme-dark', label: 'Dark theme', icon: Moon, run: () => setTheme('dark') },
    { key: 'theme-light', label: 'Light theme', icon: Sun, run: () => setTheme('light') },
  ];
  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter((i) => `${i.label} ${i.hint || ''}`.toLowerCase().includes(needle)) : items;
  const pick = (item) => { onOpenChange(false); item?.run(); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] max-w-[560px] translate-y-0 gap-0 overflow-hidden p-0 [&>button]:hidden">
        <DialogTitle className="sr-only">Search or run a command</DialogTitle>
        <div className="flex h-12 items-center gap-2.5 border-b border-border px-4">
          <MagnifyingGlass size={16} className="text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setIndex(0); }} placeholder="Search or run a command"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, shown.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter') { e.preventDefault(); pick(shown[index]); }
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none" />
        </div>
        <div role="listbox" className="custom-scrollbar max-h-[360px] overflow-y-auto p-1.5">
          {shown.length === 0 && <p className="px-3 py-6 text-center text-muted-foreground">Nothing found.</p>}
          {shown.map((item, i) => {
            const Icon = item.icon;
            return (
              <button key={item.key} type="button" role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => pick(item)}
                className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-base font-medium', i === index ? 'bg-accent text-foreground' : 'text-foreground')}>
                <span className="flex w-4 justify-center text-muted-foreground">{Icon ? <Icon size={16} /> : <span className="h-2 w-2 rounded-full" style={{ background: item.dot }} />}</span>
                <span className="truncate">{item.label}</span>
                {item.hint && <span className="ml-auto truncate text-sm text-muted-foreground">{item.hint}</span>}
                {i === index && <ArrowRight size={14} className={cn('shrink-0 text-muted-foreground', !item.hint && 'ml-auto')} />}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
