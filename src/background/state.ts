import { getSupabase, friendlyError, isConfigured } from './supabase';
import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type Assignment,
  type AssignmentLite,
  type AuthState,
  type Member,
  type Platform,
  type Settings,
  type Workspace,
} from '@/shared/types';
import type { BroadcastMessage } from '@/shared/messaging';
import { colorFromString } from '@/shared/color';

/**
 * Single source of truth for the whole extension.
 *
 * The MV3 service worker is killed aggressively, so every piece of state is
 * mirrored into `chrome.storage.local`. On wake we rehydrate from storage first
 * (instant, works offline) and then reconcile against Supabase in the
 * background. Content scripts therefore never wait on the network.
 */

export interface AppState {
  auth: AuthState;
  settings: Settings;
  members: Member[];
  assignments: AssignmentLite[];
  lastSync: number | null;
}

const blankAuth: AuthState = {
  status: 'signed-out',
  userId: null,
  email: null,
  workspace: null,
  member: null,
};

let state: AppState = {
  auth: blankAuth,
  settings: DEFAULT_SETTINGS,
  members: [],
  assignments: [],
  lastSync: null,
};

let hydrated = false;
let channel: RealtimeChannel | null = null;

/* ----------------------------------------------------------------- hydration */

export async function hydrate(): Promise<AppState> {
  if (hydrated) return state;

  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.auth,
    STORAGE_KEYS.settings,
    STORAGE_KEYS.cache,
    STORAGE_KEYS.members,
    STORAGE_KEYS.lastSync,
  ]);

  state.settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.settings] ?? {}) };
  state.settings.platforms = {
    ...DEFAULT_SETTINGS.platforms,
    ...(stored[STORAGE_KEYS.settings]?.platforms ?? {}),
  };
  state.auth = { ...blankAuth, ...(stored[STORAGE_KEYS.auth] ?? {}) };
  state.members = stored[STORAGE_KEYS.members] ?? [];
  state.assignments = stored[STORAGE_KEYS.cache]?.assignments ?? [];
  state.lastSync = stored[STORAGE_KEYS.lastSync] ?? null;

  hydrated = true;
  return state;
}

export function getState(): AppState {
  return state;
}

async function persist() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.auth]: state.auth,
    [STORAGE_KEYS.settings]: state.settings,
    [STORAGE_KEYS.members]: state.members,
    [STORAGE_KEYS.cache]: { assignments: state.assignments, updatedAt: Date.now() },
    [STORAGE_KEYS.lastSync]: state.lastSync,
  });
}

/* ----------------------------------------------------------------- broadcast */

/** Pushes the current state to every content script and extension page. */
export async function broadcast() {
  await persist();

  const msg: BroadcastMessage = {
    type: 'TH_UPDATE',
    assignments: state.assignments,
    settings: state.settings,
    members: state.members,
    signedIn: state.auth.status === 'signed-in',
    userId: state.auth.userId,
  };

  // Extension pages (popup / options).
  chrome.runtime.sendMessage(msg).catch(() => {
    /* no listener open — fine */
  });

  // Content scripts.
  const tabs = await chrome.tabs.query({
    url: [
      'https://www.instagram.com/*',
      'https://instagram.com/*',
      'https://voice.google.com/*',
      'https://mail.google.com/*',
      'https://outlook.live.com/*',
      'https://outlook.office.com/*',
      'https://outlook.office365.com/*',
    ],
  });

  await Promise.all(
    tabs.map((tab) =>
      tab.id !== undefined
        ? chrome.tabs.sendMessage(tab.id, msg).catch(() => {
            /* tab not ready — it will pull on load */
          })
        : Promise.resolve(),
    ),
  );

  updateBadge();
}

function updateBadge() {
  const signedIn = state.auth.status === 'signed-in';
  const on = signedIn && state.settings.enabled;
  chrome.action.setBadgeBackgroundColor({ color: on ? '#6366f1' : '#9ca3af' }).catch(() => {});
  chrome.action.setBadgeText({ text: on ? '' : signedIn ? 'off' : '!' }).catch(() => {});
  chrome.action
    .setTitle({
      title: signedIn
        ? on
          ? `TeamHue — ${state.assignments.length} conversation${state.assignments.length === 1 ? '' : 's'} color-coded`
          : 'TeamHue — paused'
        : 'TeamHue — sign in to get started',
    })
    .catch(() => {});
}

/* ---------------------------------------------------------------------- auth */

function toLite(rows: Assignment[], members: Member[]): AssignmentLite[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  return rows.map((r) => ({
    threadKey: r.thread_key,
    platform: r.platform,
    color: r.color,
    label: r.thread_label,
    note: r.note,
    memberName: r.member_id ? (byId.get(r.member_id)?.display_name ?? null) : null,
  }));
}

export async function refreshAuthFromSession(session: Session | null): Promise<void> {
  if (!session?.user) {
    state.auth = blankAuth;
    state.members = [];
    state.assignments = [];
    await stopRealtime();
    await broadcast();
    return;
  }

  state.auth = {
    ...state.auth,
    status: 'signed-in',
    userId: session.user.id,
    email: session.user.email ?? null,
  };

  await loadWorkspace();
}

/** Finds the user's workspace membership and pulls all team data. */
export async function loadWorkspace(): Promise<void> {
  const supabase = getSupabase();
  const userId = state.auth.userId;
  if (!userId) return;

  const { data: memberRows, error: memberErr } = await supabase
    .from('members')
    .select('*, workspaces(*)')
    .eq('user_id', userId)
    .limit(1);

  if (memberErr) throw new Error(friendlyError(memberErr));

  const row = memberRows?.[0] as (Member & { workspaces: Workspace }) | undefined;
  if (!row) {
    // Signed in but not in a workspace yet — the UI will prompt to create/join.
    state.auth.workspace = null;
    state.auth.member = null;
    state.members = [];
    state.assignments = [];
    await broadcast();
    return;
  }

  const { workspaces, ...member } = row;
  state.auth.workspace = workspaces;
  state.auth.member = member;

  await syncAll();
  await startRealtime(workspaces.id);
}

/** Full pull of members + assignments for the active workspace. */
export async function syncAll(): Promise<void> {
  const ws = state.auth.workspace;
  if (!ws) return;

  const supabase = getSupabase();

  const [membersRes, assignRes] = await Promise.all([
    supabase.from('members').select('*').eq('workspace_id', ws.id).order('created_at'),
    supabase.from('assignments').select('*').eq('workspace_id', ws.id),
  ]);

  if (membersRes.error) throw new Error(friendlyError(membersRes.error));
  if (assignRes.error) throw new Error(friendlyError(assignRes.error));

  state.members = (membersRes.data ?? []) as Member[];
  state.assignments = toLite((assignRes.data ?? []) as Assignment[], state.members);
  state.lastSync = Date.now();

  await broadcast();
}

/* ------------------------------------------------------------------ realtime */

export async function startRealtime(workspaceId: string): Promise<void> {
  await stopRealtime();
  const supabase = getSupabase();

  channel = supabase
    .channel(`th:${workspaceId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'assignments', filter: `workspace_id=eq.${workspaceId}` },
      () => {
        // A teammate changed something — pull the authoritative set.
        void syncAll().catch(() => {});
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'members', filter: `workspace_id=eq.${workspaceId}` },
      () => {
        void syncAll().catch(() => {});
      },
    )
    .subscribe();
}

export async function stopRealtime(): Promise<void> {
  if (!channel) return;
  try {
    await getSupabase().removeChannel(channel);
  } catch {
    /* ignore */
  }
  channel = null;
}

/* --------------------------------------------------------------- mutations */

export async function setAssignment(input: {
  platform: Platform;
  threadKey: string;
  threadLabel: string | null;
  color: string | null;
  memberId: string | null;
  note: string | null;
}): Promise<void> {
  const ws = state.auth.workspace;
  const userId = state.auth.userId;
  if (!ws || !userId) throw new Error('Sign in and join a workspace first.');

  const color =
    input.color ??
    state.members.find((m) => m.id === input.memberId)?.color ??
    colorFromString(input.threadKey);

  const supabase = getSupabase();
  const { error } = await supabase.from('assignments').upsert(
    {
      workspace_id: ws.id,
      platform: input.platform,
      thread_key: input.threadKey,
      thread_label: input.threadLabel,
      color: color.toLowerCase(),
      member_id: input.memberId,
      note: input.note,
      updated_by: userId,
    },
    { onConflict: 'workspace_id,platform,thread_key' },
  );

  if (error) throw new Error(friendlyError(error));
  await syncAll();
}

export async function clearAssignment(platform: Platform, threadKey: string): Promise<void> {
  const ws = state.auth.workspace;
  if (!ws) throw new Error('Not signed in.');

  const { error } = await getSupabase()
    .from('assignments')
    .delete()
    .eq('workspace_id', ws.id)
    .eq('platform', platform)
    .eq('thread_key', threadKey);

  if (error) throw new Error(friendlyError(error));
  await syncAll();
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  state.settings = {
    ...state.settings,
    ...patch,
    platforms: { ...state.settings.platforms, ...(patch.platforms ?? {}) },
  };
  await broadcast();
  return state.settings;
}

export async function signOutLocal(): Promise<void> {
  await stopRealtime();
  state = {
    auth: blankAuth,
    settings: state.settings, // settings are device-local, keep them
    members: [],
    assignments: [],
    lastSync: null,
  };
  await chrome.storage.local.remove([
    STORAGE_KEYS.auth,
    STORAGE_KEYS.cache,
    STORAGE_KEYS.members,
    STORAGE_KEYS.lastSync,
  ]);
  await broadcast();
}

export { isConfigured };
