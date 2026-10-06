import { useEffect, useMemo, useState } from 'react';
import { send } from '@/shared/messaging';
import { PLATFORM_LABELS, type Platform } from '@/shared/types';
import { Alert, Avatar, Brand, Empty, Spinner, Toggle } from '@/ui/components';
import { useAction, useAppState } from '@/ui/hooks';
import { AuthPanel, WorkspaceGate } from '@/ui/Auth';
import { timeAgo } from '@/shared/util';

/** Detects which supported site the active tab is on, if any. */
function usePlatformOfActiveTab(): { platform: Platform | null; host: string | null } {
  const [info, setInfo] = useState<{ platform: Platform | null; host: string | null }>({
    platform: null,
    host: null,
  });

  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.url) return;
      let host = '';
      try {
        host = new URL(tab.url).hostname;
      } catch {
        return;
      }
      const platform: Platform | null = /instagram\.com$/.test(host)
        ? 'instagram'
        : host === 'voice.google.com'
          ? 'googlevoice'
          : host === 'mail.google.com'
            ? 'gmail'
            : /^outlook\./.test(host)
              ? 'outlook'
              : null;
      setInfo({ platform, host });
    });
  }, []);

  return info;
}

export function Popup() {
  const { state, loading, refresh } = useAppState();
  const { busy, error, run } = useAction();
  const { platform, host } = usePlatformOfActiveTab();

  const signedIn = state.auth.status === 'signed-in';
  const hasWorkspace = Boolean(state.auth.workspace);

  const recent = useMemo(
    () => state.assignments.slice().sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '')),
    [state.assignments],
  );

  if (!state.configured) {
    return (
      <div className="popup">
        <div className="popup-header">
          <Brand />
        </div>
        <div className="popup-body">
          <Alert kind="error">
            TeamHue isn't connected to a database yet. Add your Supabase URL and anon key to{' '}
            <code>.env</code> and rebuild the extension.
          </Alert>
          <p className="small muted">See the README for the 3-minute setup.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="popup">
        <div className="popup-header">
          <Brand />
        </div>
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="popup">
        <AuthPanel compact onDone={refresh} />
      </div>
    );
  }

  if (!hasWorkspace) {
    return (
      <div className="popup">
        <div className="popup-header">
          <Brand subtitle={state.auth.email ?? undefined} />
        </div>
        <div className="popup-body">
          <WorkspaceGate auth={state.auth} onDone={refresh} />
        </div>
      </div>
    );
  }

  const { settings } = state;

  return (
    <div className="popup">
      <div className="popup-header">
        <Brand subtitle={state.auth.workspace?.name} />
        <Toggle
          checked={settings.enabled}
          label="Enable TeamHue"
          onChange={(next) => void run(() => send({ type: 'SET_SETTINGS', settings: { enabled: next } }).then(() => {}))}
        />
      </div>

      <div className="popup-body">
        <Alert kind="error">{error}</Alert>

        {/* Context for the current tab */}
        {platform ? (
          <div className="hero" style={{ marginBottom: 14 }}>
            <div className="hero-platform">{PLATFORM_LABELS[platform]}</div>
            <div className="hero-title">
              {settings.enabled && settings.platforms[platform] ? 'Color coding is on' : 'Paused here'}
            </div>
            <div className="small muted" style={{ marginTop: 5, lineHeight: 1.45 }}>
              Hold <strong>Option/Alt</strong> and click any conversation to set its color — or use
              the floating button inside an open chat.
            </div>
          </div>
        ) : (
          <div className="hero" style={{ marginBottom: 14, ['--hero-color' as string]: 'var(--fg-subtle)' }}>
            <div className="hero-platform">Not a supported page</div>
            <div className="hero-title">Open Instagram, Google Voice or Gmail</div>
            {host && (
              <div className="small muted truncate" style={{ marginTop: 4 }}>
                You're on {host}
              </div>
            )}
          </div>
        )}

        {/* Per-platform toggles */}
        <div className="section-label">Active on</div>
        <div className="platform-chips" style={{ marginBottom: 16 }}>
          {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
            <button
              key={p}
              type="button"
              className="platform-chip"
              aria-pressed={settings.platforms[p]}
              onClick={() =>
                void run(() =>
                  send({
                    type: 'SET_SETTINGS',
                    settings: { platforms: { ...settings.platforms, [p]: !settings.platforms[p] } },
                  }).then(() => {}),
                )
              }
            >
              <span className="dot" />
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Floating paintbrush */}
        <div className="row spread" style={{ marginBottom: 16, gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 550 }}>Floating paintbrush</div>
            <div className="small muted">Drag it anywhere · hover and click × to hide</div>
          </div>
          <Toggle
            checked={settings.showFab !== false}
            label="Show floating paintbrush"
            onChange={(next) =>
              void run(() => send({ type: 'SET_SETTINGS', settings: { showFab: next } }).then(() => {}))
            }
          />
        </div>

        {/* Assignments */}
        <div className="row spread" style={{ marginBottom: 8 }}>
          <span className="section-label" style={{ margin: 0 }}>
            Color-coded ({recent.length})
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => void run(() => send({ type: 'FORCE_SYNC' }).then(() => {}))}
          >
            {busy ? 'Syncing…' : 'Sync'}
          </button>
        </div>

        {recent.length === 0 ? (
          <Empty
            icon="🎨"
            title="No conversations colored yet"
            body="Option-click a conversation on any supported site to assign it a color."
          />
        ) : (
          <div className="assign-list">
            {recent.map((a) => (
              <div className="assign-item" key={`${a.platform}:${a.threadKey}`}>
                <span className="assign-bar" style={{ ['--c' as string]: a.color }} />
                <div className="grow">
                  <div className="truncate" style={{ fontSize: 13, fontWeight: 550 }}>
                    {a.label ?? a.threadKey}
                  </div>
                  <div className="tiny muted truncate">
                    {PLATFORM_LABELS[a.platform]}
                    {a.memberName ? ` · ${a.memberName}` : ''}
                    {a.note ? ` · ${a.note}` : ''}
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-sm assign-remove"
                  title="Remove color"
                  aria-label={`Remove color from ${a.label ?? a.threadKey}`}
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      send({
                        type: 'CLEAR_ASSIGNMENT',
                        platform: a.platform,
                        threadKey: a.threadKey,
                      }).then(() => {}),
                    )
                  }
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Team */}
        {state.members.length > 0 && (
          <>
            <hr className="divider" />
            <div className="section-label">Team</div>
            <div className="row wrap" style={{ gap: 7 }}>
              {state.members.map((m) => (
                <div className="row" key={m.id} style={{ gap: 6 }}>
                  <Avatar name={m.display_name} color={m.color} />
                  <span className="small truncate" style={{ maxWidth: 92 }}>
                    {m.display_name}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="popup-footer">
        <span className="tiny subtle grow">Synced {timeAgo(state.lastSync)}</span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void chrome.runtime.openOptionsPage()}
        >
          Settings
        </button>
      </div>
    </div>
  );
}
