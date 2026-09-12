import React from 'react';

// Prompt 29 item 1: a small shared set of stroke-based icons, matching
// the visual language CanvasItem.jsx's own RotateIcon already
// established (24x24 viewBox, `stroke="currentColor"`, round caps/joins,
// no fill) — used everywhere the app previously reached for a raw emoji
// character as a UI icon (layers panel show/hide + lock, save-validation
// severity markers, the sidebar collapse chevrons, preview modal close,
// the image pixelation badge). One visual language, not a mix of styles
// across the icons being replaced.
const base = { viewBox: '0 0 24 24', fill: 'none' };

export function EyeIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M2 12S5.5 5 12 5s10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function EyeOffIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M6.3 6.3C3.6 8 2 12 2 12s3.5 7 10 7c1.4 0 2.6-.24 3.7-.64M9.9 5.2A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a15.6 15.6 0 0 1-3.3 4.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function LockIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} {...base}>
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function UnlockIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} {...base}>
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M4 12.5l5 5L20 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WarningIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M12 3.5 21 19.5H3L12 3.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 9.5v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ErrorIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
