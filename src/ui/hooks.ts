import { useCallback, useEffect, useRef, useState } from 'react';
import { send, type StatePayload } from '@/shared/messaging';
import { DEFAULT_SETTINGS, type AuthState } from '@/shared/types';
import { errorMessage } from '@/shared/util';

const EMPTY: StatePayload = {
  auth: { status: 'signed-out', userId: null, email: null, workspace: null, member: null },
  settings: DEFAULT_SETTINGS,
  members: [],
  assignments: [],
  configured: true,
  lastSync: null,
};

/**
 * Subscribes a React surface to the background worker's state.
 * Automatically re-renders whenever a teammate changes something (via the
 * `TH_UPDATE` broadcast), so the popup and options page are always live.
 */
export function useAppState() {
  const [state, setState] = useState<StatePayload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await send<StatePayload>({ type: 'GET_STATE' });
      if (mounted.current) {
        setState(data);
        setError(null);
      }
    } catch (err) {
      if (mounted.current) setError(errorMessage(err));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();

    const listener = (msg: { type?: string }) => {
      if (msg?.type === 'TH_UPDATE') void refresh();
    };
    chrome.runtime.onMessage.addListener(listener);

    return () => {
      mounted.current = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [refresh]);

  return { state, loading, error, refresh, setError };
}

/** Wraps an async action with busy + error handling so every button behaves. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<void>, successMessage?: string) => {
      setBusy(true);
      setError(null);
      setSuccess(null);
      try {
        await fn();
        if (successMessage) {
          setSuccess(successMessage);
          setTimeout(() => setSuccess(null), 3000);
        }
        return true;
      } catch (err) {
        setError(errorMessage(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { busy, error, success, setError, setSuccess, run };
}

export function isReady(auth: AuthState): boolean {
  return auth.status === 'signed-in' && auth.workspace !== null;
}
