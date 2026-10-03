import { activeAdapter, type Adapter, type ThreadTarget } from './adapters';
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
    document.removeEventListener('click', onPageClick, true);
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
    const assignment = assignments.get(target.threadKey);
    if (!assignment) continue;
    paint(target, assignment, settings);
    stillPainted.add(target.element);
  }

  reconcile(stillPainted);
  updateFab(currentThread());
});

const repaintSoon = debounce(() => repaint(), 60);

/* ----------------------------------------------------------------- active FAB */

function currentThread(): { threadKey: string; label: string | null } | null {
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
  fab.innerHTML = FAB_ICON;
  fab.setAttribute('aria-label', 'Set TeamHue color for this conversation');
  fab.title = 'TeamHue — set color for this conversation';
  fab.addEventListener('click', onFabClick);
  document.documentElement.appendChild(fab);
  return fab;
}

function updateFab(thread: { threadKey: string; label: string | null } | null) {
  if (!thread || !enabledHere()) {
    fab?.remove();
    fab = null;
    return;
  }
  const el = ensureFab();
  const current = assignments.get(thread.threadKey);
  if (current) {
    el.dataset.thActive = '1';
    el.style.setProperty('--th-fab-color', current.color);
    el.title = `TeamHue — ${current.memberName ?? 'Assigned'}${current.note ? ` · ${current.note}` : ''}`;
  } else {
    delete el.dataset.thActive;
    el.title = 'TeamHue — set color for this conversation';
  }
}

async function onFabClick(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const thread = currentThread();
  if (!thread || !adapter) return;
  openPickerFor(thread.threadKey, thread.label, (e.currentTarget as HTMLElement).getBoundingClientRect());
}

/* ---------------------------------------------------------------- interaction */

/** Resolves the conversation row under a pointer event, if any. */
function rowUnder(e: MouseEvent): ThreadTarget | null {
  if (!adapter || !enabledHere()) return null;

  let targets: ThreadTarget[];
  try {
    targets = adapter.findThreads();
  } catch {
    return null;
  }

  const path = e.composedPath();
  const direct = targets.find((t) => path.includes(t.element));
  if (direct) return direct;

  // composedPath misses rows when the click lands on a node that was replaced
  // mid-event (common in virtualized lists), so fall back to containment.
  const node = e.target as Node | null;
  return node ? targets.find((t) => t.element.contains(node)) ?? null : null;
}

/** Alt/Option + click any conversation row opens the picker for that row. */
function onPageClick(e: MouseEvent) {
  if (!e.altKey) return;
  const hit = rowUnder(e);
  if (!hit) return;

  e.preventDefault();
  e.stopPropagation();
  openPickerFor(hit.threadKey, hit.label, hit.element.getBoundingClientRect());
}

/**
 * Right-click a conversation row to colour it.
 *
 * Alt+Click alone was undiscoverable — on an inbox with no assignments yet
 * there was no visible way in, which made the extension look broken. The
 * context menu is the affordance people reach for instinctively.
 */
function onContextMenu(e: MouseEvent) {
  const hit = rowUnder(e);
  if (!hit) return;

  e.preventDefault();
  e.stopPropagation();
  openPickerFor(hit.threadKey, hit.label, hit.element.getBoundingClientRect());
}

function openPickerFor(threadKey: string, label: string | null, anchor: DOMRect) {
  if (!adapter) return;
  const current = assignments.get(threadKey) ?? null;

  picker.open({ threadKey, label, current }, members, anchor, {
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
      repaint();
      toast('Color saved and shared with your team');
    },
    async onClear() {
      await send({ type: 'CLEAR_ASSIGNMENT', platform: adapter!.platform, threadKey });
      assignments.delete(threadKey);
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
}) {
  const next = new Map<string, AssignmentLite>();
  for (const a of payload.assignments) {
    if (a.platform === adapter?.platform) next.set(a.threadKey, a);
  }
  assignments = next;
  settings = payload.settings;
  members = payload.members;
  signedIn = payload.signedIn;
  repaint();
}

async function boot() {
  try {
    const state = await send<{
      assignments: AssignmentLite[];
      settings: Settings;
      members: Member[];
      auth: { status: string };
    }>({ type: 'GET_STATE' });

    applyState({
      assignments: state.assignments,
      settings: state.settings,
      members: state.members,
      signedIn: state.auth.status === 'signed-in',
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
      });
    }
  });

  document.addEventListener('click', onPageClick, true);
  document.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('scroll', repaintSoon, { passive: true, capture: true });
  window.addEventListener('resize', repaintSoon, { passive: true });

  startObserving();
  watchNavigation();
  repaint();

  // Virtualized lists settle asynchronously; a few extra passes guarantee the
  // first paint is complete even on a cold, slow load.
  [400, 1000, 2500].forEach((ms) => setTimeout(() => repaint(), ms));

  // Diagnostic hook: run `__teamhue()` in the page console to see exactly what
  // the adapter detects. Invaluable when a site changes its markup.
  (window as unknown as Record<string, unknown>).__teamhue = () => {
    const found = adapter?.findThreads() ?? [];
    console.log('[TeamHue] platform:', adapter?.platform);
    console.log('[TeamHue] signed in:', signedIn, '| enabled here:', enabledHere());
    console.log('[TeamHue] rows detected:', found.length);
    console.table(
      found.slice(0, 20).map((t) => ({
        key: t.threadKey,
        label: t.label,
        size: `${Math.round(t.element.getBoundingClientRect().width)}×${Math.round(
          t.element.getBoundingClientRect().height,
        )}`,
      })),
    );
    console.log('[TeamHue] assignments loaded:', assignments.size);
    return found;
  };
}

// Start only on supported sites. Declared last so every binding above is
// initialized before `boot()` runs (no temporal-dead-zone hazards).
if (adapter) void boot();
