# LanceraOS v2 — UI Design System

This document defines the single, unified design system for LanceraOS v2.
Every AI chat building any page or component must read this first.

v1 had four inconsistent design systems running in parallel (app shell,
auth "orbit", landing, public documents). v2 has one. Every surface —
authenticated pages, auth pages, public invoice/contract pages, landing
page — draws from the same token set and the same component patterns.
The only intentional visual difference is that the sidebar is always
dark regardless of the user's theme setting.

---

## 0. The Single Most Important Rule

**All styling uses inline `style={{}}` objects with CSS custom properties.**
Never Tailwind utility classes in JSX. Never separate CSS files per component.
Never hardcoded hex values for structural colors.
The only CSS that goes in .css files is: custom property definitions,
keyframe animations, media queries, and the small set of global utility
classes listed in Section 6.

---

## 0b. Never Emojis — Icon Components Only

No emoji characters and no bare Unicode symbols standing in for an icon
(⚠ ✓ ✗ ⭐ etc.) anywhere in rendered UI, in any component, on any page —
auth pages, authenticated app pages, PDFs, and emails alike. Use a real
icon component instead, exclusively from `lucide-react`
(`import { Check, X, AlertTriangle } from 'lucide-react'`).

This applies even to small inline indicators that feel throwaway — a
"passwords match" checkmark, a warning glyph next to a link, a success
tick after a save. Every one of these is a lucide icon sized and colored
to match the surrounding text (typically `size={13}`–`16`, `color`
inherited or set to the relevant status token), never a text character.

Found and fixed during the Users/Auth build: `Login.jsx` had a bare `⚠`
in a link's text, and `Register.jsx`/`ResetPassword.jsx` had bare `✓`/`✗`
for password-match feedback — all three replaced with `AlertTriangle`/
`Check`/`X` components. Treat discovering a bare symbol the same way
STANDARDS.md treats dead code: a signal to fix it on sight, not preserve
it for consistency with something else that has the same problem.

The only exception is this document's own internal reference tables
(e.g. the asset-location table in Section 13) — those are markdown
documentation notation, not rendered product UI, and are unaffected by
this rule.

---

## 1. Design Philosophy

LanceraOS is a flat, bordered, dark-first SaaS dashboard. The visual
language is close to Linear or Vercel — cards have no shadow at rest,
elevation is expressed with a 1px border, not depth. Shadows and blur
are reserved exclusively for things that float above the page: modals,
slide-in panels, popovers, and the sidebar's active nav pill.

The one intentional design flourish is the liquid-glass navigation pill
in the sidebar — a single absolutely-positioned element that slides
between active nav items using backdrop-filter blur and a multi-layer
inset shadow recipe. Outside the sidebar, glass effects do not appear.

Status and data communicate through a consistent triad of green/amber/red
and pill-shaped badges. The interface is never decorative for its own sake.

The auth flow uses the same token system as the rest of the app but with
a distinct "cosmic orbit" visual identity: starfield background, rotating
orbit rings, fixed deep-dark background. This is intentional and stays.

---

## 2. Color Tokens

All tokens are defined in `frontend/src/styles/theme.css`.
Light mode is the `:root` default. Dark mode uses `[data-theme="dark"]`.
The `data-theme` attribute is set on `document.body`.

### 2.1 Brand / Accent

```css
--accent:          #00c896   (dark: #00e5a0)   /* primary teal */
--accent-dim:      #00a87e   (dark: #00c896)   /* muted variant */
--accent-vivid:    #00e5a0   (dark: #00ffc0)   /* brightest variant */
--accent-glow:     rgba(0,200,150,.12)   (dark: rgba(0,229,160,.10))
--accent-glow-md:  rgba(0,200,150,.20)   (dark: rgba(0,229,160,.18))
--accent-glow-lg:  rgba(0,200,150,.30)   (dark: rgba(0,229,160,.28))
--teal:            #00c896   /* NEW in v2 — v1 used var(--teal, #00c896) but
                               never defined --teal, causing silent fallbacks
                               everywhere. Define it once here. */
```

### 2.2 Backgrounds

```css
--bg-page:      #0a0b14   /* page background — identical in light and dark.
                             The app has a dark outer shell in both modes. */
--bg-surface:   #ffffff   (dark: #111118)   /* card / panel background */
--bg-surface-2: #f8f8fc   (dark: #18181f)   /* secondary surface, input bg */
--bg-surface-3: #f0f0f6   (dark: #222230)   /* disabled, inactive, skeleton */
--bg-overlay:   rgba(255,255,255,.85)   (dark: rgba(17,17,24,.90))
--bg-invert:    #0f0f18   (dark: #f4f4f8)
```

### 2.3 Text

```css
--text-primary:   #0e0e1a   (dark: #f0f0f8)
--text-secondary: #4a4a65   (dark: #a0a0c0)
--text-tertiary:  #8888a8   (dark: #60607a)
--text-disabled:  #b8b8cc   (dark: #404058)
--text-on-accent: #000000   /* always black — teal buttons have black text */
--text-on-dark:   #f0f0f8   /* always light — for elements that stay dark */
```

### 2.4 Borders

```css
--border-subtle:  rgba(0,0,0,.06)    (dark: rgba(255,255,255,.04))
--border-default: rgba(0,0,0,.10)    (dark: rgba(255,255,255,.08))
--border-strong:  rgba(0,0,0,.18)    (dark: rgba(255,255,255,.14))
--border-accent:  rgba(0,200,150,.40) (dark: rgba(0,229,160,.30))
```

### 2.5 Semantic / Status

These are the tokens. But in v2, we also add the de facto hardcoded
values as variables so every page uses the same variable instead of
hardcoding the same hex in different files.

```css
/* Positive / success / paid / good */
--status-green:        #10b981
--status-green-bg:     rgba(16,185,129,.12)
--status-green-text:   #10b981

/* Warning / pending / partial */
--status-amber:        #f59e0b
--status-amber-bg:     rgba(245,158,11,.12)
--status-amber-text:   #f59e0b

/* Danger / overdue / error / rejected */
--status-red:          #ef4444
--status-red-bg:       rgba(239,68,68,.12)
--status-red-text:     #ef4444

/* Info / sent / in progress */
--status-blue:         #60a5fa
--status-blue-bg:      rgba(96,165,250,.12)
--status-blue-text:    #60a5fa

/* Neutral / draft / cancelled */
--status-gray:         #6b7280
--status-gray-bg:      rgba(107,114,128,.12)
--status-gray-text:    #6b7280
```

### 2.6 Form Elements

```css
--input-bg:             #ffffff              (dark: #18181f)
--input-border:         #d4d4e0              (dark: #2a2a3a)
--input-border-focus:   #00c896              (dark: #00e5a0)
--input-border-error:   #e53e3e              (dark: #fc8181)
--input-text:           #0e0e1a              (dark: #f0f0f8)
--input-placeholder:    #9090b0              (dark: #50507a)
--input-shadow-focus:   0 0 0 3px rgba(0,200,150,.15)  (dark: ...rgba(0,229,160,.12))
--input-shadow-error:   0 0 0 3px rgba(229,62,62,.12)  (dark: ...rgba(252,129,129,.10))
```

### 2.7 Buttons

```css
--btn-primary-bg:    #1e3a5f   (dark: #2563a8)
--btn-primary-hover: #162d4a   (dark: #1e4f8a)
--btn-primary-text:  #ffffff
--btn-accent-bg:     #00c896   (dark: #00e5a0)
--btn-accent-hover:  #00a87e   (dark: #00c896)
--btn-accent-text:   #000000
--btn-ghost-border:  #d4d4e0   (dark: #2a2a3a)
--btn-ghost-hover:   #f0f0f6   (dark: #1a1a28)
--btn-ghost-text:    #4a4a65   (dark: #a0a0c0)
```

### 2.8 Sidebar / Shell — single source of truth, follows the theme toggle

**REVERSED from the original decision below this heading's old name
("dark in both themes — never flips"):** the shell (header + sidebar +
nav + profile popup) now has genuinely distinct light-mode and
dark-mode colors, like every other themed surface — see DECISIONS.md
for the reasoning. Every token below lives in exactly two places in
`theme.css`: the consolidated `APP SHELL` block in `:root,
[data-theme="light"]`, and its matching `APP SHELL` block in
`[data-theme="dark"]`. Nowhere else in the codebase defines a shell
color — change both blocks together when adjusting shell colors.

```css
--bg:               #f8f8fc      (dark: #0d0d16)   /* sidebar + header background */
--surface:          #f6fafe      (dark: #111318)   /* main content surface */
--icon:             #342858      /* nav icon at rest — theme-invariant brand purple */
--icon-active:      #a89cf2      /* nav icon active/hover — theme-invariant brand purple */
--nav-text:         rgba(14,14,26,.45)   (dark: rgba(255,255,255,.45))
--nav-active:       #a89cf2      /* theme-invariant */
--nav-hover-bg:     rgba(0,0,0,.045)     (dark: rgba(255,255,255,.06))
--wordmark:         #0e0e1a      (dark: #ffffff)
--header-title:     rgba(14,14,26,.80)   (dark: rgba(255,255,255,.80))
--header-icon:      rgba(14,14,26,.55)   (dark: rgba(255,255,255,.55))
--notif:            #ff5100      /* notification dot — theme-invariant */
--avatar-bg:        rgba(0,0,0,.05)      (dark: rgba(255,255,255,.06))
--profile-name:     rgba(14,14,26,.82)   (dark: rgba(255,255,255,.82))
--profile-email:    rgba(14,14,26,.35)   (dark: rgba(255,255,255,.35))
--chevron:          rgba(14,14,26,.40)   (dark: rgba(255,255,255,.40))
--menu-bg:          rgba(245,247,247,.98)   (dark: rgba(18,24,30,.98))
--menu-text:        rgba(17,23,31,.70)      (dark: rgba(255,255,255,.70))
--menu-text-hover:  rgba(17,23,31,.95)      (dark: rgba(255,255,255,.95))
--menu-hover-bg:    rgba(0,0,0,.06)         (dark: rgba(255,255,255,.07))
--danger:           #d32f2f                 (dark: #ff4d4d)
--danger-hover:     rgba(211,47,47,.10)     (dark: rgba(255,77,77,.10))
--divider:          rgba(0,0,0,.08)         (dark: rgba(255,255,255,.08))
--switch-idle:      rgba(14,14,26,.45)   (dark: rgba(255,255,255,.45))
--switch-active:    rgba(14,14,26,.92)   (dark: rgba(255,255,255,.92))
--logo-body:        #8074c0      /* theme-invariant brand color, both themes */
--logo-mark:        #050508      /* theme-invariant brand color, both themes */
```

### 2.9 Liquid-Glass Primitives (sidebar only)

```css
--glass-tint:   #6656cf0e
--glass-light:  #6656cf
--glass-dark:   #000000
--glass-blur:   18px
--saturation:   150%

--glass-shadow:
  inset 0 0 0 1px       color-mix(in srgb, var(--glass-light) 10%, transparent),
  inset 1.8px 3px 0 -2px  color-mix(in srgb, var(--glass-light) 90%, transparent),
  inset -2px -2px 0 -2px  color-mix(in srgb, var(--glass-light) 80%, transparent),
  inset -3px -8px 1px -6px color-mix(in srgb, var(--glass-light) 60%, transparent),
  inset -0.3px -1px 4px 0  color-mix(in srgb, var(--glass-dark) 12%, transparent),
  inset 0 3px 4px -2px     color-mix(in srgb, var(--glass-dark) 20%, transparent),
  0 1px 5px 0              color-mix(in srgb, var(--glass-dark) 10%, transparent),
  0 6px 16px 0             color-mix(in srgb, var(--glass-dark) 8%, transparent);
```

Glass effects appear ONLY in the sidebar nav pill and nav item hover.
Nowhere else in the app uses backdrop-filter.

---

## 3. Typography

```css
--font: 'DM Sans', sans-serif;
--font-mono: 'JetBrains Mono', monospace;   /* OTP inputs, code labels only */
```

Load in index.html:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

Base: `html { font-size: 16px }` / `body { font-size: 1rem; line-height: 1.6 }`

Font weights:
- 400 — body text, inactive nav labels
- 500 — form labels, secondary emphasis
- 600 — badges, micro-labels, section eyebrows
- 700 — card titles, buttons, values
- 800 — KPI stat numbers, large numeric values
- 900 — health score number (the single largest number on the page only)

Typographic scale (use only these sizes, nothing in between):
- `0.65rem` — uppercase micro-label, group eyebrow
- `0.75rem` — badge text, helper text, timestamps
- `0.8rem`  — small label, hint text
- `0.875rem`— button text, form label
- `0.9rem`  — form input text
- `1rem`    — body text, list items
- `1.1rem`  — card subtitle
- `1.25rem` — card title, section heading
- `1.5rem`  — page section title
- `1.75rem` — page heading
- `2rem`+   — KPI stat numbers, health score (use 800–900 weight)

Letter-spacing conventions:
- `0.06em–0.1em` — uppercase micro-labels and group eyebrows
- `0.01em` — form labels
- `-0.02em` — headings
- `-0.04em` — header page title (AppShell)
- `0.5em` — OTP/code inputs (intentionally extreme for digit separation)

---

## 4. Spacing and Radius

### Border radius tokens
```css
--radius-sm:   6px
--radius-md:   10px
--radius-lg:   14px
--radius-xl:   20px
--radius-full: 9999px
```

Use these tokens. Never hardcode a border-radius except:
- `50%` for circular avatars and collapsed nav icons
- `2px` for expense category color swatches (deliberately square)
- `999px` is an alias for `--radius-full`, use the token

### Spacing conventions
No formal 4px/8px grid, but these values recur consistently:
- Card padding: `16px 18px` (compact) to `20px 24px` (spacious)
- Button padding: `10px 20px` standard, `8px 16px` compact
- Badge padding: `3px 8px`
- Form input padding: `10px 14px`
- Section gap: `12px–20px`
- Card internal gap: `8px–12px`

---

## 5. Layout System

### AppShell structure
Every region is `position: fixed`. Not CSS Grid, not flex parent.
Each region computes its own geometry from React state.

Header: `position: fixed; inset: 0 0 auto 0; height: var(--header-h); z-index: 350`
Sidebar: `position: fixed; top/left/bottom; width: state-driven; z-index: 250 (350 mobile)`
Main content: `position: fixed; top: var(--header-h); left: sidebarWidth; right: 0; bottom: 0`
Mobile overlay: `position: fixed; inset: 0; z-index: 150`

### Layout tokens
```css
--sidebar-w:         218px   /* desktop expanded */
--sidebar-collapsed: 72px    /* desktop collapsed */
--header-h:          60px

/* Mobile overrides at ≤768px */
--sidebar-w:         240px
--sidebar-collapsed: 0px
--header-h:          56px
```

### Main content wrapper
```css
border-radius: var(--radius-lg) var(--radius-lg) 0 0;  /* top corners only */
background: var(--surface);
overflow: hidden;
```
Inner scroll container (child of above):
```css
height: 100%;
overflow-y: auto;
overflow-x: hidden;
padding: 32px;  /* 20px 16px on mobile */
-webkit-overflow-scrolling: touch;
```
The outer wrapper never scrolls. Only the inner div scrolls.
`document.body` gets class `app-shell-active` on mount to lock body scroll.

### Z-index scale
```
0        nav pill background, theme-switch active bg
1        nav items, theme-switch buttons
2        sidebar bottom block
60       detail drawer panels
89–95    assistant widget
100      slide panel overlay
200      centered modal (stacked above panel)
150      mobile sidebar overlay
250      sidebar (desktop)
350      header / sidebar (mobile)
500      toasts, notification panel
9999     collapsed-rail tooltip pseudo-elements
100000   ProfilePopup (portaled to body)
100002   shared .app-tooltip (portaled to body)
```
Do not invent new values. Use the nearest existing value for new elements.
Slide panel overlay = 100. Modal above panel = 200. Toast = 500.

---

## 6. Global CSS Utility Classes

These live in `theme.css` and should be used directly. Do not re-implement
them as inline objects.

### Buttons
```
.fos-btn              base — all buttons extend this
.fos-btn-primary      navy solid (invoices, settings, primary actions)
.fos-btn-accent       teal solid (main CTAs — "New Invoice", "Send", "Save")
.fos-btn-ghost        outline/transparent (secondary actions)
.fos-btn-danger       red solid (delete, cancel)
.fos-btn-full         width: 100%
.fos-spinner          14px spinning border inside a button during async
```

### Form elements
```
.fos-input            standard text input
.fos-select           select with custom chevron
.fos-label            input label (0.78rem/500/secondary color)
.fos-error            error message below input (0.78rem/error color)
.fos-hint             helper text below input (0.78rem/tertiary)
```

### Feedback
```
.fos-alert            base alert container
.fos-alert-success    green alert
.fos-alert-warning    amber alert
.fos-alert-error      red alert
.fos-alert-info       blue alert
.fos-divider          1px horizontal rule using --border-default
```

### Shell-specific (do not use these in page components)
```
.nav-item             sidebar navigation link
.nav-pill             the sliding active indicator (one per sidebar)
.group-label          uppercase section label in nav
.app-tooltip          singleton body-level tooltip (JS-positioned)
```

### React wrapper components (authenticated app pages)
Built during the Settings/Profile work as the sanctioned exception noted
in Section 12 — reuse these rather than reimplementing the same markup:
```
Card.jsx        title/subtitle/action bordered container (src/components/)
FormField.jsx   labeled text/password input wrapping .fos-input/.fos-label/.fos-error/.fos-hint
FormSelect.jsx  labeled select wrapping .fos-input/.fos-select
FosAlert.jsx    dismissible alert wrapping .fos-alert-* with a lucide icon
SaveButton.jsx  Save/Saving…/No Changes button wrapping .fos-btn-accent
```

---

## 7. Component Recipes

### Standard card (the single most common pattern)
```jsx
<div style={{
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: '18px 20px',
  // NO box-shadow — cards are flat at rest
}}>
```
Card with header:
```jsx
<div style={{ background:'var(--bg-surface)', border:'1px solid var(--border-subtle)', borderRadius:'var(--radius-lg)' }}>
  <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border-subtle)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
    <span style={{ fontSize:'1rem', fontWeight:700, color:'var(--text-primary)' }}>Title</span>
  </div>
  <div style={{ padding:'18px 20px' }}>
    {/* content */}
  </div>
</div>
```

### Status badge (universal formula)
```jsx
<span style={{
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 8px',
  borderRadius: 'var(--radius-full)',
  fontSize: '0.72rem',
  fontWeight: 600,
  background: 'var(--status-green-bg)',   // or amber, red, blue, gray
  color: 'var(--status-green-text)',
}}>
  Paid
</span>
```

### Status color map — use these tokens, do not hardcode
```
paid / success / positive    → var(--status-green) / var(--status-green-bg)
partial / warning / pending  → var(--status-amber) / var(--status-amber-bg)
overdue / danger / rejected  → var(--status-red)   / var(--status-red-bg)
sent / info / in-progress    → var(--status-blue)  / var(--status-blue-bg)
draft / cancelled / neutral  → var(--status-gray)  / var(--status-gray-bg)
```

### Status color strip (left edge of list rows)
```jsx
<div style={{
  width: 3,
  height: 32,
  borderRadius: 2,
  background: 'var(--status-red)',   // matches row status
  flexShrink: 0,
}} />
```

### List rows (not real <table> elements — flex card stacks)
```jsx
<div style={{ display:'flex', flexDirection:'column', gap:8 }}>
  {items.map(item => (
    <div
      key={item.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-surface-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-surface)'}
    >
      {/* content */}
    </div>
  ))}
</div>
```
Hover is JS-driven (`hoverProps`, see "Hover interactions" in Section 8), not
CSS :hover, because inline styles cannot use pseudo-classes.

### Slide-in side panel
```jsx
{/* Overlay */}
<div
  onClick={onClose}
  style={{
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    backdropFilter: 'blur(4px)',
    zIndex: 100,
  }}
/>
{/* Panel */}
<div style={{
  position: 'fixed',
  top: 'var(--header-h)',
  right: 0,
  bottom: 0,
  width: '100%',
  maxWidth: 480,
  background: 'var(--bg-surface)',
  boxShadow: '-8px 0 32px rgba(0,0,0,0.2)',
  zIndex: 101,
  overflowY: 'auto',
  animation: 'panel-slide-in 0.2s cubic-bezier(0.22,1,0.36,1)',
}}>
```
Add to CSS file: `@keyframes panel-slide-in { from { transform: translateX(12px); opacity: 0; } to { transform: none; opacity: 1; } }`

### Centered modal
```jsx
{/* Overlay */}
<div style={{
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 200,
}}>
  {/* Card */}
  <div style={{
    background: 'var(--bg-surface)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
    padding: '24px 28px',
    width: '100%',
    maxWidth: 480,
    animation: 'modal-in 0.2s cubic-bezier(0.22,1,0.36,1)',
  }}>
```
Add to CSS: `@keyframes modal-in { from { transform: scale(0.95) translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }`

Every Proposals dialog (`ProposalDialog.jsx`) traps keyboard focus and gives it back to what opened it
(`useFocusTrap.js`, 04 November 2026); Section 12's "no generic Modal" rule stands — a hook, not a shared component.
The one full-viewport overlay in Proposals, the in-app Preview, is z-index 500 (the scale's next value), because
the shell's sidebar (250) and header (350) sit above a 200 overlay and would clip its title bar.

### Skeleton / loading pulse
Add to CSS: `@keyframes skeleton-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }`
```jsx
<div style={{
  background: 'var(--bg-surface-3)',
  borderRadius: 'var(--radius-sm)',
  animation: 'skeleton-pulse 1.4s ease-in-out infinite',
  height: 16,
  width: '60%',
}} />
```
Do NOT define a new keyframe name for skeleton pulses. Always use `skeleton-pulse`.

### Spinner
Add to CSS: `@keyframes spin { to { transform: rotate(360deg) } }`
```jsx
<div style={{
  width: 18,
  height: 18,
  borderRadius: '50%',
  border: '2px solid var(--border-default)',
  borderTopColor: 'var(--accent)',
  animation: 'spin 0.7s linear infinite',
}} />
```
Do NOT define a new keyframe name for spinners. Always use `spin`.

### Toast notification
```jsx
<div style={{
  position: 'fixed',
  bottom: 24,
  right: 24,
  padding: '12px 16px',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
  zIndex: 500,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  animation: 'toast-in 0.2s ease',
}}>
```
Add to CSS: `@keyframes toast-in { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }`
Auto-dismiss after 4000ms. No exit animation — instant unmount.

### Autosave state line (added 03 November 2026, Proposals editor)
A page that autosaves has no Save button to relabel, so one line under the header is the ONLY place a person learns
whether their text is safe — it must be honest. Reference: `components/ProposalSaveIndicator.jsx`.
- Always visible text, never icon-only and never colour-only: `Saving…` (spinner), `Saved` (`CheckCircle2`, green),
  `Unsaved changes` (`Clock`, muted), `Not saved — fix the highlighted fields` (`AlertTriangle`, red), `Couldn't save —
  retrying…` (spinner, amber), `Not saved` / paused-by-rate-limit (amber/red) with a ghost `Retry now` button.
- `role="status" aria-live="polite"`, fixed `min-height: 20px` so it never shifts the layout when it appears or clears.
- `Saved` is shown only when nothing is pending, refused or failed: a field withheld for a validation error is "Not
  saved", never "Saved".
- Transient success/error messages elsewhere on such a page stay inline `FosAlert` + `useTimedMessage` — this app has no
  floating toast (the `toast-in` keyframe above is documented but not defined in theme.css).

---

### Dropdown menu (`DropdownMenu.jsx`) — keyboard and focus (04 November 2026)

The open panel is portaled to `document.body`. Opening moves focus to the first enabled item; items are
`tabIndex={-1}` and focus roves by code (ArrowDown/ArrowUp wrap, Home/End jump, `preventDefault` so the page does
not scroll). Escape closes and focuses the trigger; Tab and Shift+Tab close and focus the trigger without
`preventDefault`, so the browser's Tab then leaves the trigger. Choosing an item closes the menu, focuses the
trigger, and only then runs `onClick`, so a dialog opened by the item (`useFocusTrap` remembers
`document.activeElement`) returns focus to the trigger instead of `<body>`. An outside click, scroll or resize only
closes the menu and leaves focus alone. The panel is labelled with the trigger's `aria-label`.

### Times

API timestamps are naive Pakistan time and are shown as written (`formatTimestamp`, never `new Date()`).
Freelancer-side displays label them: `formatTimestampPkt` appends " PKT" (a list column says it once in its header,
e.g. "Updated (PKT)"). The public client page already labels its times PKT. Converting to the profile's timezone is
a separate, platform-wide decision, not made here.

### Dashboard layout (`/dashboard`, 04 November 2026)

Header: `h1` greeting ("Good morning, Ali") plus the device-local date. The greeting is the ONE thing on the page that uses
the device clock: 05:00-11:59 "Good morning", 12:00-16:59 "Good afternoon", otherwise "Good evening" (never "Good night", it is
a farewell). Name = first name, else username, else none. Everything else is naive Pakistan time shown as written with a PKT
label; no relative times.

Desktop (a CSS grid with named areas, 16px gap): a row of four KPI tiles; then `chart chart health` / `chart chart attention` /
`insights insights insights` / `activity activity upcoming` / `activity activity rates`. At <= 768px it is one column in the order
**greeting, KPIs (2 x 2), Needs attention, Financial health, chart, Insights, Upcoming, Activity, Rates** — what needs action
comes before history (the grid items carry `order`; the Financial health widget was added by Prompt 19, see "Health Score page"). Nothing may scroll
horizontally at 320px.

Pieces: every section is a `DashboardCard` (the standard card recipe, a real `h2`, a `<section>` landmark). KPI tiles are real
`<Link>`s (never clickable divs) with the `InvoiceKPIStrip` look. A section the server could not build shows "Couldn't load
this section." and a Reload button inside its own card; the others render normally. Loading is a grey skeleton in the final
layout (`skeleton-pulse`); a refetch dims the page (opacity .6) instead of unmounting it. The chart is one series, no legend,
colours from the `--chart-series-collected` pair mirrored as hex, `role="img"` with a one-sentence label, plus a
visually-hidden table of the six values next to it. Rates are labelled "Daily rate · updated <date>", never "live".
Keyboard: every link shows a `:focus-visible` ring (`.dash-link`, 2px accent outline).

**Insights card (06 November 2026).** A `DashboardCard` titled "Insights" ("From your own numbers"), a FULL-WIDTH row between the
chart/attention-and-health rows and the activity row (the grid areas are listed under "Desktop" above); on mobile the order is
attention, health, chart, insights, upcoming, activity, rates. It owns its own request and is always
rendered, so there is no layout jump: loading is three skeleton tiles of the ready tiles' height. Ready: up to three tiles in a grid
`repeat(auto-fit, minmax(240px, 1fr))`, each a `Lightbulb` icon, the observation in primary text and the suggestion below it in
secondary text, both plain React text nodes (escaped, never HTML). Empty: a quiet `BarChart3` message with the server's hint. Error:
`DashboardUnavailable` whose Reload refetches the insights only. Footer (`Sparkles` + "Written by AI from your own figures. Check them
against your invoices before acting.") ONLY for `source` `ai` or `mixed`, never for the fixed-sentence `template`. No focusable
element inside the ready card (the tiles are not links). 320px: no horizontal scroll.

### Payments page (`/payments`, 08 November 2026)

Top to bottom: a flash message (`FosAlert`, auto-dismissing), the KPI strip, a row with the chart and the by-source card, the
"excluded / estimated" notes (small `Info` lines, only for a count above zero), search + sort, the filters, the list, the pagination.
The KPI strip, chart and by-source card cover ALL the person's payments and never change with the list filters; the strip says so
("All your payments, whatever the filters below").

KPI strip (`PaymentsKpiStrip.jsx`, classes prefixed `pay-`): one currency select and three cards (This month with a month-over-month
delta ONLY when the server sends one, green up / red down; This year; All time), always side by side at every width — type and padding
shrink at 939px and 480px (below 480 the delta drops to the arrow and the percentage). Loading is skeleton blocks; a refetch dims the cards
(opacity .55) and never unmounts them; a failed request shows "Couldn't load these figures." with Reload inside the strip while the list
still works. Chart (`PaymentsIncomeChart.jsx`): a `DashboardCard`, one series, no legend, colour from `COLLECTED_BAR_COLORS`, `role="img"`
with a one-sentence label plus a visually-hidden table of the twelve values beside it. By-source card: label, converted total, count and a
thin neutral bar sized against the largest row — the numbers carry the meaning, never colour. Chart and by-source sit in a grid `2fr 1fr`
with `align-items: start` (stretching the chart to the list's height left an empty block under the bars) and `1fr` at <= 768px.

Mobile order (<= 768px): KPIs, chart, by-source, notes, search + sort (sort is the `ArrowUpDown` dropdown), filters (selects and date
inputs in one wrapping row), the card list, compact pagination, and the `.page-fab` (56px) for "Add payment". Desktop shows the table
(`PaymentTable.jsx`: Date | Received from | Source | Amount | Invoice) built on `listTableStyles.js`; the date cell holds a real `<button>`
so every row is keyboard-operable, and the whole row opens the panel too. An amount shows its cents; an estimated or missing exchange rate adds
an `Info` icon whose `aria-label` is the same sentence the panel shows as visible text.

Dialogs are `PaymentDialog.jsx` (the centered-modal recipe, `useFocusTrap`; Escape and the close button do nothing while a request runs;
never `autoFocus` a field inside one — pass `initialFocus` so focus returns to the opener). The add/edit dialog has a second step, the
DUPLICATE step, shown after the payment is saved: "Possible duplicate", one sentence, up to three rows (date, source, who, how it got
there) each with a View button, then "Keep both" and the danger button "Delete the one I just added". A linked payment's edit dialog
disables amount, currency, date and source and says why in a visible info alert. The side panel (`PaymentDetailPanel.jsx`) is the
slide-in recipe at max width 480 and closes on the overlay and on Escape only when no dialog is open. Estimated/missing-rate notes are
visible text in the panel (info style for "nearby", warning style for the others).

The 320px rule: the page, the panel and every dialog must have `scrollWidth == clientWidth`; no fixed widths over the available space, rows
and badges wrap or ellipsise.

### Import payments dialog (`PaymentImportDialog.jsx`, 08 November 2026, Prompt 13)

Opened from the Payments page: the header's ghost "Import" button next to the accent "Add payment" (desktop), an "Import payments" item in AppShell's
three-dot menu (mobile), and "Import from a file" in the empty state. One `PaymentDialog` frame, `maxWidth` 980, **rendered through a portal to
`<body>`** with its own overlay class at `z-index: 600`: AppShell's main frame is a stacking context (z-index 1), so no z-index set inside it can climb
above the sidebar (250), header (350) or mobile drawer (400) — a 980px dialog covered the tick-box column of its own table at 1280px, and on a phone the
header covered its title and close button (both found in browser verification). Any new dialog wider than the content area must do the same.

Four steps, one title each (the dialog's own `h3`, which takes focus whenever the step changes — never `autoFocus`; compare with the PREVIOUS step, not a
"first render" flag, because StrictMode runs mount effects twice): **Import payments** (source select, native file input, "Where do I get this file?"
details, "Check the file", then "Past imports" with an inline Undo), **Check the columns** (shown only when the server cannot tell, or from Review's
"Change columns": reason sentences, a scrolling table of the first rows, a two-column form that is one column at <= 768px), **Review before importing**,
**Import finished**. Closing on Columns/Review asks first with a sticky inline warning bar ("Keep reviewing" / "Leave"); Escape and the X are ignored
while a request runs.

Review: a line "N rows in <file>. M look ready to import.", filter pills with counts (only groups that exist), "Select all ready" / "Clear selection",
then the rows — a table on desktop (`.pay-import-table`) and cards at <= 768px (`.pay-import-cards`), toggled by CSS like the Payments list. Status badges
use the existing status tokens: Ready green, Check amber, May already be there amber, Already imported gray, Not income gray, Can't read red. Every row
shows the server's reason verbatim; a row that cannot be imported has a DISABLED checkbox. 50 rows are rendered at a time ("Show 50 more (n left)").
The bottom bar (`.pay-import-bar`) is `position: sticky; bottom: 0`, full width of the dialog, and carries "{n} selected", the per-currency totals in exact
cents, amber notes about ticked "Check"/"May already be there" rows, "Choose another file" and the primary "Import n payments".

Full-screen at <= 768px: overlay padding 0, card `100dvh`, no radius, padding 18px 16px. The 320px rule applies to every step (page and dialog
`scrollWidth == clientWidth`). After choosing a file, focus moves to "Check the file" (the input it replaces would otherwise drop focus to `<body>`).

### Expenses page (`/expenses`, 08 November 2026, Prompt 15)

A deliberate mirror of the Payments page, with the differences below. Top to bottom: flash message, the KPI strip (`ExpensesKpiStrip.jsx`, classes
prefixed `exp-`), a row with the 12-month spending chart and the "where this year's spending went" card (grid `2fr 1fr`, `1fr` at <= 768px), the
"excluded / estimated" notes, search + sort, ONE wrapping filter row (category, deductible, currency, From/To; each control grows to share the width at
<= 768px), the list (table on desktop, cards at <= 768px) and the pagination. The strip, chart and category card cover ALL expenses and never change
with the list filters.

**No side panel.** A Payment has invoice links, provenance and link/unlink actions, so it earns a panel; an expense is seven plain fields, and a panel
would only repeat the edit form. A row (or card) opens the edit dialog, and each row has a row-actions menu (`DropdownMenu`, `MoreVertical`, built like
`ClientTable`'s): Edit, Duplicate, Delete. The actions cell stops click propagation so opening the menu never also opens the row (the menu panel is
portaled to `<body>`, but React events still bubble through the portal to the cell). The mobile card is a `div` holding a main `button` and the same
menu beside it — never a button inside a button. Delete asks first in a small dialog ("Delete this expense?").

**Neutral colours.** Spending is not an error and not a success. Totals use `var(--text-primary)`; the "vs last month" delta shows an arrow in
`var(--text-secondary)` whichever way it points. Never `--status-green-text` / `--status-red-text` in the Expenses components (those are reserved for
state; field errors and the inverted-dates message use the shared `.fos-error` class because they ARE errors). The 12-month chart uses the validated
blue pair `SPENT_BAR_COLORS` (`#2a78d6` light / `#3987e5` dark, mirrored hex of `--chart-series-invoiced`; Recharts writes colours into SVG attributes).
The repo has no `scripts/validate_palette.js`, so no new unvalidated colour was invented. Blue means "money out" on this page and "invoiced" on the
Invoice analytics page; each chart is a single labelled series, so nothing is ambiguous. The category bars use `var(--accent)` like the by-source card.

**Add / edit / copy dialog** (`ExpenseFormModal.jsx` in a `PaymentDialog`, `initialFocus` = the first input): Amount + Currency, Date spent, Category,
Paid to, What it was for, and the checkbox "Deductible business cost" (checked by default; its hint makes no tax promise). The category select starts
at "Choose a category" and saving without one is refused — there is deliberately no default, because a silent default would file most expenses under the
wrong category. Under it, always, a one-line hint that income tax has no category; and, only while "Platform and payment fees" is chosen, a visible
`warning` alert saying a fee is a correct expense only if the income was recorded BEFORE the fee came off (otherwise it is counted twice). It is text,
never a tooltip. Duplicate (from the menu) opens this same dialog as an Add with every field copied, the date set to today (Pakistan date) and an info
line "Copied from ... Check the date and the amount." After a save the server may report a possible duplicate (same amount and category within 3 days);
that is a second step of the same dialog, "Keep both" or "Delete the one I just added" (the NEW expense, never the older one), with no View button
because there is no panel. A Duplicate dated within 3 days of its original triggers that notice by design.

**Rate honesty.** A row whose rate basis is `estimated` or `none` carries an `Info` icon (`role="img"`, `aria-label` = the sentence) and the edit dialog
shows the same sentence as visible text; the notes under the chart say how many expenses were left out or approximated.

The 320px rule applies: the page and every dialog must have `scrollWidth == clientWidth`; the vendor and description are single-line with an ellipsis in
the table and the card.

### Report pages (`/pnl` and `/income-certificate`, 09 November 2026, Prompt 17)

Two routed pages inside `AppShell`, sharing one period control. **Profit and Loss**, top to bottom: flash message, the controls row (the period select, a
"Show amounts in" currency select, the Download PDF button), the cash-basis sentence, the reason Download is disabled (visible text, never a tooltip), the
dates line read from the server's answer, three headline cards (Income received, Expenses, Net profit or Net loss), the income-against-expenses chart, the
"Month by month" table, "Income by source" and "Expenses by category" side by side (stacked at <= 768px), the notes and a link to the statement page.
**Income Statement**: an intro card, "Set up your statement" (period, purpose, addressed to with an n/100 counter, the CNIC and NTN checkboxes, the Download
button with a one-line summary beside it), "What the statement will show" (totals, month table, by source, by original currency, notes) and "Details printed
on the statement".

**The period select, not pills.** Nine presets do not fit a phone as pills, and a native `<select>` is keyboard- and screen-reader-native. Choosing a preset
resolves it to real dates at once; Custom dates reveal two date inputs. Underneath, always, either the resolved dates ("1 Jan 2026 to 9 Nov 2026, 11 months")
or the exact sentence for the problem as a `.fos-error` with `role="alert"`; a tax-year preset adds one tertiary-text note. No quarter presets.

**Exact cents on report pages, whole units on cards.** The Payments and Expenses cards show whole units ("USD 1,235") because they are glances; a report shows
the figure that is printed on the PDF ("USD 1,234.56"). `BreakdownCard` defaults to whole units and the P&L passes `formatAmount={formatExact}`. Table cells
omit the currency code (the column header names it); chart axes are compact.

**Colour.** The three headline values are `var(--text-primary)`: they are a calculation, not good or bad news. A loss is the label "Net loss", a minus sign and
the words, never red; the `--status-green-text` and `--status-red-text` tokens are not used in these components. The chart is the validated green/blue pair
the two amounts already have elsewhere (`COLLECTED_BAR_COLORS` for income, `SPENT_BAR_COLORS` for expenses), with a plain-HTML legend (swatch + word). The
SVG is `role="img"` with a one-sentence label; the same figures are in the visible month table below it.

**Auto-fit KPI grid, not a breakpoint.** `repeat(auto-fit, minmax(220px, 1fr))`: three across when there is room, two or one when there is not. Exact
figures such as "PKR 3,401,834.01" do not fit three across in a narrow main area, and the width of the main area depends on whether the sidebar is open, not
only on the screen, so a fixed breakpoint cannot be right.

**Empty and blocked states.** A disabled Download always says why, in visible text under the button (`Info` icon + sentence): an invalid period, still
loading, failed to load, nothing to put in the report, no convertible payment, an invalid "addressed to". An empty P&L keeps the zero headline cards and
replaces the chart, table and cards with one block and two links ("Record a payment", "Add an expense"). One failed load shows ONE message and one Reload.

**The 320px rule** applies: the page must have `scrollWidth == clientWidth`. The month tables keep a minimum width and scroll sideways inside their own card.

### Health Score page (`/health`) and Dashboard widget (09 November 2026, Prompt 19)

**Page, top to bottom.** (1) Four window pills (`FilterPill`, `aria-pressed`, a `role="group"` labelled "Months to look at"; they wrap onto a
second line at 375px rather than scroll). (2) The score card beside the radar card in a `repeat(auto-fit, minmax(300px, 1fr))` grid; one
column on a phone; with fewer than three scored areas the radar is not rendered at all (no placeholder) and the score card takes the row.
(3) "Where to start" (an ordered list; each step under the small name of its area, the server's text beneath it; no gain badge because the
text already says "worth about N points"). (4) The five area cards in the same auto-fit grid, `align-items: start` (each: points text on the
right of the header, a thin neutral meter, what was measured, what is needed, "More steps for this area" only for steps not already in
"Where to start", and a native `<details>` "How this is scored", closed by default). (5) One static row of links (Payments, Expenses,
Tax & PSEB). (6) The server's notes as `ReportNote` lines. A refetch for a new window dims the content to 0.55 and keeps it; an error shows
one `FosAlert` with Reload inside the score card and the picker stays usable.

**Colour rule.** The grade is a judgement, so the grade badge and the fill of the big score meter use the status tokens (green for Excellent
and Good, amber for Fair, red for Poor, gray for an unknown grade) AND the grade word is always written, so colour is never the only signal
(a grayscale screenshot was checked). Nothing else on the page uses a status colour: the five area bars are neutral (`--accent` on
`--bg-surface-3`, like `BreakdownCard`) because a wall of red cards helps nobody and the points text carries the meaning. The score number is
`--text-primary`.

**Radar.** One neutral series, stroke 2px and fill at 0.18 opacity, in the existing `--accent-dim` token mirrored as hex
(`HEALTH_RADAR_COLORS`: light `#00a87e`, dark `#00c896`), because SVG attributes do not resolve `var()` reliably (the same reason as the
bar colours). Axis domain 0 to 100 (percent of each area's own points), radius numbers hidden, grid rings in `--border-subtle` (they
resolve in both themes). The axis labels are custom two-line ticks nudged away from the centre so a full-marks vertex never touches them.
The SVG is hidden from assistive tech and the wrapper is a `role="img"` with a one-sentence label that points at the area cards: the radar is
a glance, every figure in it is also visible text.

**Unknown is not zero, for charts too.** An area with too little data has no percent. The polygon needs a value, so it is plotted at the
centre, but its axis label has a second line "not scored" in `--text-tertiary`, the tooltip says "Not scored", and a sentence under the chart
says the centre does not mean zero. A "No score yet" state never shows a 0 anywhere (not in the big number, not in a meter).

**Dashboard widget.** A `DashboardCard` titled "Financial health", subtitle "Last N full months", ONE "Details" link (with an arrow icon) in
the header; the card itself is never a link. Score state: the number (2.4rem), "/ 100", the grade badge, a meter, "Based on the areas that
could be scored." when partial, then "Best next step" and the server's full text (never truncated: a clamped sentence would hide "worth
about N points"). No score: "No score yet", the server's message and a text link "See what is needed". It owns its request and is always
rendered (loading is a skeleton of the final height; an error is `DashboardUnavailable` inside its own card), so it neither delays nor
hides, and is neither delayed nor hidden by, the rest of the Dashboard. Grid areas and the mobile order are in "Dashboard layout" above.

### Tax page (`/tax`, 10 November 2026, Prompt 21)

One page, three views, chosen by `?view=` and a row of real links (not ARIA tabs): Estimate (default), Calculator, How this works. The row is a
`<nav aria-label="Tax views">` of `<Link>`s with `aria-current="page"` on the active one, the underline of the Settings tab row, and it scrolls sideways
inside itself on a phone (the page never does). Below it, on the Estimate and Calculator views only, the shared **tax-year pills** (`FilterPill`s in a
`role="group"`, `aria-pressed`), whose list comes from the server.

- **Hidden, not unmounted.** All three views are mounted from the first render and the inactive ones carry `hidden`, so typed input and a loaded estimate
  survive switching. The three wrappers must NOT carry an inline `display` style: it overrides `hidden` and the Estimate shows through on the Calculator.
- **Colour.** Tax is a calculation, not good or bad news: figures are `--text-primary`, never red or green. The only status colours are the checklist
  icons (`--status-green-text` done, `--status-amber-text` to do, `--text-tertiary` check) and the status is always written as a word ("Done", "To do",
  "Check"). Confidence badges are neutral (`--bg-surface-3`, `--text-secondary`) and carry the word.
- **Server sentences only.** Every sentence about tax and every figure is rendered from the server's payload as a plain text node (`overflowWrap:
  'anywhere'`); no static string states a rate, a band or a date (a test scans for percent figures and dates). Money in tables comes through `plainAmount` /
  `formatExact`; the month table's footer row is the server's totals.
- **Cards.** The headline strip is the `PnlKpiStrip` recipe (auto-fit `minmax(220px, 1fr)`, dims to 0.55 while a refetch runs, never unmounts); the rate card
  and the summary-download card sit side by side on a `minmax(300px, 1fr)` grid; tables are `MonthlyTable` (the footer is the server's); a year with no payment
  at all shows the empty-year card ("No payments in tax year N", a "Record a payment" link) instead of the tables, while a PKR-only year is NOT empty.
- **States.** First load: skeletons with the final footprints under one status ("Loading your tax estimate"); a refetch dims and keeps the content; a failure
  shows one alert with Reload (the year pills stay usable). The calculator is an explicit form with the field error under the input and the result in an
  `aria-live="polite"` region.

### Help page (`/help`, `/help/:slug`, 13 November 2026, Prompt 26)

One route (`/help/:slug?`), one component, two views: the **home** view and the **guide** view. It has no sidebar item; the profile menu's Help item opens it. Every
guide, notice and answer sentence is the server's, drawn as a plain text node (`overflowWrap: 'anywhere'`).

- **Two modes, one box (`HelpSearchBox`).** Search mode (the default) is a `role="search"` form with a magnifier icon, no button and no AI line; typing searches the guides after
  350 ms. Ask mode (only when the index says `answers_enabled: true`) adds an **Ask** button (primary, `Send` icon), a hint line and the "sent to an outside AI service" line as
  always-visible text under the box. The box owns what each mode shows; the page passes the same text to both. The input is 16 px (iOS does not zoom), 46 px tall; the clear
  button is 44 x 40; the row wraps so it fits 375 px. While the index loads the box is a skeleton of the same height.
- **The result area replaces the browse area.** With a search or an answer to show, "Matching guides" or the answer card takes the place of "Popular guides" + "Browse by
  topic"; clearing the box brings them back. A refetch dims the list to 0.55 and never unmounts it.
- **Cards.** `HelpCard` is the standard card (DESIGN.md Section 7, `--bg-surface`, 1 px `--border-subtle`, `--radius-lg`, header `16px 20px` with a bottom rule, body
  `16px 20px`) as a labelled `<section>` whose `h2` has `tabIndex={-1}` so it can receive focus. Card titles are `h2`; a topic's name inside the topic grid is `h3`.
- **Browse by topic.** `repeat(auto-fit, minmax(280px, 1fr))`, 16 px gap, always expanded (a table of contents): one card per topic with its blurb and a plain link per
  guide. The reading column (search, results, answer, guide) is at most 860 px; the topic grid may use the full width.
- **Guide rows (`HelpGuideLinks`).** One router link per row: title (600), one-line summary (`--text-secondary`), a neutral topic label written as a word, a
  `ChevronRight`. Hover is `--bg-surface-3` through `hoverProps` (touch ignored); the browser's focus ring is kept.
- **Blocks (`HelpBlocks`).** One component for a guide and for an answer, so they cannot look different: paragraph, real `<ol>` for steps, a bordered note with an `Info`
  icon, a ghost link button with `ArrowRight`. Block gap 12 px.
- **Answer card.** "You asked: ..." (as text), the blocks, the source note, "From these guides", then the rating row (ghost buttons, each an icon AND a word; the thank-you
  line is inside a polite live region that is always mounted). A guides-only or off-topic result shows the server's notice in an info alert instead, "Closest guides" when
  there are any, and "Still stuck? Email ..." only for a plain address; it has no rating row and no source note. The card heading takes focus when a result arrives.
- **Guide view.** A back link ("All help"), the topic as a neutral label, the title as the card heading (focus target after a slug change), the summary as its subtitle, the
  blocks, "Last checked on ...", and "Related guides". A first load is a skeleton of the final footprint under one status line; a guide that does not exist shows the
  sentence, a hint and the back link with no Reload button; any other failure shows an alert and Reload.
- **Colour and words.** Nothing is red or green for meaning: the only status colours are those of `FosAlert`. Secondary and small text use `--text-secondary` (the tertiary
  token does not reach 4.5:1 on the card background); topic labels are neutral and carry the word. Measured in a real browser: result summary 8.54:1 light and 7.42:1 dark,
  topic label 7.52:1 and 6.18:1.

## 8. Animation and Transitions

### Timing tokens
```css
--t:    0.32s cubic-bezier(0.4,0,0.2,1)  /* sidebar width/transform, layout shifts */
--fast: 0.18s ease                         /* color changes, icon transitions */
--pill: 0.28s cubic-bezier(0.22,1,0.36,1) /* nav pill sliding */
--transition-fast: 0.15s ease              /* hover micro-interactions */
--transition-base: 0.25s ease              /* background/theme transitions */
```

Use `var(--t)` for anything involving sidebar or layout geometry.
Use `var(--transition-fast)` or `0.15s ease` for hover/focus interactions.
Use `var(--pill)` only for the sidebar nav pill.
Never write a duration or easing that isn't one of the above.

### Page transition
None. Route changes are instant. Do not add page-level transitions.

### Hover interactions
Hover state that is set from JS (because inline styles cannot use :hover) goes
through `hoverProps` (`src/lib/hoverProps.js`), never `onMouseEnter`/`onMouseLeave`:
```jsx
{...hoverProps(
  e => { e.currentTarget.style.background = 'var(--bg-surface-2)' },
  e => { e.currentTarget.style.background = 'var(--bg-surface)' },
)}
```
Why: on a touch screen a tap fires the compatibility `mouseenter` but no `mouseleave`
until some other element is tapped, so a hover look set on enter stayed stuck.
`hoverProps` is built on pointer events and ignores `pointerType === 'touch'`.
Anything that CAN be a CSS rule is a class with its `:hover` inside
`@media (hover: hover)` instead (`.fos-btn-*`, `.nav-item`, table rows, ...), for the
same reason: iOS/Android Safari/Chrome leave `:hover` applied after a tap.
Transition on the element's style prop: `transition: 'background var(--transition-fast)'`

### Tooltips
`data-tooltip="Text"` on an element is all a tooltip needs. One delegated controller
(`src/hooks/useAppTooltip.js`, installed once in `main.jsx`) shows the shared
`.app-tooltip` after a 500ms mouse/pen hover or on keyboard focus, and dismisses it on
click, any key (Escape included), scroll, wheel, resize, route change, tab hide, or the
target leaving the DOM. Touch NEVER shows one. So a tooltip is only ever a convenience
for icon-only controls — it must not be the only place a piece of information lives
(that goes in visible text), and the control still needs an `aria-label`. Do not bind
tooltip listeners per element and do not call anything after render to "wire up" tooltips.
The collapsed sidebar rail is the one exception in mechanism: its items use the
pure-CSS tooltip keyed off `data-tip` (it opens to the side of the rail), gated to
`(hover: hover) and (pointer: fine)` plus `:focus-visible`; they must not also carry
`data-tooltip`.

---

## 9. Auth Pages Design

Auth pages use the same token system as the rest of the app but with
a fixed deep-dark background that does not respond to the theme toggle.

### Background
```css
background: #050508;
background-image: radial-gradient(ellipse 70% 55% at 50% 42%,
  #100a1c 0%, #060309 45%, #050508 82%);
background-attachment: fixed;
```

### Layout
Two-column CSS Grid (`1fr 1fr`). Left = orbit visualization (hidden ≤860px).
Right = form, max-width 360px (480px for Register), centered.

### Auth-specific color palette (fixed, not from theme tokens)
```
Page background:   #050508
Input background:  #141126
Input border:      #342E58  (focus: #A89CF2)
Placeholder text:  #8074C0
Primary button:    #A89CF2 background, #F6F4FE text
Link / accent:     #A89CF2
Success:           #5FD08A
Error:             #F2748B
```

### Auth form fields
- Height: `3.1rem`
- Border-radius: `10px`
- Border: `1px solid` (auth palette input border)
- Floating label pattern: label animates via `:not(:placeholder-shown)`
- All inputs force `font-size: 16px` on mobile to prevent iOS auto-zoom

### Auth buttons
- Full width, height `2.5rem`, border-radius `20px` (full pill)
- Primary: solid `#A89CF2` background
- Ghost: transparent with border
- Google: ghost + inline Google "G" SVG

### Orbit visualization (left panel)
Three concentric rings, container-query sized.
Outer + inner: `clockwise 30s linear infinite`
Middle: `counter-clockwise 23s linear infinite`
Icon nodes counter-rotate to stay upright.
Node badges: 13cqw circles, `background: rgba(6,3,20,.32)`,
`border: 1px solid rgba(150,110,255,.9)`, `backdrop-filter: blur(10px)`

### Starfield
110 randomly-placed divs, 0.6–2.6px, twinkle animation with random
delay/duration (3–7s). Disabled under `prefers-reduced-motion: reduce`.

---

## 10. Public / Unauthenticated Pages

Invoice View, Contract View, Payment Page, Proposal View, Income
Certificate — these use a single fixed light palette, not theme.css, and
have no dark mode. The Client Portal is the one deliberate exception as
of Client Portal Redesign, Phase 3.5 — see its own subsection below.

In v2, all public pages share ONE light palette (v1 had three
inconsistent ones):

```
Page background:  #f8fafc
Card background:  #ffffff
Card border:      rgba(0,0,0,.08)
Card shadow:      0 2px 12px rgba(0,0,0,.07)
Card radius:      12px
Primary navy:     #1e3a5f  (headings, amounts, labels)
Secondary navy:   #2e5987  (sub-headings)
Accent teal:      #00c896  (status indicators, links, CTAs)
Body text:        #334155
Muted text:       #64748b
Divider:          rgba(0,0,0,.07)
```

These pages do NOT use `var(--*)` tokens from theme.css.
They are self-contained with hardcoded values from this palette only.
Never introduce a fifth navy hex — use `#1e3a5f` or `#2e5987` only.

**Proposal page (`/proposal/:token`, `ProposalPublic.jsx` — added 04 November 2026).** The client's page follows
this section exactly (fixed light palette, no AppShell, no theme tokens, stays light under an OS dark scheme —
verified). Specifics:
- Layout: one centred card, max-width 760, padding 28/24 (20/16 below 560px), font `'DM Sans'`; the document
  (`ProposalDocument.jsx`) is shared with the freelancer's in-app Preview so what they preview is what the client sees.
- Answering is a **three-step flow, not a one-click button**: choose Accept / Decline, then a confirm step (heading,
  an optional message with an `n / 1000` counter counted in code points, "Your answer is final"), then a recorded
  block. Focus moves to the confirm heading, then to the result heading.
- **The primary button is navy `#1e3a5f` with white text, not accent `#00c896`**: white on `#00c896` is about 2:1
  contrast. Tap targets are at least 44px tall; focus rings are visible (3px `#2e5987`).
- Print: `@media print` hides the print button, banners and the response area, drops the page background, card
  border and shadow, and avoids breaking table rows and sections across pages.
- Wording never claims the sender was notified, and never claims legal effect (a button on a web page is not a
  signature); a test scans the page's `COPY` object for `notif|signed|signature|legally|binding|contract`.
- It is kept out of search engines and Referer headers (`<meta>` tags while mounted, plus `vercel.json` headers).

### 10a. Client Portal — light AND dark, self-contained, portal-only

REVISED, Phase 3.5 (deliberate rule change, not an oversight — the rule
above, "fixed light palette only," held for the Client Portal through
Phase 3): the Client Portal (`PortalShell.jsx` and everything that
renders inside it — `PortalOverview.jsx`/`ClientPortal.jsx`/
`PortalPayments.jsx`/`PortalBalances.jsx`/`PortalEnter.jsx`/
`PortalRequestLinkForm.jsx`/`PortalLayout.jsx`, and `CommentThread.jsx`'s
`palette="public"` path) now has a real light AND dark theme, both fully
self-contained — genuinely independent of theme.css, never a copy of it.

**This is NOT theme.css's `[data-theme]` mechanism reused.** A second,
wholly separate CSS custom-property namespace
(`frontend/src/pages/portal/portalTheme.css`), every variable prefixed
`--portal-*` so nothing can collide with or be confused for a theme.css
token, scoped under a `data-portal-theme="light"|"dark"` attribute set
on `PortalThemeRoot.jsx`'s own wrapper div — never on `<html>` or
`<body>`. This isolation is load-bearing, not incidental: theme.css's
own `[data-theme]` reflects the FREELANCER's own authenticated-app
preference; reusing it (or its tokens) for the portal would silently
couple a page a client — who has no such setting — is looking at to
someone else's toggle, exactly the regression Phase 0 fixed once
already.

```
                     Light            Dark
Page background      #f8fafc          #0d0d16
Card background       #ffffff          #17171f
Card border         rgba(0,0,0,.08)  rgba(255,255,255,.1)
Divider             rgba(0,0,0,.07)  rgba(255,255,255,.08)
Heading (NAVY)        #1e3a5f          #f4f4fa
Heading, secondary    #2e5987          #c9c9ea
Body text             #334155          #cfcfe0
Muted text            #64748b          #9292ab
Accent teal           #00c896          #00c896  (unchanged — 8.93:1
                                                   against the dark bg)
Error                #c0392b          #ff6b6b  (brightened — light
                                                   value was 3.55:1 on
                                                   dark, fails WCAG AA)
Warning               #8a7d5c          #d4b483  (brightened — light
                                                   value was 4.38:1 on
                                                   the dark card, marginal
                                                   for small badge text)
Button fill        #1e3a5f          #2e5987  (a primary button needs
                                                   its own token, separate
                                                   from heading — reusing
                                                   the heading color broke
                                                   dark-mode button text,
                                                   a real bug caught while
                                                   building this)
```

The dark palette is designed FROM theme.css's own dark-mode tokens as a
reference point (`--bg`/`--card-bg`/`--text-primary` etc.) but is not a
copy of them — every value above was chosen and contrast-checked for
this specific palette. Every color pairing a real component uses for
readable text is checked against WCAG AA (4.5:1) at build time by
computation, not by eye.

**Default**: matches the visitor's OS `prefers-color-scheme` on first
load, when no stored preference exists yet (`usePortalTheme.js`, mirrors
`useTheme.js`'s own `matchMedia('(prefers-color-scheme: dark)')`
pattern). **Manual override**: a real toggle in the account menu,
persisted in `localStorage` under `lanceraos-portal-theme` — a distinct
key from `useTheme.js`'s own `lanceraos-theme`, and a per-device
preference only; no backend field, no `Client` model change.

Component files reference these tokens exactly as the fixed-light-only
pages reference literals — the difference is invisible at the call
site: `portalShared.js`'s exported constants (`NAVY`, `ACCENT`,
`MUTED_TEXT`, etc.) now resolve to `var(--portal-*)` strings instead of
literal hex, so every component that already imports them re-themes
automatically. A component-level modal backdrop/lightbox overlay
(`rgba(0,0,0,.6)` and similar) is a deliberate exception, left as a
literal in both themes — a translucent dark scrim reads correctly
regardless of the page underneath it, and DESIGN.md's own Section 10
palette table above never listed an overlay value to begin with.

---

## 11. Responsive Breakpoints

Two breakpoints only. Do not add new breakpoints.

```
768px   primary app breakpoint — sidebar becomes drawer, header changes,
        mobile FABs appear, padding reduces. Governed by AppShell isMobile state.
860px   auth-only breakpoint — orbit visualization hides, grid collapses.
```

For content inside pages, prefer `repeat(auto-fit, minmax(240px, 1fr))`
fluid grids over explicit breakpoints. Cards reflow naturally without
needing media queries.

Mobile-specific patterns:
- iOS auto-zoom prevention: `@media (max-width: 768px) { input, select, textarea { font-size: 16px !important } }` in theme.css
- FAB pattern (mobile-only new item button):
```jsx
// In a <style> block at the bottom of the page file:
`@media (max-width: 768px) { .page-fab { display: flex !important } }`

// The element:
<button className="page-fab" style={{
  display: 'none',
  position: 'fixed',
  bottom: 24,
  right: 24,
  width: 56,
  height: 56,
  borderRadius: '50%',
  background: 'var(--accent)',
  color: '#000',
  border: 'none',
  boxShadow: '0 4px 20px var(--accent-glow-lg)',
  // ...
}} />
```

---

## 12. Rules for AI Building New Pages

These are firm rules, not suggestions.

DO use `var(--bg-surface)` + `1px solid var(--border-subtle)` +
`var(--radius-lg)` + no box-shadow for any standard card at rest.

DO use `.fos-btn` classes for all buttons. Do not create a new
inline button style. The global classes exist for this.

DO use `.fos-input` / `.fos-label` / `.fos-error` for form fields.
Do not create a local `inputStyle` object.

DO use `var(--status-green/amber/red/blue/gray)` and their `-bg` / `-text`
variants for all status colors. Never hardcode a status hex.

DO use `var(--accent)` instead of `#00c896` when you need the teal accent
in page content. This was the v1 failure point — v1 used `var(--teal, #00c896)`
but never defined `--teal` at all, causing a silent fallback everywhere. v2's
real, defined token for this color is `--accent`, not `--teal` — verified
directly against `theme.css`, which defines no `--teal` custom property.

DO render all status/category badges as:
`border-radius: var(--radius-full); padding: 3px 8px; font-size: 0.72rem;
font-weight: 600; background: var(--status-X-bg); color: var(--status-X-text)`

DO use `var(--transition-fast)` or `0.15s ease` for hover transitions.
Never write `transition: all` anywhere.

DO use `hoverProps` (never `onMouseEnter` / `onMouseLeave`) for JS-driven hover state
changes, and `@media (hover: hover)` around any CSS `:hover` rule on a tappable control,
so a touch tap cannot leave a stuck hover state.

DO reuse the `spin` keyframe for spinners and `skeleton-pulse` for
loading skeletons. Never define a new keyframe name for these patterns.

DO check the z-index table (Section 5) before setting any z-index.
Slide panel overlays = 100. Modals = 200. Toasts = 500.

DO use the `panel-slide-in` and `modal-in` keyframes defined above
for all panel and modal entrances. No exit animation — instant unmount.

DO keep the main content layout as `position: fixed` with the inner
scroll div pattern. Do not change to margin-left or any other layout model.

DO NOT use Tailwind utility classes anywhere in authenticated app JSX.
Tailwind is for the landing page only.

DO NOT use `backdropFilter` in page content. Glass blur effects exist
only in the sidebar nav pill and nav item hover.

DO NOT hardcode any color for structural elements (backgrounds, borders,
primary text). All structural colors must use `var(--*)` tokens.

DO NOT define per-page `<style>` blocks for anything except:
@keyframes, @media queries, and the FAB mobile-display hack.
Everything else is inline style objects.

AMENDED: `AuthField.jsx` (a shared component, not a page) uses a scoped
`<style>` block implementing the floating label via CSS's
`:not(:placeholder-shown)` + a `::before` notch to hide the border
behind the floated label — this replaced an earlier JS-state-driven
version specifically because the CSS-native approach is the correct,
well-established technique for this exact problem, and (like the
`-webkit-autofill` override already documented) genuinely cannot be
done via inline styles or JS. `Login.jsx` similarly uses a small
page-level `<style>` block for its custom circular checkbox's checkmark
(a CSS border-trick, not a text/emoji character — doesn't conflict with
Section 0b), since drawing that shape requires either a pseudo-element
or an absolutely-positioned icon overlay. Treat both as the same kind
of reasoned exception as the `Card.jsx`/`FormField.jsx` amendment below:
a genuine "can't be done inline" case, not a default to reach for.

DO NOT create new shared utility components (Modal, Badge, Table) for
authenticated app pages. v2 keeps the inline-object pattern by default.
The exception: buttons and form inputs use the global `.fos-*` classes.

AMENDED during the Settings/Profile build: `Card.jsx`, `FormField.jsx`,
`FormSelect.jsx`, `FosAlert.jsx`, and `SaveButton.jsx` now exist as
shared components in `src/components/`. This is a deliberate, reasoned
exception, not drift — see DECISIONS.md for the full reasoning. In
short: `FormField`/`FormSelect`/`FosAlert`/`SaveButton` wrap the
existing `.fos-*` classes rather than introducing new styling (they
extract the repeated label+input+error JSX *structure*, not new visual
rules); `Card` is a genuine new structural component, justified because
Settings' 7 sections and Profile all needed an identical title/subtitle/
action bordered-container, and duplicating that inline 8 times would
itself violate STANDARDS.md's single-source-of-truth rule. Any future
module needing this same title/subtitle/action card shape should reuse
`Card.jsx`, not create a second near-identical wrapper.

DO NOT introduce a new navy hex on public pages. Use `#1e3a5f` or
`#2e5987` only. v1 had three inconsistent navies — v2 has two.

DO NOT write `var(--shell-bg)` or `var(--shell-text)` in page
components — these shell-specific tokens are for AppShell.jsx only.

DO NOT assume an SVG displacement filter (#glass) exists. It does not.
The glass effect is achieved entirely with backdrop-filter + --glass-shadow.


## 13. Brand Assets — Canonical Reference

All logo and wordmark usage across the entire project must reference
these canonical definitions. No AI chat, no component, and no page
may recreate, approximate, or substitute these assets.

---

### Logo Mark

**File location:** `frontend/public/logo.svg`

**Usage in React — via img tag** (email templates, PDF headers,
any context where inline SVG is not practical):
```jsx
<img
  src="/logo.svg"
  alt="LanceraOS"
  width={32}
  height={32}
  style={{ display: 'block', flexShrink: 0 }}
/>
```

**Usage in React — inline SVG** (AppShell sidebar, auth pages,
anywhere logo color must respond to CSS variable tokens):
```jsx
function LogoSVG({ size = 32 }) {
  return (
    <svg
      viewBox="0 0 516 600"
      fill="none"
      style={{ width: size, height: size, display: 'block', flexShrink: 0 }}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M234.052 13.7852C248.877 5.25155 267.122 5.25154 281.947 13.7852L491.947 134.673C506.828 143.239 516 159.102 516 176.272V423.731C516 440.902 506.828 456.764 491.947 465.331L281.953 586.215C267.128 594.748 248.883 594.748 234.059 586.215L24.053 465.324C9.17189 456.758 0 440.895 0 423.725L0 176.272C0 159.101 9.17187 143.239 24.053 134.672L234.052 13.7852Z"
        fill="var(--logo-body)"
        style={{ transition: 'fill var(--t)' }}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M100 201.098C100 196.77 102.302 192.77 106.039 190.606L190.589 141.641C198.641 136.978 208.707 142.807 208.707 152.134L208.707 381.643L118.118 434.105C110.065 438.768 100 432.939 100 423.613L100 201.098ZM319.199 438.377C315.469 440.537 310.875 440.541 307.141 438.389L208.707 381.643L317.812 318.459C321.549 316.295 326.153 316.295 329.89 318.459L409.961 364.83C418.013 369.493 418.013 381.152 409.961 385.815L319.199 438.377Z"
        fill="var(--logo-mark)"
        style={{ transition: 'fill var(--t)' }}
      />
    </svg>
  )
}
```

**Color tokens that control the logo:**
```css
--logo-body: #8074c0   /* hexagon background shape */
--logo-mark: #050508   /* L-mark inner shape */
```

Never hardcode `#8074c0` or `#050508` directly in a component.
Always use the CSS variable tokens so the logo transitions correctly
with theme changes.

---

### Wordmark (LanceraOS logotype)

**Usage in React:**
```jsx
function WordmarkSVG({ width = 140, height = 21 }) {
  return (
    <svg
      viewBox="0 0 140 21"
      fill="none"
      width={width}
      height={height}
      aria-label="LanceraOS"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path
        fill="var(--wordmark)"
        d="M2.55993 17.76H15.4239V20.192H-6.83367e-05V0.255999H2.55993V17.76ZM42.8107 20.192V12.96C42.8107 11.424 42.4907 10.176 41.8507 9.216C41.2107 8.256 40.0693 7.81866 38.4267 7.904C37.168 7.98933 35.8773 8.69333 34.5547 10.016C34.2133 10.336 33.4773 11.1787 32.3467 12.544C30.96 14.2293 29.9253 15.4347 29.2427 16.16V20.192H26.6827V18.4C26.3413 18.7413 25.712 19.1787 24.7947 19.712C23.8773 20.224 22.8213 20.4587 21.6267 20.416C20.048 20.3733 18.7573 19.9787 17.7547 19.232C16.7733 18.464 16.2613 17.3867 16.2187 16C16.176 14.4427 16.72 13.2053 17.8507 12.288C18.9813 11.3707 20.5493 10.912 22.5547 10.912H26.6507C26.6507 9.84533 26.3307 9.12 25.6907 8.736C25.072 8.33066 24.176 8.128 23.0027 8.128H18.1387V5.696H22.8747C25.008 5.696 26.5653 6.10133 27.5467 6.912C28.5493 7.72267 29.104 9.024 29.2107 10.816V11.296L26.6827 14.144V13.344H22.5547C21.424 13.344 20.5387 13.5467 19.8987 13.952C19.28 14.3573 18.96 14.9227 18.9387 15.648C18.9173 16.3307 19.12 16.8747 19.5467 17.28C19.9947 17.664 20.6027 17.888 21.3707 17.952C22.1813 18.0373 23.056 17.8347 23.9947 17.344C24.9333 16.832 25.8293 16.1387 26.6827 15.264C27.8987 14.0267 29.2853 12.416 30.8427 10.432C30.9707 10.2613 31.0453 10.1653 31.0667 10.144V5.696H33.6267V7.52C35.0133 6.21866 36.6133 5.536 38.4267 5.472C40.816 5.38666 42.5653 6.048 43.6747 7.456C44.8053 8.864 45.3707 10.6987 45.3707 12.96V20.192H42.8107ZM31.0667 15.36L33.7227 12.128L33.6267 20.192H31.0667V15.36ZM65.0569 19.68C64.0329 19.168 63.1689 18.4747 62.4649 17.6C62.4649 17.6 61.9743 17.8773 60.9929 18.432C60.0329 18.9653 58.9236 19.4453 57.6649 19.872C56.4276 20.2773 55.2329 20.4693 54.0809 20.448C52.7369 20.4053 51.4889 20.0533 50.3369 19.392C49.2063 18.7093 48.2996 17.8027 47.6169 16.672C46.9556 15.5413 46.6249 14.304 46.6249 12.96C46.6249 11.616 46.9556 10.368 47.6169 9.216C48.2996 8.064 49.2063 7.15733 50.3369 6.496C51.4889 5.83466 52.7369 5.504 54.0809 5.504C55.4463 5.504 56.7156 5.84267 57.8889 6.52C59.0623 7.17599 60.0009 8.07466 60.7049 9.216L58.4409 10.688C58.0356 9.92533 57.4596 9.312 56.7129 8.848C55.9876 8.36266 55.1769 8.12 54.2809 8.12C52.9796 8.12 51.8703 8.58667 50.9529 9.52C50.0356 10.4533 49.5769 11.6053 49.5769 12.976C49.5769 14.3253 50.0249 15.4667 50.9209 16.4C51.8383 17.3333 52.9796 17.8 54.3449 17.8C55.2409 17.8 56.0729 17.5787 56.8409 17.136C57.6303 16.672 58.2276 16.0587 58.6329 15.296L60.8969 16.736C60.2143 17.8773 59.2649 18.7867 58.0489 19.464C56.8329 20.1413 55.5209 20.48 54.1129 20.48C52.7476 20.48 51.4889 20.1413 50.3369 19.464L65.0569 19.68ZM89.3262 5.696H94.0622C96.3235 5.696 97.9448 6.15466 98.9262 7.072C99.9288 7.98933 100.43 9.48266 100.43 11.552V20.192H97.8702V18.4C97.8488 18.4213 97.8275 18.4427 97.8062 18.464C97.2728 19.04 96.7288 19.4987 96.1742 19.84C95.6195 20.16 94.8195 20.352 93.7742 20.416C91.9395 20.544 90.4248 20.224 89.2302 19.456C88.0568 18.688 87.4488 17.536 87.4062 16C87.3635 14.4427 87.9075 13.216 89.0382 12.32C90.1688 11.4027 91.7368 10.944 93.7422 10.944H97.8382C97.8382 9.856 97.5182 9.12 96.8782 8.736C96.2595 8.33066 95.3635 8.128 94.1902 8.128H89.3262V5.696ZM97.8702 13.344H93.7422C92.6115 13.344 91.7262 13.5573 91.0862 13.984C90.4675 14.3893 90.1475 14.944 90.1262 15.648C90.0835 16.544 90.4248 17.184 91.1502 17.568C91.8755 17.952 92.8035 18.0587 93.9342 17.888C94.6595 17.7813 95.3102 17.5253 95.8862 17.12C96.4622 16.6933 96.9315 16.2453 97.2942 15.776C97.6782 15.3067 97.8702 15.072 97.8702 15.072V13.344ZM106.182 1.376C107.761 0.458665 109.478 0 111.334 0C113.169 0 114.865 0.458665 116.422 1.376C117.98 2.29333 119.217 3.53067 120.134 5.088C121.052 6.64533 121.51 8.352 121.51 10.208C121.51 12.0427 121.052 13.7493 120.134 15.328C119.217 16.8853 117.98 18.1227 116.422 19.04C114.865 19.9573 113.169 20.416 111.334 20.416C109.478 20.416 107.761 19.9573 106.182 19.04C104.625 18.1227 103.388 16.8853 102.47 15.328C101.553 13.7493 101.094 12.0427 101.094 10.208C101.094 8.352 101.553 6.64533 102.47 5.088C103.388 3.53067 104.625 2.29333 106.182 1.376ZM115.078 3.712C113.926 3.02933 112.678 2.688 111.334 2.688C109.969 2.688 108.71 3.02933 107.558 3.712C106.406 4.37333 105.489 5.28 104.806 6.432C104.145 7.584 103.814 8.84267 103.814 10.208C103.814 11.5733 104.145 12.832 104.806 13.984C105.489 15.1147 106.406 16.0213 107.558 16.704C108.71 17.3653 109.969 17.696 111.334 17.696C112.678 17.696 113.926 17.3653 115.078 16.704C116.23 16.0213 117.137 15.1147 117.798 13.984C118.481 12.832 118.822 11.5733 118.822 10.208C118.822 8.84267 118.481 7.584 117.798 6.432C117.137 5.28 116.23 4.37333 115.078 3.712ZM139.476 12.384C140.159 13.0667 140.159 14.1973 139.476 14.88L134.852 19.504C134.169 20.1867 133.039 20.1867 132.356 19.504L127.732 14.88C127.049 14.1973 127.049 13.0667 127.732 12.384L132.356 7.76C133.039 7.07733 134.169 7.07733 134.852 7.76L139.476 12.384Z"
      />
    </svg>
  )
}
```

**Color token that controls the wordmark:**
```css
--wordmark: #0e0e1a (light mode)  /  #ffffff (dark mode)
```
No longer a fixed white — see Section 2.8, the shell now follows the theme toggle.

---

### Usage Rules

DO use `<LogoSVG>` (inline SVG) in the AppShell sidebar, the auth
page orbit center, and the NotFound page — anywhere the logo color
must respond to `--logo-body` and `--logo-mark` CSS tokens.

DO use `<img src="/logo.svg">` in email templates and PDF headers
where inline SVG is not practical.

DO use `<WordmarkSVG>` alongside `<LogoSVG>` in the AppShell header
and auth pages. The wordmark fades/collapses when the sidebar is
collapsed — handle this with opacity and max-width transitions on the
wrapper, never by unmounting the component.

DO keep logo and wordmark as separate components, never merged into
one SVG, so they can be shown/hidden independently (collapsed sidebar
shows logo only, no wordmark).

DO NOT hardcode `#8074c0`, `#050508`, or `#ffffff` for brand assets.
Use `var(--logo-body)`, `var(--logo-mark)`, `var(--wordmark)`.

DO NOT stretch, rotate, recolor, add effects to, or alter the
proportions of the logo or wordmark under any circumstances.

DO NOT recreate either asset using CSS, Unicode, or any approximation.

---

### Where Each Asset Appears

| Location | Logo | Wordmark |
|---|---|---|
| AppShell sidebar expanded | ✓ LogoSVG | ✓ WordmarkSVG (fades on collapse) |
| AppShell sidebar collapsed | ✓ LogoSVG | ✗ hidden |
| AppShell mobile drawer | ✓ LogoSVG | ✓ WordmarkSVG |
| Auth pages (orbit center) | ✓ LogoSVG | ✓ WordmarkSVG (mobile brand lockup) |
| NotFound page | ✓ img tag | ✓ WordmarkSVG |
| Browser tab favicon | ✓ /logo.svg (index.html) | ✗ |
| Email templates | ✓ img tag (Cloudinary hosted) | ✗ |
| PDF documents (WeasyPrint) | ✓ img tag | ✗ |

---

## 14. Notifications

**Every notification must navigate somewhere when clicked — this is a hard rule, not a
preference.** A notification with nowhere to go is a broken notification. Concretely: every event
in the notification bell's allowlist (`core/notifications.py`'s `NOTIFICATION_EVENTS`) must have a
corresponding, real, non-null entry in `EVENT_ACTION_URLS` — never left to fall through to `None`.
When a future module adds a new event to that allowlist, it must add its `action_url` in the same
change, not as a follow-up. Verified as actually working, not just planned: all 8 current event
types return real, non-null `action_url` values, confirmed via direct API testing.

"Dismissing" a notification (delete, from the user's point of view) must never touch the
underlying `AuditLog` row it's derived from — `AuditLog` is immutable and append-only by design
(see its own docstring: it has to say what the system believed was true *at the time*, never
edited afterward). Dismissal is tracked separately, on `NotificationRead.dismissed_at`, and only
hides the notification from what the bell shows — the security record itself is untouched. This
was verified directly, not assumed: dismissing a notification removes it from
`GET /api/notifications/` while a direct database query confirms the `AuditLog` row is still
present, unchanged.
| Public invoice/contract pages | ✓ img tag | ✗ |