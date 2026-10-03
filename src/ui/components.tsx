import type { ReactNode } from 'react';
import { PALETTE, initialsOf, readableTextOn } from '@/shared/color';

export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <div className="brand">
      <div className="brand-mark">T</div>
      <div className="grow">
        <div style={{ fontWeight: 650, fontSize: 14, lineHeight: 1.2 }}>TeamHue</div>
        {subtitle && <div className="tiny muted truncate">{subtitle}</div>}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  );
}

export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="row spread" style={{ padding: '9px 0', gap: 14 }}>
      <div className="grow">
        <div style={{ fontSize: 13, fontWeight: 550 }}>{title}</div>
        {description && (
          <div className="tiny muted" style={{ marginTop: 1 }}>
            {description}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="avatar"
      style={{ background: color, color: readableTextOn(color) }}
      title={name}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </div>
  );
}

export function SwatchGrid({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="swatch-grid">
      {PALETTE.map((p) => (
        <button
          key={p.hex}
          type="button"
          className="swatch"
          style={{ ['--c' as string]: p.hex }}
          aria-pressed={p.hex.toLowerCase() === value.toLowerCase()}
          aria-label={p.name}
          title={p.name}
          onClick={() => onChange(p.hex)}
        />
      ))}
    </div>
  );
}

export function Alert({
  kind,
  children,
}: {
  kind: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Empty({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg)' }}>{title}</div>
      {body && (
        <div className="small muted" style={{ marginTop: 4, maxWidth: 260, marginInline: 'auto' }}>
          {body}
        </div>
      )}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'center', padding: 28, gap: 9 }}>
      <span className="spinner" style={{ color: 'var(--th-indigo)' }} />
      {label && <span className="small muted">{label}</span>}
    </div>
  );
}
