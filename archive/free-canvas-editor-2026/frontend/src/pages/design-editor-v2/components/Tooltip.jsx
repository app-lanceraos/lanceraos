import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY = 400;

// Prompt 30 item 1: replaces native `title` attributes (unstyled, slow to
// appear, inconsistent across browsers) with a small styled popup — dark
// background matching the app's own panel/border tokens, a short delay
// before appearing (so it doesn't flash on every incidental mouse-over,
// same convention as most design tools), shown on hover OR keyboard focus
// (so an icon-only button stays accessible without a mouse). `placement`
// picks which side of the trigger it opens on — callers near the top of
// the layout (the sidebar collapse toggles, sitting right under the
// toolbar) use `bottom` so the popup never clips against/behind it.
//
// Prompt 32 item 3: the popup itself renders through a portal into
// `document.body`, positioned via the trigger's own `getBoundingClientRect`
// (fixed viewport coordinates) rather than living inside the trigger's own
// DOM position. Nesting it normally meant it inherited every ancestor's
// `overflow` — in particular the sidebar `.panel`s' own `overflow-y: auto`
// (needed for their scrollbar), which clipped any tooltip near a panel's
// edge instead of letting it float freely above the surrounding UI.
export default function Tooltip({ label, children, placement = 'top', className }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState(null);
  const [resolvedPlacement, setResolvedPlacement] = useState(placement);
  const timeoutRef = useRef(null);
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);

  const scheduleShow = () => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), SHOW_DELAY);
  };
  const hide = () => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  // Measured fresh every time the tooltip actually opens — cheap (one
  // rect read), and means a scrolled/resized/reflowed trigger always gets
  // an up-to-date position rather than a stale one from mount time.
  useLayoutEffect(() => {
    if (!visible || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setResolvedPlacement(placement);
    setCoords({
      left: rect.left + rect.width / 2,
      top: placement === 'top' ? rect.top - 6 : rect.bottom + 6,
    });
  }, [visible, placement]);

  // Prompt 33 item 1: the coords above assume enough room on the trigger's
  // preferred side/edge. Once the popup is actually in the DOM (so we can
  // measure its real size), check it against the viewport and flip
  // vertically or clamp horizontally when it would render off-screen —
  // e.g. the collapsed-sidebar toggles sitting right at the browser edge.
  // Runs again after any adjustment, but converges immediately since a
  // corrected position no longer trips the same overflow check.
  useLayoutEffect(() => {
    if (!visible || !coords || !tooltipRef.current || !triggerRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tipRect = tooltipRef.current.getBoundingClientRect();
    const margin = 8;

    let nextPlacement = resolvedPlacement;
    let nextTop = coords.top;
    if (nextPlacement === 'top' && tipRect.top < margin) {
      nextPlacement = 'bottom';
      nextTop = triggerRect.bottom + 6;
    } else if (nextPlacement === 'bottom' && tipRect.bottom > window.innerHeight - margin) {
      nextPlacement = 'top';
      nextTop = triggerRect.top - 6;
    }

    let nextLeft = coords.left;
    const halfWidth = tipRect.width / 2;
    if (nextLeft - halfWidth < margin) {
      nextLeft = halfWidth + margin;
    } else if (nextLeft + halfWidth > window.innerWidth - margin) {
      nextLeft = window.innerWidth - margin - halfWidth;
    }

    if (nextPlacement !== resolvedPlacement || nextTop !== coords.top || nextLeft !== coords.left) {
      setResolvedPlacement(nextPlacement);
      setCoords({ left: nextLeft, top: nextTop });
    }
  }, [visible, coords, resolvedPlacement]);

  if (!label) return children;

  return (
    <span
      ref={triggerRef}
      className={className ? `tooltip-wrap ${className}` : 'tooltip-wrap'}
      onMouseEnter={scheduleShow}
      onMouseLeave={hide}
      onFocus={scheduleShow}
      onBlur={hide}
    >
      {children}
      {visible &&
        coords &&
        createPortal(
          <span
            ref={tooltipRef}
            className={`tooltip tooltip--portal tooltip--${resolvedPlacement}`}
            role="tooltip"
            style={{ left: coords.left, top: coords.top }}
          >
            {label}
          </span>,
          document.body
        )}
    </span>
  );
}
