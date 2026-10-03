# TeamHue 🎨

**Color-code conversations across Instagram, Google Voice and Gmail so your whole team instantly knows who is handling who.**

TeamHue paints a soft color wash, an accent bar and an owner badge onto every conversation row. Because the colors live in a shared Supabase database, **every teammate sees the exact same colors — regardless of which Chrome profile, Google account, or computer they're using.**

---

## Why it works across different Chrome accounts

This is the core design decision. TeamHue deliberately does *not* use `chrome.storage.sync`, because that's tied to a single Google account.

Instead, everyone signs into a **TeamHue workspace** (your own account, separate from Google). Any Chrome profile on any machine with the extension installed and signed into that workspace sees identical colors, updated in real time via Supabase Realtime.

---

## Setup (about 5 minutes)

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a free project, and wait for it to finish provisioning.

### 2. Create the database

In the Supabase dashboard open **SQL Editor → New query**, paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.

This creates the tables, the Row Level Security policies, the `create_workspace` / `join_workspace` functions, and enables Realtime.

### 3. Configure credentials

In Supabase go to **Project Settings → API** and copy your **Project URL** and **anon public** key.

```bash
cp .env.example .env
```

Then edit `.env`:

```
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
```

> The anon key is public by design and safe to ship — it's gated by the RLS policies.
> **Never** put the `service_role` key here.

### 4. (Recommended) Turn off email confirmation for fast onboarding

**Authentication → Providers → Email →** disable *Confirm email*. This lets teammates sign up and start working immediately. Leave it on if you prefer verified emails.

### 5. Build

```bash
npm install
npm run build
```

### 6. Load into Chrome

1. Visit `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the **`dist`** folder

The options page opens automatically on first install.

---

## Using it

### Create or join a team

- The first person clicks **Create a team** and gets a join code like `BRIGHT-OTTER-42`.
- Everyone else clicks **Join a team** and enters that code.
- Each member gets an automatically-assigned signature color (editable in Settings).

### Color-code a conversation

Two ways, both instant and shared with the whole team:

| Action | How |
| --- | --- |
| **From the list** | Hold <kbd>Option</kbd>/<kbd>Alt</kbd> and click any conversation row |
| **Inside a chat** | Click the floating TeamHue button in the bottom-right |

Pick a color, optionally tag an owner and add a short note, then hit **Apply**. Every teammate's browser updates within a second.

### Personal appearance settings

In **Settings**, each person can tune (locally, without affecting others):

- Tint strength (4–45%)
- Left accent bar on/off
- Owner initials badge on/off
- Per-site enable/disable
- Master on/off switch

A live preview shows exactly how rows will look.

---

## Supported sites

| Site | How threads are identified |
| --- | --- |
| **Instagram** DMs | Thread ID from `/direct/t/<id>/` — identical for all users |
| **Google Voice** | Normalized E.164 phone number |
| **Gmail** | Counterparty email address |
| **Outlook Web** | Counterparty email address |

Gmail and Outlook key on the *other party's address* rather than the mailbox-specific thread ID, so a conversation lights up consistently in a shared inbox and in individual inboxes.

---

## Privacy

TeamHue stores only:

- A conversation identifier (thread ID, phone number, or email address)
- A hex color, an optional owner, and an optional short note

**It never reads, stores, or transmits message content.** All network traffic goes to your own Supabase project — there is no third-party server.

---

## Development

```bash
npm run dev        # rebuild on every file change
npm run build      # production build
npm run typecheck  # TypeScript, no emit
npm run icons      # regenerate PNG icons
```

After each rebuild, click the reload icon on the TeamHue card in `chrome://extensions`.

### Architecture

```
src/
├── background/     Service worker — the ONLY place with network/auth access
│   ├── index.ts    Message router + lifecycle
│   ├── state.ts    Single source of truth, cached to chrome.storage
│   └── supabase.ts Client with a chrome.storage auth adapter
├── content/        Injected into the three sites
│   ├── index.ts    Orchestrator: observe → paint → broadcast
│   ├── painter.ts  Idempotent, fully reversible styling
│   ├── picker.ts   Shadow-DOM color picker
│   └── adapters/   Per-site DOM strategies
├── popup/          Toolbar UI (React)
├── options/        Full settings + team management (React)
├── ui/             Shared design system
└── shared/         Types, messaging contract, color math
```

**Security model:** content scripts have zero privileges. They can't reach Supabase or touch credentials — they only exchange typed messages with the service worker. Nothing sensitive is ever exposed to Instagram, Gmail or Google Voice pages.

---

## Maintenance note

Instagram and Gmail use obfuscated, auto-generated class names that change periodically. The adapters are built to resist this — they anchor on stable, semantic hooks (`href` patterns, `span[email]`, ARIA roles) rather than CSS classes, and every adapter is wrapped in error handling so a selector change can degrade gracefully but never break the host page.

If colors ever stop appearing on one site, the fix is almost always isolated to a single file in `src/content/adapters/`.

---

## Packaging for the Chrome Web Store

```bash
npm run build
cd dist && zip -r ../teamhue.zip . && cd ..
```

You'll need a privacy policy explaining the broad host permissions. The key points: TeamHue stores only conversation identifiers and colors, never message content, and all data goes to a database you control.
