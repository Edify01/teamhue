import { getSupabase, friendlyError, isConfigured } from './supabase';
import {
  broadcast,
  clearAssignment,
  getState,
  hydrate,
  loadWorkspace,
  refreshAuthFromSession,
  setAssignment,
  signOutLocal,
  syncAll,
  updateSettings,
} from './state';
import type { Request, Response, StatePayload } from '@/shared/messaging';
import { SYNC_INTERVAL_MINUTES } from '@/shared/config';
import { errorMessage } from '@/shared/util';
import type { Member, Workspace } from '@/shared/types';

/**
 * TeamHue background service worker.
 *
 * Every privileged operation (network, auth, database) happens here — content
 * scripts are deliberately powerless, which keeps the attack surface tiny and
 * means no credentials ever touch Instagram/Gmail/Voice pages.
 */

const ALARM_SYNC = 'th-sync';

/* ------------------------------------------------------------------ handlers */

async function handle(req: Request): Promise<unknown> {
  await hydrate();

  switch (req.type) {
    case 'GET_STATE': {
      const s = getState();
      const payload: StatePayload = {
        auth: s.auth,
        settings: s.settings,
        members: s.members,
        assignments: s.assignments,
        configured: isConfigured(),
        lastSync: s.lastSync,
      };
      return payload;
    }

    case 'SIGN_IN': {
      const { data, error } = await getSupabase().auth.signInWithPassword({
        email: req.email.trim(),
        password: req.password,
      });
      if (error) throw new Error(friendlyError(error));
      await refreshAuthFromSession(data.session);
      return getState().auth;
    }

    case 'SIGN_UP': {
      const { data, error } = await getSupabase().auth.signUp({
        email: req.email.trim(),
        password: req.password,
        options: { data: { display_name: req.displayName.trim() } },
      });
      if (error) throw new Error(friendlyError(error));

      if (!data.session) {
        // Email confirmation is enabled on the project.
        throw new Error('Check your inbox to confirm your email, then sign in.');
      }
      await refreshAuthFromSession(data.session);
      return getState().auth;
    }

    case 'SIGN_OUT': {
      try {
        await getSupabase().auth.signOut();
      } catch {
        /* sign out locally regardless */
      }
      await signOutLocal();
      return { ok: true };
    }

    case 'CREATE_WORKSPACE': {
      const { data, error } = await getSupabase().rpc('create_workspace', {
        p_name: req.name.trim(),
        p_display_name: req.displayName.trim(),
      });
      if (error) throw new Error(friendlyError(error));
      await loadWorkspace();
      return data as Workspace;
    }

    case 'JOIN_WORKSPACE': {
      const { data, error } = await getSupabase().rpc('join_workspace', {
        p_join_code: req.joinCode.trim().toUpperCase(),
        p_display_name: req.displayName.trim(),
      });
      if (error) throw new Error(friendlyError(error));
      await loadWorkspace();
      return data as Workspace;
    }

    case 'LEAVE_WORKSPACE': {
      const s = getState();
      if (!s.auth.member) throw new Error('You are not in a workspace.');
      const { error } = await getSupabase().from('members').delete().eq('id', s.auth.member.id);
      if (error) throw new Error(friendlyError(error));
      await loadWorkspace();
      return { ok: true };
    }

    case 'LIST_MEMBERS': {
      await syncAll();
      return getState().members;
    }

    case 'UPDATE_MEMBER': {
      const patch: Partial<Member> = {};
      if (req.displayName !== undefined) patch.display_name = req.displayName.trim();
      if (req.color !== undefined) patch.color = req.color.toLowerCase();

      const { error } = await getSupabase().from('members').update(patch).eq('id', req.memberId);
      if (error) throw new Error(friendlyError(error));
      await loadWorkspace();
      return getState().members;
    }

    case 'REMOVE_MEMBER': {
      const { error } = await getSupabase().from('members').delete().eq('id', req.memberId);
      if (error) throw new Error(friendlyError(error));
      await syncAll();
      return getState().members;
    }

    case 'LIST_ASSIGNMENTS': {
      await syncAll();
      return getState().assignments;
    }

    case 'SET_ASSIGNMENT': {
      await setAssignment(req);
      return getState().assignments;
    }

    case 'CLEAR_ASSIGNMENT': {
      await clearAssignment(req.platform, req.threadKey);
      return getState().assignments;
    }

    case 'GET_SETTINGS':
      return getState().settings;

    case 'SET_SETTINGS':
      return updateSettings(req.settings);

    case 'FORCE_SYNC': {
      await syncAll();
      return getState().lastSync;
    }

    case 'OPEN_OPTIONS': {
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    }

    default: {
      const never: never = req;
      throw new Error(`Unknown request: ${JSON.stringify(never)}`);
    }
  }
}

/* ------------------------------------------------------------------ wiring */

chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
  // Ignore our own broadcasts.
  if ((req as unknown as { type: string })?.type === 'TH_UPDATE') return false;

  handle(req)
    .then((data) => sendResponse({ ok: true, data } satisfies Response))
    .catch((err) => sendResponse({ ok: false, error: errorMessage(err) } satisfies Response));

  return true; // keep the message channel open for the async response
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await hydrate();
  await bootstrap();

  if (details.reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html?welcome=1') });
  }

  chrome.alarms.create(ALARM_SYNC, { periodInMinutes: SYNC_INTERVAL_MINUTES });
});

chrome.runtime.onStartup.addListener(async () => {
  await hydrate();
  await bootstrap();
  chrome.alarms.create(ALARM_SYNC, { periodInMinutes: SYNC_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_SYNC) return;
  await hydrate();
  if (getState().auth.workspace) {
    await syncAll().catch(() => {});
  }
});

/** Re-establishes session + realtime after the worker is revived. */
async function bootstrap() {
  if (!isConfigured()) {
    await broadcast();
    return;
  }

  try {
    const { data } = await getSupabase().auth.getSession();
    await refreshAuthFromSession(data.session);
  } catch (err) {
    console.warn('[TeamHue] bootstrap failed:', errorMessage(err));
    await broadcast();
  }
}

// Keep local state in lockstep with Supabase auth events (token refresh, etc.).
if (isConfigured()) {
  getSupabase().auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      void signOutLocal();
    } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      void refreshAuthFromSession(session).catch(() => {});
    }
  });
}

// Run immediately on worker spin-up too (covers reloads during development).
void (async () => {
  await hydrate();
  await bootstrap();
})();
