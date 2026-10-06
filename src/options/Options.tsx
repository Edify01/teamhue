import { useMemo, useState } from 'react';
import { send } from '@/shared/messaging';
import { PLATFORM_LABELS, type Member, type Platform, type Settings } from '@/shared/types';
import { initialsOf, readableTextOn, withAlpha } from '@/shared/color';
import { timeAgo } from '@/shared/util';
import { Alert, Avatar, Brand, Empty, SettingRow, Spinner, SwatchGrid, Toggle } from '@/ui/components';
import { useAction, useAppState } from '@/ui/hooks';
import { AuthPanel, WorkspaceGate } from '@/ui/Auth';

export function Options() {
  const { state, loading, refresh } = useAppState();
  const { busy, error, success, run } = useAction();
  const isWelcome = new URLSearchParams(location.search).get('welcome') === '1';

  const signedIn = state.auth.status === 'signed-in';
  const workspace = state.auth.workspace;
  const me = state.auth.member;
  const isAdmin = me?.role === 'owner' || me?.role === 'admin';

  if (!state.configured) {
    return (
      <div className="shell">
        <div className="page-header">
          <Brand />
        </div>
        <div className="panel">
          <div className="panel-title">Finish setup</div>
          <div className="panel-desc">
            TeamHue needs a Supabase project before it can sync colors across your team.
          </div>
          <ol className="steps" style={{ color: 'var(--fg)', paddingLeft: 18 }}>
            <li>
              Create a free project at <code>supabase.com</code>
            </li>
            <li>
              Run <code>supabase/schema.sql</code> in the SQL editor
            </li>
            <li>
              Copy <code>.env.example</code> to <code>.env</code> and paste your Project URL + anon
              key
            </li>
            <li>
              Run <code>npm run build</code> and reload the extension
            </li>
          </ol>
        </div>
      </div>
    );
  }

  if (loading) return <Spinner label="Loading your workspace…" />;

  if (!signedIn) {
    return (
      <div className="auth-shell">
        <div style={{ marginBottom: 20 }}>
          <Brand subtitle="Color-code your team's conversations" />
        </div>
        <AuthPanel onDone={refresh} />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="auth-shell">
        <div style={{ marginBottom: 20 }}>
          <Brand subtitle={state.auth.email ?? undefined} />
        </div>
        <WorkspaceGate auth={state.auth} onDone={refresh} />
      </div>
    );
  }

  const { settings } = state;
  const patch = (p: Partial<Settings>) =>
    void run(() => send({ type: 'SET_SETTINGS', settings: p }).then(() => {}));

  return (
    <div className="shell">
      <div className="page-header">
        <Brand subtitle={`${workspace.name} · ${state.auth.email ?? ''}`} />
        <div className="grow" />
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => void run(() => send({ type: 'FORCE_SYNC' }).then(() => {}), 'Synced')}
        >
          Sync now
        </button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() => void run(() => send({ type: 'SIGN_OUT' }).then(() => {}))}
        >
          Sign out
        </button>
      </div>

      {isWelcome && (
        <div className="welcome-banner">
          <h2>Welcome to TeamHue 🎨</h2>
          <div style={{ fontSize: 13.5, opacity: 0.95 }}>
            You're two steps from a color-coded inbox.
          </div>
          <ol className="steps">
            <li>Share your join code below with your teammates.</li>
            <li>
              Open Instagram, Google Voice or Gmail, then <strong>Option/Alt-click</strong> any
              conversation to assign a color.
            </li>
          </ol>
        </div>
      )}

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{success}</Alert>

      {/* ---------------------------------------------------------- Team */}
      <div className="panel">
        <div className="panel-title">Your team</div>
        <div className="panel-desc">
          Anyone with this code joins your workspace and instantly sees the same colors — even on a
          completely different Chrome profile or computer.
        </div>

        <div className="join-code" style={{ marginBottom: 18 }}>
          <div className="grow">
            <div className="tiny muted" style={{ marginBottom: 2 }}>
              JOIN CODE
            </div>
            <code>{workspace.join_code}</code>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() =>
              void run(
                () => navigator.clipboard.writeText(workspace.join_code),
                'Join code copied to clipboard',
              )
            }
          >
            Copy
          </button>
        </div>

        <div className="section-label">Members ({state.members.length})</div>
        {state.members.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            isMe={m.id === me?.id}
            canEdit={isAdmin || m.id === me?.id}
            canRemove={isAdmin && m.id !== me?.id && m.role !== 'owner'}
            onRefresh={refresh}
          />
        ))}
      </div>

      {/* ---------------------------------------------------- Appearance */}
      <div className="panel">
        <div className="panel-title">Appearance</div>
        <div className="panel-desc">
          These settings are personal to this device — they never change what your teammates see.
        </div>

        <div className="row" style={{ alignItems: 'flex-start', gap: 26 }}>
          <div className="grow">
            <SettingRow title="Enable TeamHue" description="Master switch for all sites">
              <Toggle
                checked={settings.enabled}
                label="Enable TeamHue"
                onChange={(enabled) => patch({ enabled })}
              />
            </SettingRow>

            <SettingRow title="Left accent bar" description="A colored stripe on each row">
              <Toggle
                checked={settings.showAccentBar}
                label="Show accent bar"
                onChange={(showAccentBar) => patch({ showAccentBar })}
              />
            </SettingRow>

            <SettingRow title="Owner initials" description="A small badge showing who owns it">
              <Toggle
                checked={settings.showInitials}
                label="Show initials"
                onChange={(showInitials) => patch({ showInitials })}
              />
            </SettingRow>

            <SettingRow
              title="Floating paintbrush"
              description="Draggable button inside open chats. Option/Alt+click always works."
            >
              <Toggle
                checked={settings.showFab !== false}
                label="Show floating paintbrush"
                onChange={(showFab) => patch({ showFab })}
              />
            </SettingRow>

            <div style={{ padding: '12px 0 4px' }}>
              <div className="row spread" style={{ marginBottom: 7 }}>
                <span style={{ fontSize: 13, fontWeight: 550 }}>Tint strength</span>
                <span className="small muted">{Math.round(settings.intensity * 100)}%</span>
              </div>
              <input
                className="slider"
                type="range"
                min={4}
                max={45}
                value={Math.round(settings.intensity * 100)}
                aria-label="Tint strength"
                onChange={(e) => patch({ intensity: Number(e.target.value) / 100 })}
              />
            </div>
          </div>

          <Preview settings={settings} members={state.members} />
        </div>

        <hr className="divider" />

        <div className="section-label">Active on these sites</div>
        {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
          <SettingRow key={p} title={PLATFORM_LABELS[p]}>
            <Toggle
              checked={settings.platforms[p]}
              label={`Enable on ${PLATFORM_LABELS[p]}`}
              onChange={(on) => patch({ platforms: { ...settings.platforms, [p]: on } })}
            />
          </SettingRow>
        ))}
      </div>

      {/* --------------------------------------------------- Assignments */}
      <div className="panel">
        <div className="row spread" style={{ marginBottom: 4 }}>
          <div>
            <div className="panel-title">Color-coded conversations</div>
            <div className="panel-desc" style={{ marginBottom: 0 }}>
              {state.assignments.length} shared across your team · synced {timeAgo(state.lastSync)}
            </div>
          </div>
        </div>

        {state.assignments.length === 0 ? (
          <Empty
            icon="🎨"
            title="Nothing color-coded yet"
            body="Option/Alt-click any conversation on Instagram, Google Voice or Gmail to assign it a color."
          />
        ) : (
          <table className="table" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Conversation</th>
                <th style={{ width: 120 }}>Site</th>
                <th style={{ width: 140 }}>Owner</th>
                <th style={{ width: 52 }} />
              </tr>
            </thead>
            <tbody>
              {state.assignments.map((a) => (
                <tr key={`${a.platform}:${a.threadKey}`}>
                  <td>
                    <span className="dot" style={{ ['--c' as string]: a.color }} />
                  </td>
                  <td>
                    <div className="truncate" style={{ fontWeight: 550, maxWidth: 280 }}>
                      {a.label ?? a.threadKey}
                    </div>
                    {a.note && <div className="tiny muted truncate">{a.note}</div>}
                  </td>
                  <td className="muted small">{PLATFORM_LABELS[a.platform]}</td>
                  <td className="small">{a.memberName ?? <span className="subtle">Unassigned</span>}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      aria-label={`Remove color from ${a.label ?? a.threadKey}`}
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ------------------------------------------------------- Danger */}
      <div className="panel">
        <div className="panel-title">Leave workspace</div>
        <div className="panel-desc">
          You'll stop seeing your team's colors on this account. Shared assignments stay with the
          team.
        </div>
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={() => {
            if (!confirm(`Leave "${workspace.name}"? You can rejoin with the code later.`)) return;
            void run(() => send({ type: 'LEAVE_WORKSPACE' }).then(() => {}));
          }}
        >
          Leave {workspace.name}
        </button>
      </div>

      <div className="small subtle" style={{ textAlign: 'center' }}>
        TeamHue stores only conversation identifiers and colors — never message content.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ member */

function MemberRow({
  member,
  isMe,
  canEdit,
  canRemove,
  onRefresh,
}: {
  member: Member;
  isMe: boolean;
  canEdit: boolean;
  canRemove: boolean;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.display_name);
  const [color, setColor] = useState(member.color);
  const { busy, run } = useAction();

  async function save() {
    const ok = await run(async () => {
      await send({ type: 'UPDATE_MEMBER', memberId: member.id, displayName: name, color });
    });
    if (ok) {
      setEditing(false);
      onRefresh();
    }
  }

  if (editing) {
    return (
      <div className="member-row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="field">
            <label htmlFor={`n-${member.id}`}>Display name</label>
            <input
              id={`n-${member.id}`}
              className="input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Signature color</label>
            <SwatchGrid value={color} onChange={setColor} />
          </div>
          <div className="row" style={{ gap: 7 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || name.trim().length < 2}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                setName(member.display_name);
                setColor(member.color);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="member-row">
      <Avatar name={member.display_name} color={member.color} />
      <div className="grow">
        <div className="row" style={{ gap: 7 }}>
          <span style={{ fontWeight: 550 }}>{member.display_name}</span>
          {isMe && <span className="pill">You</span>}
          {member.role !== 'member' && <span className="pill pill-success">{member.role}</span>}
        </div>
      </div>
      {canEdit && (
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
          Edit
        </button>
      )}
      {canRemove && (
        <button
          className="btn btn-ghost btn-sm"
          style={{ color: 'var(--danger)' }}
          disabled={busy}
          onClick={() => {
            if (!confirm(`Remove ${member.display_name} from the team?`)) return;
            void run(async () => {
              await send({ type: 'REMOVE_MEMBER', memberId: member.id });
              onRefresh();
            });
          }}
        >
          Remove
        </button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- preview */

function Preview({
  settings,
  members,
}: {
  settings: { intensity: number; showAccentBar: boolean; showInitials: boolean };
  members: Member[];
}) {
  const rows = useMemo(() => {
    const base =
      members.length > 0
        ? members.slice(0, 3)
        : ([
            { display_name: 'Maria L.', color: '#10b981' },
            { display_name: 'Devon K.', color: '#f59e0b' },
            { display_name: 'Priya S.', color: '#6366f1' },
          ] as Member[]);
    return base;
  }, [members]);

  return (
    <div style={{ width: 268, flex: '0 0 auto' }}>
      <div className="section-label">Live preview</div>
      <div className="preview">
        <div className="preview-head">Inbox</div>
        {rows.map((m, i) => (
          <div
            className="preview-row"
            key={i}
            style={{
              ['--c' as string]: m.color,
              ['--wash' as string]: withAlpha(m.color, settings.intensity),
              ['--bar' as string]: settings.showAccentBar ? '4px' : '0px',
            }}
          >
            <div className="preview-avatar" />
            <div className="grow col" style={{ gap: 6 }}>
              <div className="preview-line" style={{ width: '62%' }} />
              <div className="preview-line" style={{ width: '86%', opacity: 0.6, height: 6 }} />
            </div>
            {settings.showInitials && (
              <div
                className="preview-chip"
                style={{ background: m.color, color: readableTextOn(m.color) }}
              >
                {initialsOf(m.display_name)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="tiny muted" style={{ marginTop: 8, lineHeight: 1.45 }}>
        This is exactly how rows will look on Instagram, Google Voice and Gmail.
      </div>
    </div>
  );
}
