import { useState } from 'react';
import { send } from '@/shared/messaging';
import { Alert, Brand } from './components';
import { useAction } from './hooks';
import type { AuthState } from '@/shared/types';

type Mode = 'signin' | 'signup';

/** Email + password auth. Deliberately minimal — one screen, zero friction. */
export function AuthPanel({ onDone, compact = false }: { onDone: () => void; compact?: boolean }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const { busy, error, run, setError } = useAction();

  const valid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    password.length >= 6 &&
    (mode === 'signin' || displayName.trim().length >= 2);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;

    const ok = await run(async () => {
      if (mode === 'signup') {
        await send({ type: 'SIGN_UP', email, password, displayName });
      } else {
        await send({ type: 'SIGN_IN', email, password });
      }
    });
    if (ok) onDone();
  }

  return (
    <div style={{ padding: compact ? 18 : 0 }}>
      {compact && (
        <div style={{ marginBottom: 16 }}>
          <Brand subtitle="Color-code your team's conversations" />
        </div>
      )}

      <h2 style={{ marginBottom: 4 }}>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
      <p className="small muted" style={{ margin: '0 0 16px' }}>
        {mode === 'signin'
          ? 'Sign in to sync colors across every Chrome profile on your team.'
          : 'One account keeps your colors in sync everywhere you work.'}
      </p>

      <Alert kind="error">{error}</Alert>

      <form onSubmit={submit} noValidate>
        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="th-name">Your name</label>
            <input
              id="th-name"
              className="input"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setError(null);
              }}
              placeholder="Angel Rodriguez"
              autoComplete="name"
              maxLength={60}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="th-email">Email</label>
          <input
            id="th-email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder="you@company.com"
            autoComplete="email"
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="th-password">Password</label>
          <input
            id="th-password"
            className="input"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            placeholder="At least 6 characters"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={6}
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={!valid || busy}>
          {busy && <span className="spinner" />}
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <div className="small muted" style={{ textAlign: 'center', marginTop: 14 }}>
        {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ height: 'auto', padding: '2px 6px', color: 'var(--th-indigo)' }}
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
          }}
        >
          {mode === 'signin' ? 'Sign up' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}

/** Shown after sign-in when the user has no workspace yet. */
export function WorkspaceGate({ auth, onDone }: { auth: AuthState; onDone: () => void }) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [displayName, setDisplayName] = useState(auth.email?.split('@')[0] ?? '');
  const { busy, error, run, setError } = useAction();

  const valid =
    displayName.trim().length >= 2 &&
    (tab === 'create' ? name.trim().length >= 2 : joinCode.trim().length >= 4);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;

    const ok = await run(async () => {
      if (tab === 'create') {
        await send({ type: 'CREATE_WORKSPACE', name, displayName });
      } else {
        await send({ type: 'JOIN_WORKSPACE', joinCode, displayName });
      }
    });
    if (ok) onDone();
  }

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Set up your team</h2>
      <p className="small muted" style={{ margin: '0 0 14px' }}>
        A workspace is what keeps everyone's colors identical, no matter which Chrome profile
        they're signed into.
      </p>

      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'create' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ flex: 1 }}
          onClick={() => {
            setTab('create');
            setError(null);
          }}
        >
          Create a team
        </button>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'join' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ flex: 1 }}
          onClick={() => {
            setTab('join');
            setError(null);
          }}
        >
          Join a team
        </button>
      </div>

      <Alert kind="error">{error}</Alert>

      <form onSubmit={submit} noValidate>
        {tab === 'create' ? (
          <div className="field">
            <label htmlFor="th-ws">Team name</label>
            <input
              id="th-ws"
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="Acme Support"
              maxLength={60}
              autoFocus
            />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="th-code">Join code</label>
            <input
              id="th-code"
              className="input code-input"
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value.toUpperCase());
                setError(null);
              }}
              placeholder="BRIGHT-OTTER-42"
              maxLength={32}
              autoFocus
            />
            <div className="tiny muted" style={{ marginTop: 5 }}>
              Ask a teammate for the code in their TeamHue settings.
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="th-display">How should teammates see you?</label>
          <input
            id="th-display"
            className="input"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setError(null);
            }}
            placeholder="Angel R."
            maxLength={60}
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={!valid || busy}>
          {busy && <span className="spinner" />}
          {busy ? 'Setting up…' : tab === 'create' ? 'Create team' : 'Join team'}
        </button>
      </form>
    </div>
  );
}
