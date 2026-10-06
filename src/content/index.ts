import { activeAdapter, type Adapter, type ThreadTarget } from './adapters';
import type { ActiveThread } from './adapters/types';
import { paint, reconcile, clearAll } from './painter';
import { picker } from './picker';
import { send, contextAlive, isContextInvalidated, type BroadcastMessage } from '@/shared/messaging';
import { DEFAULT_SETTINGS, type AssignmentLite, type Member, type Settings } from '@/shared/types';
import { rafThrottle, debounce, errorMessage } from '@/shared/util';

/**
 * TeamHue content script.
 *
 * Lifecycle:
 *   1. Detect which platform adapter applies.
 *   2. Pull cached assignments from the background worker (instant, offline-safe).
 *   3. Paint every matching row; re-paint on any DOM mutation (debounced to a frame).
 *   4. Listen for realtime broadcasts so a teammate's change appears immediately.
 */

const adapter: Adapter | null = activeAdapter();

let assignments = new Map<string, AssignmentLite>();
let members: Member[] = [];
let settings: Settings = DEFAULT_SETTINGS;
let signedIn = false;
let myUserId: string | null = null;
let observer: MutationObserver | null = null;
let fab: HTMLButtonElement | null = null;
let dead = false;

/**
 * Tears this instance down for good.
 *
 * Reloading or updating the extension orphans the content scripts already
 * running in open tabs — `chrome.runtime` throws "Extension context
 * invalidated" on every call. Rather than log that error on every mutation,
 * we remove our styling and go quiet. The freshly injected script (on the
 * next page load) takes over cleanly.
 */
function shutdown() {
  if (dead) return;
  dead = true;
  try {
    observer?.disconnect();
    observer = null;
    clearAll();
    fab?.remove();
    fab = null;
    picker.close?.();
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
      window.removeEventListener(type, onAltGesture, true);
    }
    window.removeEventListener('scroll', repaintSoon, true);
    window.removeEventListener('resize', repaintSoon);
  } catch {
    /* page is already tearing down — nothing useful to do */
  }
}

function enabledHere(): boolean {
  return Boolean(adapter && settings.enabled && settings.platforms[adapter.platform] && signedIn);
}

/* ------------------------------------------------------------------ painting */

const repaint = rafThrottle(() => {
  if (!adapter || dead) return;

  // The extension was reloaded out from under us — stop cleanly.
  if (!contextAlive()) {
    shutdown();
    return;
  }

  if (!enabledHere()) {
    clearAll();
    updateFab(null);
    return;
  }

  let targets: ThreadTarget[] = [];
  try {
    targets = adapter.findThreads();
  } catch (err) {
    // A selector throwing must never break the host page.
    console.warn('[TeamHue] adapter error:', err);
    return;
  }

  const stillPainted = new Set<HTMLElement>();

  for (const target of targets) {
    const assignment = lookup(target.threadKey, target.aliases);
    if (!assignment) continue;
    paint(target, assignment, settings);
    stillPainted.add(target.element);
  }

  reconcile(stillPainted);
  updateFab(currentThread());
});

const repaintSoon = debounce(() => repaint(), 60);

/** Assignment for a key, falling back to legacy/alternate keys for the same conversation. */
function lookup(key: string, aliases?: string[]): AssignmentLite | undefined {
  const direct = assignments.get(key);
  if (direct) return direct;
  for (const alias of aliases ?? []) {
    const hit = assignments.get(alias);
    if (hit) return hit;
  }
  return undefined;
}

/* ----------------------------------------------------------------- active FAB */

function currentThread(): ActiveThread | null {
  if (!adapter?.activeThread) return null;
  try {
    return adapter.activeThread();
  } catch {
    return null;
  }
}

const FAB_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.5a2 2 0 0 0-1.4 3.4 2 2 0 0 1-1.1 2.6z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/></svg>`;

function ensureFab(): HTMLButtonElement {
  if (fab?.isConnected) return fab;
  fab = document.createElement('button');
  fab.id = 'th-fab';
  fab.type = 'button';
  fab.innerHTML =
    FAB_ICON +
    '<span class="th-fab-close" role="button" aria-label="Hide TeamHue button" title="Hide button (turn back on in the TeamHue popup)">×</span>';
  fab.setAttribute('aria-label', 'Set TeamHue color for this conversation');
  fab.title = 'TeamHue — click to set color · drag to move';
  fab.addEventListener('pointerdown', onFabPointerDown);
  fab.addEventListener('click', onFabClick);
  applyFabPosition(fab);
  document.documentElement.appendChild(fab);
  return fab;
}

/* ---- dragging (position is remembered per site) ---- */

const FAB_POS_KEY = 'teamhue:fab-pos:v1';
const FAB_SIZE = 48;
const FAB_MARGIN = 8;
let fabDragged = false;

function loadFabPos(): { x: number; y: number } | null {
  try {
    const p = JSON.parse(localStorage.getItem(FAB_POS_KEY) ?? 'null');
    return p && typeof p.x === 'number' && typeof p.y === 'number' ? p : null;
  } catch {
    return null;
  }
}

/** Keeps the button fully on screen, whatever the window size. */
function clampFab(x: number, y: number) {
  const maxX = window.innerWidth - FAB_SIZE - FAB_MARGIN;
  const maxY = window.innerHeight - FAB_SIZE - FAB_MARGIN;
  return {
    x: Math.min(Math.max(FAB_MARGIN, x), Math.max(FAB_MARGIN, maxX)),
    y: Math.min(Math.max(FAB_MARGIN, y), Math.max(FAB_MARGIN, maxY)),
  };
}

function applyFabPosition(el: HTMLElement) {
  const saved = loadFabPos();
  if (!saved) {
    el.style.removeProperty('left');
    el.style.removeProperty('top');
    el.style.removeProperty('right');
    el.style.removeProperty('bottom');
    return;
  }
  // Saved as fractions of the viewport so it survives window resizing.
  const { x, y } = clampFab(saved.x * window.innerWidth, saved.y * window.innerHeight);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
}

function onFabPointerDown(e: PointerEvent) {
  if (e.button !== 0 || !fab) return;
  if ((e.target as Element).closest('.th-fab-close')) return;
  const el = fab;
  const start = el.getBoundingClientRect();
  const offX = e.clientX - start.left;
  const offY = e.clientY - start.top;
  const sx = e.clientX;
  const sy = e.clientY;
  fabDragged = false;

  const move = (ev: PointerEvent) => {
    if (!fabDragged && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
    if (!fabDragged) {
      fabDragged = true;
      el.classList.add('th-dragging');
      picker.close?.();
    }
    const { x, y } = clampFab(ev.clientX - offX, ev.clientY - offY);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  };
  const up = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    el.classList.remove('th-dragging');
    if (fabDragged) {
      const r = el.getBoundingClientRect();
      try {
        localStorage.setItem(
          FAB_POS_KEY,
          JSON.stringify({ x: r.left / window.innerWidth, y: r.top / window.innerHeight }),
        );
      } catch {
        /* storage blocked */
      }
    }
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
}

window.addEventListener('resize', () => {
  if (fab?.isConnected) applyFabPosition(fab);
});

/** Puts the button back in its default corner (when re-enabled from the popup). */
function resetFabPosition() {
  try {
    localStorage.removeItem(FAB_POS_KEY);
  } catch {
    /* ignore */
  }
  if (fab) applyFabPosition(fab);
}

async function hideFab() {
  picker.close?.();
  fab?.remove();
  fab = null;
  settings = { ...settings, showFab: false };
  toast('Paintbrush hidden — turn it back on in the TeamHue popup. Option/Alt+click still works.');
  try {
    await send({ type: 'SET_SETTINGS', settings: { showFab: false } });
  } catch {
    /* context gone */
  }
}

function updateFab(thread: ActiveThread | null) {
  if (!thread || !enabledHere() || settings.showFab === false) {
    fab?.remove();
    fab = null;
    return;
  }
  const el = ensureFab();
  const current = lookup(thread.threadKey, thread.aliases);
  if (current) {
    el.dataset.thActive = '1';
    el.style.setProperty('--th-fab-color', current.color);
    el.title = `TeamHue — ${current.memberName ?? 'Assigned'}${current.note ? ` · ${current.note}` : ''} · drag to move`;
  } else {
    delete el.dataset.thActive;
    el.title = 'TeamHue — click to set color · drag to move';
  }
}

async function onFabClick(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  if ((e.target as Element).closest('.th-fab-close')) {
    void hideFab();
    return;
  }
  // A drag ends with a click — don't open the picker for it.
  if (fabDragged) {
    fabDragged = false;
    return;
  }
  const thread = currentThread();
  if (!thread || !adapter) return;
  openPickerFor(thread, (e.currentTarget as HTMLElement).getBoundingClientRect());
}

/* ---------------------------------------------------------------- interaction */

/** Resolves the conversation row under a pointer event, if any. */
function rowUnder(e: MouseEvent): ThreadTarget | null {
  if (!adapter || dead || !enabledHere()) return null;

  // Prefer resolving directly from the clicked element — exact and immune to
  // the list re-rendering between the last scan and this click.
  const el = e.target instanceof Element ? e.target : null;
  if (el && adapter.threadAt) {
    try {
      const hit = adapter.threadAt(el);
      if (hit) return hit;
    } catch {
      /* fall through to scan */
    }
  }

  const targets = safeFindThreads();
  if (!targets.length) return null;

  const path = e.composedPath();
  const direct = targets.find((t) => path.includes(t.element));
  if (direct) return direct;

  // composedPath misses rows when the click lands on a node that was replaced
  // mid-event (common in virtualized lists), so fall back to containment.
  const node = e.target as Node | null;
  return node ? targets.find((t) => t.element.contains(node)) ?? null : null;
}

/**
 * Alt/Option + press on a conversation box.
 *
 * Opens the picker on pointerdown (the earliest moment) and swallows every
 * other event of the same gesture so the site never sees it. Clicks that land
 * inside our own picker are left alone.
 */
let altGestureAt = 0;
function onAltGesture(e: Event) {
  const me = e as MouseEvent;
  if (!me.altKey || dead) return;
  if ((e.target as Element | null)?.closest?.('#th-fab, #th-toast, #th-picker-host')) return;

  if (e.type === 'pointerdown') {
    if (me.button !== 0) return;
    const hit = rowUnder(me);
    if (!hit) return;
    altGestureAt = Date.now();
    e.preventDefault();
    e.stopImmediatePropagation();
    openPickerFor(hit, hit.element.getBoundingClientRect());
    return;
  }

  // Remaining events from the same gesture: swallow them.
  if (Date.now() - altGestureAt < 1500) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}

function openPickerFor(thread: ActiveThread, anchor: DOMRect) {
  if (!adapter) return;
  const { threadKey, label } = thread;
  const aliases = (thread.aliases ?? []).filter((a) => a !== threadKey);
  const current = lookup(threadKey, aliases) ?? null;

  // Remove colours stored under alternate keys so one conversation never ends
  // up with two competing assignments.
  const dropAliases = async () => {
    for (const alias of aliases) {
      if (!assignments.has(alias)) continue;
      assignments.delete(alias);
      try {
        await send({ type: 'CLEAR_ASSIGNMENT', platform: adapter!.platform, threadKey: alias });
      } catch {
        /* best effort */
      }
    }
  };

  picker.open({ threadKey, label, current, myUserId }, members, anchor, {
    async onApply({ color, memberId, note }) {
      await send({
        type: 'SET_ASSIGNMENT',
        platform: adapter!.platform,
        threadKey,
        threadLabel: label,
        color,
        memberId,
        note,
      });
      // Optimistic local update so the row recolors instantly.
      assignments.set(threadKey, {
        threadKey,
        platform: adapter!.platform,
        color,
        label,
        note,
        memberName: members.find((m) => m.id === memberId)?.display_name ?? null,
      });
      await dropAliases();
      repaint();
      toast('Color saved and shared with your team');
    },
    async onClear() {
      await send({ type: 'CLEAR_ASSIGNMENT', platform: adapter!.platform, threadKey });
      assignments.delete(threadKey);
      await dropAliases();
      repaint();
      toast('Color removed');
    },
    onOpenOptions() {
      void send({ type: 'OPEN_OPTIONS' });
    },
  });
}

/* ---------------------------------------------------------------------- toast */

let toastEl: HTMLDivElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(message: string, isError = false) {
  if (!toastEl?.isConnected) {
    toastEl = document.createElement('div');
    toastEl.id = 'th-toast';
    toastEl.innerHTML = '<span class="th-toast-dot"></span><span class="th-toast-text"></span>';
    document.documentElement.appendChild(toastEl);
  }
  toastEl.classList.toggle('th-error', isError);
  toastEl.querySelector('.th-toast-text')!.textContent = message;

  requestAnimationFrame(() => toastEl?.classList.add('th-show'));
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl?.classList.remove('th-show');
    setTimeout(() => {
      if (!toastEl?.classList.contains('th-show')) {
        toastEl?.remove();
        toastEl = null;
      }
    }, 300);
  }, 2600);
}

/* ------------------------------------------------------------------ observers */

function startObserving() {
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    // Ignore mutations we caused ourselves to avoid an infinite paint loop.
    const relevant = mutations.some((m) => {
      const t = m.target as HTMLElement;
      if (t?.classList?.contains('th-chip')) return false;

      if (m.type === 'attributes') {
        const name = m.attributeName ?? '';
        // Our own bookkeeping attributes never warrant a repaint.
        if (name.startsWith('data-th')) return false;

        // `class`/`style` DO matter: Gmail and other SPA inboxes rewrite them a
        // few seconds after load (read/unread churn, virtualization) and strip
        // our paint. But we set them ourselves too, so only react when the row
        // has actually lost its styling — otherwise we ping-pong forever.
        if (name === 'class' || name === 'style') {
          return (
            t.hasAttribute?.('data-th-key') === true &&
            (!t.classList.contains('th-painted') || t.style.getPropertyValue('--th-color') === '')
          );
        }
        return true;
      }
      return true;
    });
    if (relevant) repaintSoon();
  });

  const roots = adapter?.observeRoots?.() ?? [];
  const targets = roots.length ? roots : [document.body];
  for (const root of targets) {
    observer.observe(root, {
      childList: true,
      subtree: true,
      // Required to notice host re-renders that clobber our classes/variables.
      attributes: true,
      attributeFilter: ['class', 'style', 'data-legacy-thread-id', 'data-convid', 'href'],
    });
  }
}

/** SPA route changes (Instagram/Gmail/Voice all use pushState). */
function watchNavigation() {
  let lastUrl = location.href;
  const check = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    // The new view's DOM lands a beat later.
    setTimeout(() => {
      startObserving();
      repaint();
    }, 350);
  };

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<typeof original>) {
      const result = original.apply(this, args);
      queueMicrotask(check);
      return result;
    };
  }
  window.addEventListener('popstate', check);
  window.addEventListener('hashchange', check);
  setInterval(check, 1500);
}

/* ----------------------------------------------------------------------- boot */

function applyState(payload: {
  assignments: AssignmentLite[];
  settings: Settings;
  members: Member[];
  signedIn: boolean;
  userId?: string | null;
}) {
  const next = new Map<string, AssignmentLite>();
  for (const a of payload.assignments) {
    if (a.platform === adapter?.platform) next.set(a.threadKey, a);
  }
  assignments = next;
  // Re-enabled from the popup → bring it back in its default, easy-to-find corner.
  if (settings.showFab === false && payload.settings.showFab !== false) resetFabPosition();
  settings = { ...DEFAULT_SETTINGS, ...payload.settings };
  members = payload.members;
  signedIn = payload.signedIn;
  if (payload.userId !== undefined) myUserId = payload.userId;
  repaint();
}

async function boot() {
  try {
    const state = await send<{
      assignments: AssignmentLite[];
      settings: Settings;
      members: Member[];
      auth: { status: string; userId?: string | null };
    }>({ type: 'GET_STATE' });

    applyState({
      assignments: state.assignments,
      settings: state.settings,
      members: state.members,
      signedIn: state.auth.status === 'signed-in',
      userId: state.auth.userId ?? null,
    });
  } catch (err) {
    if (isContextInvalidated(err)) {
      shutdown();
      return;
    }
    console.warn('[TeamHue] could not load state:', errorMessage(err));
  }

  chrome.runtime.onMessage.addListener((msg: BroadcastMessage) => {
    if (msg?.type === 'TH_UPDATE') {
      applyState({
        assignments: msg.assignments,
        settings: msg.settings,
        members: msg.members,
        signedIn: msg.signedIn,
        userId: msg.userId,
      });
    }
  });

  // Alt/Option+click is handled on pointerdown at the WINDOW capture phase —
  // before Instagram/Gmail/Voice handlers see the press — so the site can't
  // navigate or swallow the gesture first. The rest of the gesture
  // (mousedown/up, click) is then suppressed.
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
    window.addEventListener(type, onAltGesture, true);
  }
  // A newer copy of TeamHue (after an extension update) tells this one to stop.
  document.dispatchEvent(new CustomEvent('teamhue:takeover'));
  document.addEventListener('teamhue:takeover', shutdown, { once: true });
  window.addEventListener('scroll', repaintSoon, { passive: true, capture: true });
  window.addEventListener('resize', repaintSoon, { passive: true });

  startObserving();
  watchNavigation();
  repaint();

  // Virtualized lists settle asynchronously; a few extra passes guarantee the
  // first paint is complete even on a cold, slow load.
  [400, 1000, 2500].forEach((ms) => setTimeout(() => repaint(), ms));

  // Diagnostic. Content scripts run in an isolated world, so this is NOT on the
  // page's `window` — in DevTools you must switch the console context dropdown
  // from `top` to `TeamHue` to call it. Because that's easy to miss, we also
  // print a summary automatically on boot (see below).
  (window as unknown as Record<string, unknown>).__teamhue = diagnose;

  // Auto-report once the list has settled, so the common failure modes
  // (no rows detected / not signed in) are visible without any console gymnastics.
  setTimeout(() => {
    if (dead) return;
    const found = safeFindThreads();
    if (found.length === 0 || !signedIn) diagnose();
  }, 3000);
}

/** Row lookup that never throws, for diagnostics and event handlers. */
function safeFindThreads(): ThreadTarget[] {
  try {
    return adapter?.findThreads() ?? [];
  } catch {
    return [];
  }
}

/** Prints everything needed to tell detection / auth / painting failures apart. */
function diagnose(): ThreadTarget[] {
  const found = safeFindThreads();
  console.log(
    `%c TeamHue %c v${chrome.runtime?.getManifest?.().version ?? '?'} diagnostics`,
    'background:#6366f1;color:#fff;border-radius:3px;padding:1px 4px',
    'color:inherit',
  );
  console.log('platform        :', adapter?.platform ?? '(no adapter — unsupported page)');
  console.log('url             :', location.href);
  console.log('signed in       :', signedIn);
  console.log('enabled here    :', enabledHere());
  console.log('assignments     :', assignments.size);
  console.log('rows detected   :', found.length);

  if (found.length) {
    console.table(
      found.slice(0, 20).map((t) => {
        const r = t.element.getBoundingClientRect();
        const painted = t.element.classList.contains('th-painted');
        return {
          key: t.threadKey,
          label: t.label,
          size: `${Math.round(r.width)}×${Math.round(r.height)}`,
          hasColor: assignments.has(t.threadKey),
          painted,
        };
      }),
    );
  } else if (adapter?.platform === 'instagram') {
    // Narrow down *why* nothing matched on Instagram specifically.
    console.warn(
      'No rows matched. Raw anchor count:',
      document.querySelectorAll('a[href*="/direct/t/"]').length,
    );
  }

  if (!signedIn) console.warn('Not signed in — open the TeamHue popup and sign in first.');
  return found;
}

// Start only on supported sites. Declared last so every binding above is
// initialized before `boot()` runs (no temporal-dead-zone hazards).
if (adapter) void boot();
