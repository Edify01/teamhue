import { PALETTE, readableTextOn, normalizeHex } from '@/shared/color';
import { logoSvg } from '@/shared/logo';
import type { AssignmentLite, Member } from '@/shared/types';

/**
 * The in-page color picker.
 *
 * Rendered inside a closed-ish Shadow DOM so that none of Instagram's, Gmail's
 * or Google Voice's global CSS can leak in (and ours cannot leak out). This is
 * what keeps the UI looking identical and premium on all three sites.
 */

export interface PickerContext {
  threadKey: string;
  label: string | null;
  current: AssignmentLite | null;
}

export interface PickerCallbacks {
  onApply(input: { color: string; memberId: string | null; note: string | null }): Promise<void>;
  onClear(): Promise<void>;
  onOpenOptions(): void;
}

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }

.backdrop {
  position: fixed; inset: 0; z-index: 2147483646;
  background: rgba(15, 18, 25, 0.28);
  backdrop-filter: blur(2px);
  opacity: 0; transition: opacity .16s ease;
}
.backdrop.show { opacity: 1; }

.panel {
  position: fixed; z-index: 2147483647;
  width: 320px; max-width: calc(100vw - 24px);
  background: #ffffff;
  color: #0f1219;
  border-radius: 16px;
  border: 1px solid rgba(15, 18, 25, 0.08);
  box-shadow: 0 24px 60px -12px rgba(15,18,25,.32), 0 8px 20px -8px rgba(15,18,25,.18);
  padding: 16px;
  opacity: 0; transform: translateY(6px) scale(.985);
  transition: opacity .18s cubic-bezier(.2,.8,.2,1), transform .18s cubic-bezier(.2,.8,.2,1);
}
.panel.show { opacity: 1; transform: translateY(0) scale(1); }

@media (prefers-color-scheme: dark) {
  .panel { background: #16181d; color: #f3f4f6; border-color: rgba(255,255,255,.1); }
  .field input, .field select, .field textarea { background: #1f2229 !important; color: #f3f4f6 !important; border-color: rgba(255,255,255,.14) !important; }
  .hint { color: #9aa1ae !important; }
  .btn.ghost { color: #d7dae0 !important; border-color: rgba(255,255,255,.16) !important; }
  .swatch.active { box-shadow: 0 0 0 2px #16181d, 0 0 0 4px var(--c) !important; }
}

header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 14px; }
.logo {
  width: 28px; height: 28px; border-radius: 8px; flex: 0 0 auto; line-height: 0;
  box-shadow: 0 4px 12px -4px rgba(37, 99, 235, .55);
}
.logo svg { width: 100%; height: 100%; display: block; }
.logo circle {
  transform-box: view-box; transform-origin: 32px 32px;
  transition: transform .6s cubic-bezier(.34,1.56,.64,1);
}
header:hover .logo circle:nth-child(1) { transform: translate(0,-2.4px); }
header:hover .logo circle:nth-child(2) { transform: translate(2.1px,1.2px); }
header:hover .logo circle:nth-child(3) { transform: translate(-2.1px,1.2px); }
.title { font-size: 14px; font-weight: 650; line-height: 1.25; }
.subtitle {
  font-size: 12px; color: #6b7280; margin-top: 2px; line-height: 1.35;
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.close {
  margin-left: auto; border: 0; background: transparent; cursor: pointer;
  width: 26px; height: 26px; border-radius: 7px; color: #9ca3af; font-size: 17px; line-height: 1;
}
.close:hover { background: rgba(127,127,127,.14); color: inherit; }

.label { font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: #6b7280; margin-bottom: 7px; }

.swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 14px; }
.swatch {
  position: relative; aspect-ratio: 1; border-radius: 9px; border: 0; cursor: pointer;
  background: var(--c); transition: transform .12s ease, box-shadow .12s ease;
}
.swatch:hover { transform: scale(1.1); }
.swatch.active { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--c); }
.swatch.active::after {
  content: ''; position: absolute; inset: 0; margin: auto;
  width: 7px; height: 11px; border: solid var(--check); border-width: 0 2.5px 2.5px 0;
  transform: rotate(45deg) translate(-1px, -2px);
}

.field { margin-bottom: 12px; }
.field input, .field select {
  width: 100%; height: 36px; padding: 0 10px; font-size: 13px;
  border-radius: 9px; border: 1px solid rgba(15,18,25,.14);
  background: #fff; color: #0f1219; outline: none;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.field input:focus, .field select:focus {
  border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.18);
}
.row { display: flex; gap: 8px; align-items: center; }
.row .hexwrap { position: relative; flex: 1; }
.row .hexwrap input { padding-left: 32px; font-variant-numeric: tabular-nums; text-transform: lowercase; }
.dot {
  position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px; border-radius: 5px; border: 1px solid rgba(0,0,0,.12);
  background: var(--c); pointer-events: none;
}
.native { width: 36px; height: 36px; padding: 0; border: 1px solid rgba(15,18,25,.14); border-radius: 9px; background: none; cursor: pointer; }

.hint { font-size: 11.5px; color: #6b7280; margin-top: -4px; margin-bottom: 12px; line-height: 1.4; }

footer { display: flex; gap: 8px; margin-top: 4px; }
.btn {
  flex: 1; height: 38px; border-radius: 10px; font-size: 13px; font-weight: 600;
  cursor: pointer; border: 1px solid transparent; transition: filter .12s ease, background .12s ease;
}
.btn:disabled { opacity: .55; cursor: not-allowed; }
.btn.primary { background: linear-gradient(135deg, #2563eb, #1e40af); color: #fff; }
.btn.primary:hover:not(:disabled) { filter: brightness(1.08); }
.btn.ghost { background: transparent; color: #4b5563; border-color: rgba(15,18,25,.14); flex: 0 0 auto; padding: 0 14px; }
.btn.ghost:hover:not(:disabled) { background: rgba(127,127,127,.1); }

.error {
  font-size: 12px; color: #dc2626; background: rgba(220,38,38,.1);
  padding: 7px 10px; border-radius: 8px; margin-bottom: 10px; line-height: 1.4;
}
`;

export class ColorPicker {
  private host: HTMLDivElement | null = null;
  private root: ShadowRoot | null = null;
  private ctx: PickerContext | null = null;
  private cb: PickerCallbacks | null = null;
  private members: Member[] = [];
  private color = PALETTE[5].hex;
  private memberId: string | null = null;
  private note = '';
  private busy = false;
  private error: string | null = null;
  private anchorRect: DOMRect | null = null;
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.close();
    }
  };

  get isOpen(): boolean {
    return this.host !== null;
  }

  open(ctx: PickerContext, members: Member[], anchor: DOMRect, cb: PickerCallbacks) {
    this.close();
    this.ctx = ctx;
    this.cb = cb;
    this.members = members;
    this.anchorRect = anchor;
    this.error = null;
    this.busy = false;

    this.color = ctx.current?.color ?? members[0]?.color ?? PALETTE[5].hex;
    this.note = ctx.current?.note ?? '';
    this.memberId =
      members.find((m) => m.display_name === ctx.current?.memberName)?.id ?? members[0]?.id ?? null;

    this.host = document.createElement('div');
    this.host.id = 'th-picker-host';
    this.root = this.host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(this.host);

    this.render();
    document.addEventListener('keydown', this.onKeyDown, true);

    requestAnimationFrame(() => {
      this.root?.querySelector('.backdrop')?.classList.add('show');
      this.root?.querySelector('.panel')?.classList.add('show');
      this.root?.querySelector<HTMLElement>('.swatch.active, .swatch')?.focus();
    });
  }

  close() {
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.host?.remove();
    this.host = null;
    this.root = null;
    this.ctx = null;
    this.cb = null;
  }

  private position(panel: HTMLElement) {
    const rect = this.anchorRect;
    const w = 320;
    const h = panel.offsetHeight || 380;
    const pad = 12;

    let left = rect ? rect.left : window.innerWidth / 2 - w / 2;
    let top = rect ? rect.bottom + 8 : window.innerHeight / 2 - h / 2;

    // Flip above the anchor when there isn't room below.
    if (rect && top + h > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - h - 8);
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - h - pad));

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  private render() {
    if (!this.root || !this.ctx) return;

    const hasMembers = this.members.length > 0;
    const swatches = PALETTE.map(
      (p) => `
      <button class="swatch ${p.hex === this.color ? 'active' : ''}"
              style="--c:${p.hex}; --check:${readableTextOn(p.hex)}"
              data-color="${p.hex}" title="${p.name}" aria-label="${p.name}"></button>`,
    ).join('');

    const memberOptions = this.members
      .map(
        (m) =>
          `<option value="${m.id}" ${m.id === this.memberId ? 'selected' : ''}>${escapeHtml(
            m.display_name,
          )}</option>`,
      )
      .join('');

    this.root.innerHTML = `
      <style>${STYLES}</style>
      <div class="backdrop"></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label="Assign conversation color">
        <header>
          <div class="logo">${logoSvg(28)}</div>
          <div>
            <div class="title">Assign conversation</div>
            <div class="subtitle" title="${escapeHtml(this.ctx.label ?? this.ctx.threadKey)}">${escapeHtml(
              this.ctx.label ?? this.ctx.threadKey,
            )}</div>
          </div>
          <button class="close" aria-label="Close">&times;</button>
        </header>

        ${this.error ? `<div class="error">${escapeHtml(this.error)}</div>` : ''}

        <div class="label">Color</div>
        <div class="swatches">${swatches}</div>

        <div class="field row">
          <div class="hexwrap">
            <span class="dot" style="--c:${this.color}"></span>
            <input class="hex" value="${this.color}" maxlength="7" spellcheck="false" aria-label="Hex color" />
          </div>
          <input class="native" type="color" value="${this.color}" aria-label="Pick a custom color" />
        </div>

        <div class="label">Owner</div>
        <div class="field">
          <select class="member" ${hasMembers ? '' : 'disabled'}>
            <option value="">Unassigned</option>
            ${memberOptions}
          </select>
        </div>
        ${hasMembers ? '' : '<div class="hint">Add teammates in TeamHue settings to tag owners.</div>'}

        <div class="label">Note <span style="text-transform:none;font-weight:500">(optional)</span></div>
        <div class="field">
          <input class="note" value="${escapeHtml(this.note)}" maxlength="120" placeholder="e.g. Follow up Friday" />
        </div>

        <footer>
          ${this.ctx.current ? '<button class="btn ghost clear">Remove</button>' : ''}
          <button class="btn primary apply" ${this.busy ? 'disabled' : ''}>${
            this.busy ? 'Saving…' : 'Apply color'
          }</button>
        </footer>
      </div>
    `;

    const panel = this.root.querySelector<HTMLElement>('.panel')!;
    this.position(panel);
    panel.classList.add('show');
    this.root.querySelector('.backdrop')?.classList.add('show');

    this.bind();
  }

  private setColor(next: string) {
    const norm = normalizeHex(next);
    if (!norm) return;
    this.color = norm;

    this.root?.querySelectorAll<HTMLElement>('.swatch').forEach((s) => {
      s.classList.toggle('active', s.dataset.color === norm);
    });
    this.root?.querySelector<HTMLElement>('.dot')?.style.setProperty('--c', norm);
    const native = this.root?.querySelector<HTMLInputElement>('.native');
    if (native && native.value !== norm) native.value = norm;
  }

  private bind() {
    if (!this.root) return;
    const r = this.root;

    r.querySelector('.backdrop')?.addEventListener('click', () => this.close());
    r.querySelector('.close')?.addEventListener('click', () => this.close());

    r.querySelectorAll<HTMLElement>('.swatch').forEach((s) => {
      s.addEventListener('click', () => {
        this.setColor(s.dataset.color!);
        const hex = r.querySelector<HTMLInputElement>('.hex');
        if (hex) hex.value = this.color;
      });
    });

    const hex = r.querySelector<HTMLInputElement>('.hex');
    hex?.addEventListener('input', () => {
      const norm = normalizeHex(hex.value);
      if (norm) this.setColor(norm);
    });
    hex?.addEventListener('blur', () => {
      if (hex) hex.value = this.color;
    });

    r.querySelector<HTMLInputElement>('.native')?.addEventListener('input', (e) => {
      const v = (e.target as HTMLInputElement).value;
      this.setColor(v);
      if (hex) hex.value = this.color;
    });

    r.querySelector<HTMLSelectElement>('.member')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.memberId = v || null;
      // Snap the color to that teammate's signature color for consistency.
      const m = this.members.find((x) => x.id === v);
      if (m) {
        this.setColor(m.color);
        if (hex) hex.value = this.color;
      }
    });

    r.querySelector<HTMLInputElement>('.note')?.addEventListener('input', (e) => {
      this.note = (e.target as HTMLInputElement).value;
    });

    r.querySelector('.apply')?.addEventListener('click', async () => {
      if (this.busy || !this.cb) return;
      this.busy = true;
      this.error = null;
      this.render();
      try {
        await this.cb.onApply({
          color: this.color,
          memberId: this.memberId,
          note: this.note.trim() || null,
        });
        this.close();
      } catch (err) {
        this.busy = false;
        this.error = err instanceof Error ? err.message : 'Could not save. Please try again.';
        this.render();
      }
    });

    r.querySelector('.clear')?.addEventListener('click', async () => {
      if (this.busy || !this.cb) return;
      this.busy = true;
      this.render();
      try {
        await this.cb.onClear();
        this.close();
      } catch (err) {
        this.busy = false;
        this.error = err instanceof Error ? err.message : 'Could not remove. Please try again.';
        this.render();
      }
    });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const picker = new ColorPicker();
