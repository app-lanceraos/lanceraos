import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ELEMENT_TYPES } from '../../data/elementCatalog';
import { useEditor } from '../../state/EditorContext';
import { WordmarkSVG } from '../Brand';
import { WarningIcon } from '../Icons';
import Tooltip from '../Tooltip';
import { fontFamilyCSS } from '../../data/fonts';
import {
  RESIZE_HANDLES,
  resizeRotatedBox,
  snapRotation,
  clampToPage,
  clampResizeToPage,
  getItemBounds,
  getFooterTop,
  rotateVector,
  rotatedBoundingBox,
  resolveMoveCollision,
  resolveResizeCollision,
  edgeClearance,
  alignmentCandidates,
  boundaryCandidates,
  findStickySnap,
  guideSpan,
  nearestGap,
  detectEqualSpacing,
  SNAP_ENGAGE_TOLERANCE,
  SNAP_RELEASE_TOLERANCE,
  isImagePixelated,
  EDGE_CONTACT_EPSILON_MM,
} from '../../utils/geometry';
import { beginDragSelectGuard } from '../../utils/dragGuard';
import { resolveItemTheme } from '../../utils/theme';
import { pxToMm, mm, pt } from '../../utils/units';

// Table columns default to equal shares of the table's width; stored as
// percentages (summing to 100) rather than px, so they stay meaningful
// regardless of how the table itself gets resized/scaled as a whole.
function defaultColumnWidths(count) {
  return Array(count).fill(100 / count);
}

const MIN_COLUMN_PCT = 6;
const NOOP = () => {};
// Prompt 24 item 3: Prompt 23 centered handles on the item's own literal
// box edge (coordinate 0) — mathematically a straddle of THAT edge, but
// for the vast majority of items (no CSS border of their own), the only
// visible "border" is the purple SELECTION OUTLINE (`.item--selected::
// after`, `inset: -4px` — i.e. drawn 4px OUTSIDE the item's true edge).
// Relative to that visible line, a handle centered at 0 sits entirely
// between it and the item's own content — reads as "fully inside" the
// selection rectangle, exactly the bug reported. Centering on
// `SELECTION_OUTLINE_INSET` instead (matching that same 4px) makes the
// handle straddle the line a user can actually see.
// `HALF_HANDLE` is half the handle's own square size (see
// `.item__resize-handle` in editor.css). Adaptive (Prompt 14, recalibrated
// again here): a neighbor closer than the handle's ideal outward reach
// pulls its center back toward (and, in the tightest case, past) the
// item's own true edge — down to sitting fully inside the item, its
// outward point flush with the neighbor — never past it.
export const SELECTION_OUTLINE_INSET = 4;
const HALF_HANDLE = 4;
// Phase 2a: `SELECTION_OUTLINE_INSET`/`HALF_HANDLE` above stay in raw CSS
// px unchanged — GroupSelectionOverlay's own groupHandleOffset uses them
// directly as a fixed CSS offset with no item-geometry math involved at
// all (see that file's own comment: "no adaptive-neighbor shrinking
// here"), so there's nothing there to convert. THIS function is
// different: it mixes those two fixed handle-size constants with
// `clearance` (edgeClearance's return, computed FROM item x/y/width/
// height — mm now), so mixing a raw px constant into mm-space math would
// silently be wrong. The two px constants are converted to their own mm
// equivalents here, the whole clamp runs in mm (matching `clearance`),
// and the final result converts back only at the very end via the mm()
// string helper — the handle offset is consumed directly as a CSS
// calc() term by its caller below, so no numeric mm->px step is needed.
const HALF_HANDLE_MM = pxToMm(HALF_HANDLE);
const SELECTION_OUTLINE_INSET_MM = pxToMm(SELECTION_OUTLINE_INSET);
function adaptiveHandleOffset(fx, negClearanceMm, posClearanceMm) {
  if (fx === 0.5) return '0px';
  const clearanceMm = fx === 1 ? posClearanceMm : negClearanceMm;
  const outwardMm = Math.max(-HALF_HANDLE_MM, Math.min(SELECTION_OUTLINE_INSET_MM, clearanceMm - HALF_HANDLE_MM));
  return fx === 1 ? mm(outwardMm) : mm(-outwardMm);
}

// Text-bearing variants whose box no longer scales its content (Prompt
// 13): resizing WIDTH changes the wrapping width text reflows within,
// resizing HEIGHT changes how much vertical room it has to sit in — font
// size is controlled only by the explicit size field (PropertiesPanel's
// FontControls), never derived from the box. `image`/`divider`/`qr`/
// `table`/`footer` keep the original Prompt 3/11 content-scaling-with-box
// behavior (an intrinsic asset size, a fixed grid, hand-managed column
// widths, or — for `table` — a deliberate exception even though its own
// cells are text, per Prompt 13's brief) — those still stretch via
// `.item__scale`'s transform, unaffected by anything below.
const TEXT_VARIANTS = new Set(['text', 'label-value', 'block', 'note']);

// left/center/right → text-align/justify-content (Prompt 11); top/middle/
// bottom → the outer `.item__scale` flex wrapper's justify-content
// (Prompt 13) — this is what actually POSITIONS the (now fixed-size) text
// within extra box height instead of stretching it to fill that height.
function vAlignToFlex(v) {
  return v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start';
}

// Variants whose text can WRAP across multiple lines — their true minimum
// width is the widest single WORD (CSS `min-content`: anything narrower
// would overflow mid-word), not the full unwrapped text. `label-value`
// never wraps (`.item__label-value` is `white-space: nowrap`), so its
// minimum IS its full natural width — plain shrink-to-fit already gives
// that correctly.
const WRAPPING_VARIANTS = new Set(['text', 'note', 'block']);

// Prompt 14: a manually-set width/height is a MINIMUM for text, not a hard
// cap — Prompt 13 let a box smaller than its content spill text past its
// own frame as a safety net (better than silently hiding it), but left
// the frame's own size — and hence its collision footprint — stale,
// letting the overflow visually defeat Prompt 12's no-overlap guarantee.
// Two hidden, offscreen clones of the item's own content measure what the
// EFFECTIVE (possibly grown) box actually needs to be:
//   - `minRef`: width `min-content` for a wrapping variant, or
//     unconstrained/auto (shrink-to-fit — its true minimum, since it
//     never wraps) otherwise.
//   - `wrapRef`: width pinned to max(current box width, that measured
//     minimum) — the real height the text needs once wrapped at whatever
//     width it actually ends up rendering at.
// Neither value is ever written back to item.width/height — that would
// turn every font/resize/content change into a spurious extra undo step
// (same reasoning as Prompt 11's original measurement system); the
// combination with the item's own stored size happens in the component
// below, entirely in local/derived state.
function useMinContentSize(active) {
  const minRef = useRef(null);
  const wrapRef = useRef(null);
  const [minWidth, setMinWidth] = useState(null);
  const [wrappedHeight, setWrappedHeight] = useState(null);

  // Phase 2a: ResizeObserver always reports in real CSS px, regardless of
  // what unit (mm or px) the observed element's own style was authored
  // in — the browser resolves `width: "12.7mm"` down to a device px
  // measurement before this callback ever sees it. Converted to mm ONCE,
  // right here at the point of capture (via pxToMm), and every state/prop
  // this hook exposes downstream (minWidth/wrappedHeight) is mm from then
  // on — never converted back and forth per frame. The de-jitter epsilon
  // (was a bare 0.5px) converts the same way, for the same reason: it's
  // filtering real sub-pixel measurement noise, not a UX-feel constant,
  // so a straight conversion (not a re-tuned round number) is correct.
  const jitterEpsilonMm = pxToMm(0.5);

  useLayoutEffect(() => {
    if (!active) return undefined;
    const node = minRef.current;
    if (!node) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const w = pxToMm(entry.contentRect.width);
      setMinWidth((prev) => (prev !== null && Math.abs(prev - w) < jitterEpsilonMm ? prev : w));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [active]);

  useLayoutEffect(() => {
    if (!active) return undefined;
    const node = wrapRef.current;
    if (!node) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const h = pxToMm(entry.contentRect.height);
      setWrappedHeight((prev) => (prev !== null && Math.abs(prev - h) < jitterEpsilonMm ? prev : h));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [active]);

  return { minRef, wrapRef, minWidth: active ? minWidth : null, wrappedHeight: active ? wrappedHeight : null };
}

function partInlineStyle(item, part, fallbackColor, fallbackWeight, fallbackSize) {
  const s = (item && item[part]) || {};
  return {
    color: s.textColor || fallbackColor,
    background: s.bgColor,
    borderColor: s.borderColor,
    borderWidth: s.borderWidth ? mm(s.borderWidth) : undefined,
    borderStyle: s.borderWidth ? 'solid' : undefined,
    fontFamily: fontFamilyCSS(s.fontFamily),
    fontWeight: s.fontWeight || fallbackWeight,
    fontSize: pt(s.fontSize || fallbackSize),
    // Left unset (rather than defaulted) when the part has no override —
    // the container it sits in (`.item__block`) carries the whole-item
    // default via ordinary CSS inheritance, so a part only needs its own
    // value when it's deliberately different from that default.
    textAlign: s.contentAlign || undefined,
  };
}

// Renders a content item's baked-in display at its NATURAL size — the
// scale wrapper in CanvasItem stretches this to the item's current
// (possibly resized) box, so nothing here needs to know its current size.
// Only `block`/`qr` variants have an independently-selectable title/body;
// everything else is a single unstyled-by-part run of content.
function ContentBody({ item, isPartSelected, onSelectPart, isPartHovered, onPartHoverEnter, onPartHoverLeave, onPartContextMenu }) {
  const def = ELEMENT_TYPES[item.type];
  // Every OTHER catalog entry's `render()` ignores the extra `item`
  // argument (their content is fixed/baked-in, see elementCatalog.js) —
  // `customText` is the one entry that actually reads it, to render the
  // user's own typed text or a bound placeholder sample (see that file's
  // own comment on ELEMENT_TYPES.customText).
  const data = def.render(item);

  // Applied directly on the leaf text-bearing element (not inherited down
  // from the outer frame) so a variant with its own baked-in default weight
  // (row-strong's bold, a table header's bold) can supply that default
  // itself and still have the user's explicit choice win outright — an
  // inline style set here always beats both inheritance and any CSS rule,
  // default browser styling included.
  const fontStyle = (fallbackWeight, fallbackSize) => ({
    fontFamily: fontFamilyCSS(item.fontFamily),
    fontWeight: item.fontWeight || fallbackWeight,
    fontSize: pt(item.fontSize || fallbackSize),
  });
  // How content sits inside its own box — independent of the align-to-page
  // buttons (those move the box itself; this only affects the content
  // painted inside it). Not offered for every variant: a `spread`
  // label-value (Subtotal etc.) already spreads label/value via
  // `justify-content: space-between`, and `table` cells have their own
  // per-column left/right rule — a generic align control would just fight
  // both. Vertical position (top/middle/bottom) is a separate, outer
  // concern — see the `.item__scale` flex wrapper in CanvasItem below —
  // this only ever governs horizontal placement.
  const alignStyle = () => ({ textAlign: item.contentAlign || 'left' });

  switch (def.variant) {
    case 'text':
      // `whiteSpace: 'pre-wrap'` — a real, user-typeable field
      // (customText) can contain literal newlines; this renders them as
      // actual line breaks (matching production's own
      // `{{ el.resolved_text|linebreaksbr }}` — Django's linebreaksbr
      // converts \n to <br> after auto-escaping) without ever building
      // HTML from user content on this side either. `{data}` is plain
      // JSX text content — React escapes it exactly like Django's
      // auto-escaping does; this was never a raw-HTML injection point on
      // any existing catalog type and stays that way for customText too.
      return <div className="item__text" style={{ height: 'auto', whiteSpace: 'pre-wrap', ...fontStyle(undefined, 7.5), ...alignStyle() }}>{data}</div>;
    case 'label-value': {
      const fallbackWeight = def.strong ? 700 : undefined;
      const fallbackSize = def.strong ? 8.25 : 7.5;
      const labelStyle = partInlineStyle(item, 'label', undefined, fallbackWeight, fallbackSize);
      const valueStyle = partInlineStyle(item, 'value', undefined, fallbackWeight, fallbackSize);
      // `spread` (Subtotal/Tax/Discount/Total due) always spreads label
      // left / value right across the row's full width — the whole-item
      // align control doesn't apply to these (see ALIGNABLE_VARIANTS in
      // PropertiesPanel.jsx), so `item.contentAlign` is only meaningful
      // for a tight, non-spread pair like Due Date/Issue Date.
      const justify = def.spread
        ? 'space-between'
        : item.contentAlign === 'center' ? 'center' : item.contentAlign === 'right' ? 'flex-end' : 'flex-start';
      return (
        <div
          className="item__label-value"
          style={{
            height: 'auto',
            justifyContent: justify,
            borderTop: def.strong ? '1px solid #262420' : undefined,
            paddingTop: def.strong ? 4 : undefined,
          }}
        >
          <span
            className={`item__label${isPartSelected('label') ? ' item__label--selected' : isPartHovered('label') ? ' item__label--hover' : ''}`}
            style={labelStyle}
            onClick={(e) => onSelectPart(e, 'label')}
            onMouseEnter={(e) => onPartHoverEnter(e, 'label')}
            onMouseLeave={(e) => onPartHoverLeave(e, 'label')}
            onContextMenu={(e) => onPartContextMenu(e, 'label')}
          >
            {data.label}
          </span>
          <span
            className={`item__value${isPartSelected('value') ? ' item__value--selected' : isPartHovered('value') ? ' item__value--hover' : ''}`}
            style={valueStyle}
            onClick={(e) => onSelectPart(e, 'value')}
            onMouseEnter={(e) => onPartHoverEnter(e, 'value')}
            onMouseLeave={(e) => onPartHoverLeave(e, 'value')}
            onContextMenu={(e) => onPartContextMenu(e, 'value')}
          >
            {data.value}
          </span>
        </div>
      );
    }
    case 'block': {
      // The whole item's chosen alignment is the container's own
      // `text-align` — every line inherits it unless that specific part
      // has its own override (partInlineStyle only sets `textAlign` when
      // the part actually has one, so inheritance passes through cleanly).
      // `height: 'auto'` (inline, not the shared `.item__block` CSS
      // default of 100%) — this class is also reused by `qr`'s title+body
      // layout below, which still needs height:100% for its `flex: 1`
      // QR-code area to fill the (still content-scaled) box; only this
      // case's own instance opts out of that.
      const titleStyle = partInlineStyle(item, 'title', '#a2896b', undefined, 6);
      const hidden = item.hiddenLines || [];
      const visibleLines = data.lines.filter((line) => !hidden.includes(line.key));
      return (
        <div className="item__block" style={{ height: 'auto', ...alignStyle() }}>
          <div
            className={`item__block-title${isPartSelected('title') ? ' item__block-title--selected' : isPartHovered('title') ? ' item__block-title--hover' : ''}`}
            style={titleStyle}
            onClick={(e) => onSelectPart(e, 'title')}
            onMouseEnter={(e) => onPartHoverEnter(e, 'title')}
            onMouseLeave={(e) => onPartHoverLeave(e, 'title')}
            onContextMenu={(e) => onPartContextMenu(e, 'title')}
          >
            {data.title.text}
          </div>
          {visibleLines.map((line) => (
            <div
              className={`item__block-line${isPartSelected(line.key) ? ' item__block-line--selected' : isPartHovered(line.key) ? ' item__block-line--hover' : ''}`}
              style={partInlineStyle(item, line.key, '#55524a', undefined, 6.75)}
              key={line.key}
              onClick={(e) => onSelectPart(e, line.key)}
              onMouseEnter={(e) => onPartHoverEnter(e, line.key)}
              onMouseLeave={(e) => onPartHoverLeave(e, line.key)}
              onContextMenu={(e) => onPartContextMenu(e, line.key)}
            >
              {line.text}
            </div>
          ))}
        </div>
      );
    }
    case 'note':
      return <div className="item__text" style={{ height: 'auto', opacity: 0.6, ...fontStyle(undefined, 7.5), ...alignStyle() }}>{data}</div>;
    case 'image':
      // No border/background of its own — the outer frame (CanvasItem)
      // already renders the item's border/background, and this placeholder
      // is that same box's content, not a second nested one. Real assets
      // (public/favicon.svg, public/signature.png) — not illustrative
      // currentColor art — so the frame's Text color control is hidden for
      // these two types in the properties panel (PropertiesPanel.jsx);
      // `object-fit: contain` keeps each asset's own aspect ratio intact
      // through a non-uniform resize instead of stretching it.
      // Prompt 16 item 5: the <img> itself never receives pointer events —
      // `pointer-events: none` AND `draggable={false}` together, belt and
      // suspenders — so mousedown/drag on this item can never be hijacked
      // by the browser's native "drag this image out" gesture, nor ever
      // hit-test against just the asset's own opaque pixels. A plain
      // transparent `.item__image-interaction` layer on top (same size,
      // absolutely positioned over the wrapper) is what actually receives
      // every click/drag, at the FULL bounding box, and bubbles it up to
      // this frame's own onMouseDown (beginMove) exactly like clicking
      // empty space anywhere else in the item already does.
      if (item.type === 'logo' || item.type === 'signatureImage') {
        const src = item.type === 'logo' ? '/favicon.svg' : '/signature.png';
        const alt = item.type === 'logo' ? 'Logo' : 'Signature';
        return (
          <div className="item__image-wrap">
            <img
              src={src}
              alt={alt}
              draggable={false}
              className="item__image-placeholder"
              style={{ objectFit: 'contain', pointerEvents: 'none' }}
            />
            <div className="item__image-interaction" />
          </div>
        );
      }
      // Any other 'image'-variant type (none currently defined) falls back
      // to the plain text-label placeholder.
      return <div className="item__image-placeholder">{data.placeholder}</div>;
    case 'divider':
      // A plain content-item version of the decorative line shape (color
      // + thickness) — thickness is just its own height, resized the same
      // way as every other item, so it needs no dedicated control.
      return <div className="item__divider" style={{ background: item.bgColor || '#262420', borderRadius: mm(item.naturalHeight / 2) }} />;
    case 'qr': {
      const titleStyle = partInlineStyle(item, 'title', '#a2896b', undefined, 6);
      // The QR pattern itself stays fixed black-on-white regardless of the
      // body's style overrides — a real QR needs strong, reliable contrast
      // to stay scannable, so only its surrounding box (background/border)
      // is user-styleable, not the code's own ink color.
      const bodyBoxStyle = partInlineStyle(item, 'body', undefined);
      // Prompt 24 item 4: qr's title text now respects the whole-item
      // horizontal content-align control (see PropertiesPanel's
      // H_ALIGNABLE_VARIANTS) the same way block's does — via the shared
      // container's own `textAlign`, inherited by the title unless it has
      // its own per-part override (partInlineStyle only sets `textAlign`
      // when the part actually has one). The QR pattern itself is
      // centered by `.item__qr-wrap`'s own flex rule regardless — content-
      // align only ever affects the title text run.
      return (
        <div className="item__block" style={alignStyle()}>
          <div
            className={`item__block-title${isPartSelected('title') ? ' item__block-title--selected' : isPartHovered('title') ? ' item__block-title--hover' : ''}`}
            style={titleStyle}
            onClick={(e) => onSelectPart(e, 'title')}
            onMouseEnter={(e) => onPartHoverEnter(e, 'title')}
            onMouseLeave={(e) => onPartHoverLeave(e, 'title')}
            onContextMenu={(e) => onPartContextMenu(e, 'title')}
          >
            {data.label}
          </div>
          <div
            className={`item__qr-wrap${isPartSelected('body') ? ' item__qr-wrap--selected' : isPartHovered('body') ? ' item__qr-wrap--hover' : ''}`}
            style={{
              background: bodyBoxStyle.background,
              borderColor: bodyBoxStyle.borderColor,
              borderWidth: bodyBoxStyle.borderWidth,
              borderStyle: bodyBoxStyle.borderStyle,
            }}
            onClick={(e) => onSelectPart(e, 'body')}
            onMouseEnter={(e) => onPartHoverEnter(e, 'body')}
            onMouseLeave={(e) => onPartHoverLeave(e, 'body')}
            onContextMenu={(e) => onPartContextMenu(e, 'body')}
          >
            <svg viewBox={`0 0 ${data.qrSize} ${data.qrSize}`} className="item__qr-svg">
              <rect width={data.qrSize} height={data.qrSize} fill="#fff" />
              <path d={data.qrPath} fill="#000" />
            </svg>
          </div>
        </div>
      );
    }
    case 'footer':
      // color/borderTopColor set directly here (not just on the outer
      // frame) — .item__footer has its own hardcoded CSS color and
      // border-top, both of which are direct rules on this exact element
      // and would otherwise beat an inherited value from the frame,
      // same class of override needed for row-strong/table-th earlier.
      // fontStyle() cascades to footer-left/right via ordinary
      // inheritance — neither has its own font-family/weight rule to
      // fight with, unlike table's th.
      return (
        <div
          className="item__footer"
          style={{
            color: item.textColor || undefined,
            borderTopColor: item.dividerColor || undefined,
            ...fontStyle(undefined, 5.25),
          }}
        >
          <div className="item__footer-left">
            <div>{data.businessName}</div>
            <div>{data.email}</div>
          </div>
          {/* The wordmark is a fixed logotype (an SVG mark, not text) — its
              fill picks up the footer's own textColor through the same
              `--wordmark` custom property Brand.jsx already reads, same
              currentColor-recoloring mechanism the Logo/Signature
              placeholder art used before those became real assets. Font
              family/weight stay inapplicable here: fontStyle() cascading
              onto this element has no effect on an SVG's own paths. */}
          <div className="item__footer-right" style={{ '--wordmark': item.textColor || '#a09a89' }}>
            <span>Generated by</span>
            <WordmarkSVG width={56} height={8.4} align="center" />
          </div>
        </div>
      );
    case 'table': {
      // Font family/weight applied directly per th/td rather than on the
      // outer frame: a `<th>`'s own browser-default bold would otherwise
      // beat an inherited weight regardless of where that weight came
      // from, so th needs its own explicit (overridable) bold default.
      // Column widths (item.columnWidths, dragged via the column-divider
      // handles in CanvasItem) are independent of the outer 8-point
      // resize/scale — a redistribution of the SAME total width, not a
      // change to it.
      const widths = item.columnWidths || defaultColumnWidths(data.columns.length);
      // Independent of column WIDTH (item.columnWidths, dragged via the
      // divider handles) — alignment is purely a text-align choice within
      // whatever width a column already has, so the two never fight.
      // Defaults match the standing convention (first column left, the
      // rest right, e.g. numbers/currency) until a column's own choice
      // overrides it.
      const columnAlign = (j) => item.columnAlign?.[j] || (j === 0 ? 'left' : 'right');
      // Phase 2a: cellPadding is a spacing quantity, same "mm family" as
      // border-width/corner-radius (see units.js's header comment) — was
      // a bare px default of 4; converted to its mm equivalent (~1.06mm).
      const cellPadding = item.cellPadding ?? pxToMm(4);
      return (
        <table className="item__table">
          <thead>
            <tr>
              {data.columns.map((c, j) => (
                <th
                  key={c}
                  style={{
                    width: `${widths[j]}%`,
                    textAlign: columnAlign(j),
                    padding: mm(cellPadding),
                    fontFamily: fontFamilyCSS(item.fontFamily),
                    fontWeight: item.headerFontWeight || item.fontWeight || 700,
                    fontSize: pt(item.headerFontSize || 5.25),
                    background: item.headerBg,
                    color: item.headerTextColor,
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} style={item.altRowShading && i % 2 === 1 ? { background: item.altRowColor || '#f5f3ee' } : undefined}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    style={{
                      width: `${widths[j]}%`,
                      textAlign: columnAlign(j),
                      padding: mm(cellPadding),
                      ...fontStyle(undefined, 6.375),
                      borderBottom:
                        item.rowBorderWidth !== undefined
                          ? `${mm(item.rowBorderWidth)} solid ${item.rowBorderColor || '#e5e1d6'}`
                          : undefined,
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    default:
      return null;
  }
}

function shapeBorderRadius(item) {
  if (item.type === 'ellipse') return '50%';
  if (item.type === 'line') return mm(item.naturalHeight / 2);
  return mm(item.radius);
}

// Prompt 24 item 4: the logo shape/mask picker (elementCatalog.js's
// `shapeOptions: ['square','rounded','circle']`, defined since the
// original spec but never wired to anything until now) — `item.logoShape`
// (set by PropertiesPanel) picks the radius. Returns null for every other
// type, including `signatureImage` (no `shapeOptions` of its own — this
// picker is specific to `logo`), so callers fall back to the generic
// `item.cornerRadius` control instead.
function logoMaskRadius(item) {
  if (item.type !== 'logo') return null;
  const shape = item.logoShape || 'square';
  if (shape === 'circle') return '50%';
  // Was a bare 10 (px) — a fixed visual mask radius, not stored item
  // geometry, so converted once here via the same boundary conversion
  // rather than a re-tuned round mm number (this one isn't a UX-feel
  // constant the way PAGE_PADDING is; it's a single "rounded corner"
  // look with no equivalent design reasoning to re-derive from scratch).
  if (shape === 'rounded') return mm(pxToMm(10));
  return mm(0);
}

// A shape's fill/border/radius IS its content — rendered at natural size
// and scaled by the same wrapper mechanism content items use, so a resize
// stretches the whole visual (border included) rather than just its frame.
function ShapeBody({ item }) {
  return (
    <div
      className="item__shape-fill"
      style={{
        background: item.fill,
        border: item.borderWidth ? `${item.borderWidth}px solid ${item.borderColor}` : 'none',
        borderRadius: shapeBorderRadius(item),
      }}
    />
  );
}

// Prompt 27: a user-provided image (not catalog-driven the way Logo/
// Signature are — no ELEMENT_TYPES entry, just a raw data URL on the
// item itself). Reuses the exact same `.item__image-wrap`/`.item__image-
// interaction` pattern Logo/Signature already established (Prompt 16
// item 5): the real `<img>` never receives pointer events, so it can
// never be hijacked by the browser's own native "drag this image out"
// gesture — a transparent full-box layer on top is what actually
// receives the click/drag, bubbling to this frame's own onMouseDown
// (beginMove) exactly like every other item's empty space does.
function ImageBody({ item }) {
  return (
    <div className="item__image-wrap">
      <img
        src={item.dataUrl}
        alt=""
        draggable={false}
        className="item__image-placeholder"
        style={{ objectFit: 'contain', pointerEvents: 'none' }}
      />
      <div className="item__image-interaction" />
    </div>
  );
}

export const RotateIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
    <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M20 4v6h-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Prompt 19: resolves ONE axis's alignment snap+guide for a drag-style
// gesture. Equal-spacing takes priority when `rowNeighbors` (this axis's
// other items sharing the cross-axis band, {pos,size} each, EXCLUDING the
// dragged box) yields a match (item 2, the flagship feature) — pass an
// empty array to skip it entirely (resize and group-move do, deliberately
// — see their own call sites for why). Otherwise falls back to sticky
// point-alignment against item edges/centers, the page's own center
// (item 1), and the page/footer boundary (silently, no guide line — the
// edge-glow already covers that). `wasSnapped` is this same axis's
// engagement state from the previous frame (item 3's hysteresis); the
// result's `snapped` is the new state to carry into the next frame.
//
// Prompt 22: `scale` is the canvas's current zoom factor (1 at 100%,
// 0.5 at 50%, etc.) — every tolerance here is a PAGE-UNIT distance, but
// the actual UX goal is a constant-feeling SCREEN-pixel snap radius, so
// both tolerances are divided by `scale` before use: zoomed OUT, each
// screen pixel of mouse wobble covers MORE page-units, so the page-unit
// tolerance needs to grow to match; zoomed IN, the reverse. Verified by
// testing at 50%/100%/150% — a fixed page-unit tolerance felt twitchy
// zoomed in and unreachably tight zoomed out, while this scaled version
// felt identically "sticky" at every level tried.
function resolveAxisSnap({ pos, size, candidates, rowNeighbors, wasSnapped, crossMin, crossMax, pageCrossSize, scale = 1 }) {
  const engageTolerance = SNAP_ENGAGE_TOLERANCE / scale;
  const releaseTolerance = SNAP_RELEASE_TOLERANCE / scale;
  const tolerance = wasSnapped ? releaseTolerance : engageTolerance;
  const equal = rowNeighbors.length >= 2 ? detectEqualSpacing(pos, size, rowNeighbors, tolerance) : null;
  if (equal) {
    return { delta: equal.targetPos - pos, snapped: true, spacing: equal.gaps, line: null };
  }
  const match = findStickySnap(pos, size, candidates, wasSnapped, engageTolerance, releaseTolerance);
  if (!match) return { delta: 0, snapped: false, spacing: [], line: null };
  if (match.candidate.isBoundary) {
    return { delta: match.delta, snapped: true, spacing: [], line: null };
  }
  const [from, to] = guideSpan(crossMin, crossMax, match.candidate, pageCrossSize);
  return { delta: match.delta, snapped: true, spacing: [], line: { value: match.candidate.value, from, to } };
}

// IMPORTANT: move/resize/rotate must each produce exactly ONE undo step per
// gesture — local `live` preview state while the mouse is down, a single
// `updateItem` commit on mouseup. Shared by shapes and content items alike;
// only the rendered body (ShapeBody vs ContentBody) and a few style fields
// differ by `item.kind`.
// `readOnly` (set by PreviewModal, via EditorCanvas/CanvasLayer) is what
// keeps Preview a clean read-only render of the SAME shared EditorContext
// rather than a separate tree: with it true, this item ignores whatever
// `selection` currently holds (an item selected in the live editor behind
// the modal must not show its outline/handles here) and never wires up the
// move/resize/rotate/part-click handlers that would mutate the live
// template out from under the editor.
export default function CanvasItem({ item, readOnly = false }) {
  const {
    template,
    selection,
    setSelection,
    updateItem,
    updateItems,
    setEdgeHighlight,
    setGuides,
    effectiveSizes,
    setEffectiveSize,
    pushPreview,
    setPushPreview,
    setContextMenu,
    zoom,
  } = useEditor();
  const def = item.kind === 'content' ? ELEMENT_TYPES[item.type] : null;

  const isSelected = !readOnly && selection.ids.includes(item.id);
  const isPartSelected = (part) =>
    !readOnly && !!selection.part && selection.part.id === item.id && selection.part.key === part;
  const isWholeSelected = isSelected && !(selection.part && selection.part.id === item.id);
  // Prompt 18: once 2+ MOVABLE items are selected, the shared
  // GroupSelectionOverlay takes over resize/rotate entirely (one group
  // box, one set of 8+1 handles, matching Figma/Illustrator/Sketch/Canva
  // convention) — individual per-item handles disappear, even though
  // each item stays individually outlined/selected underneath it. A
  // locked item never contributes a handle of its own anyway, so it
  // doesn't count toward "how many movable items" for this purpose —
  // selecting one movable item alongside a locked one still shows that
  // one item's own handles, same as a true single selection would.
  const selectedMovableCount = !readOnly
    ? template.items.filter((i) => selection.ids.includes(i.id) && !i.locked).length
    : 0;
  const showIndividualHandles = isSelected && !item.locked && selectedMovableCount <= 1;

  const [live, setLive] = useState(null); // { x, y, width, height, rotation } while dragging
  const [rotationSnapped, setRotationSnapped] = useState(false);
  // Prompt 20 item 2: live pill labels while dragging a table column
  // divider — { xPct, yPct, text }[], positioned as PERCENTAGES of this
  // item's own box (like the dividers themselves) so they inherit the
  // item's rotation transform for free instead of needing their own
  // rotation math. null whenever no divider drag is in progress.
  const [columnDragLabels, setColumnDragLabels] = useState(null);
  const draggedRef = useRef(false); // did the current mousedown gesture actually move?

  // Hover preview (Prompt 15) — local, transient, cleared the instant the
  // cursor leaves; never touches selection state. `hoverWhole` tracks the
  // outer frame's own mouseenter/leave (native mouseenter/leave don't
  // bubble, so this stays true while the cursor is anywhere inside the
  // item, sub-parts included, and only flips false on actually leaving
  // the item). `hoveredPart` tracks whichever sub-part's OWN
  // mouseenter/leave last fired, taking priority over the whole-item
  // preview the same way a click on a part takes priority over a
  // whole-item click.
  const [hoverWhole, setHoverWhole] = useState(false);
  const [hoveredPart, setHoveredPart] = useState(null);
  const isPartHovered = (part) => hoveredPart === part;
  const onPartHoverEnter = (e, part) => setHoveredPart(part);
  const onPartHoverLeave = (e, part) => setHoveredPart((prev) => (prev === part ? null : prev));

  // A cascade-pushed preview (Prompt 16) only ever applies to an item that
  // ISN'T itself the one being actively dragged/resized right now — `live`
  // always wins when both would otherwise apply.
  const pushedHere = !live && pushPreview[item.id];
  const rawCurrent = { ...item, ...(live || {}), ...(pushedHere || {}) };
  // Prompt 28: resolved ONCE, here — every downstream reader (ContentBody,
  // ShapeBody, frameStyle, partInlineStyle, the effective-size measurement
  // clones) sees plain literal textColor/bgColor/borderColor/fill/
  // fontFamily/fontWeight values and stays completely unaware that
  // theme-linking exists, exactly like before this prompt. `template.theme`
  // is live editor state, so this re-resolves (and re-renders) the instant
  // the theme panel changes anything a linked field on this item points at.
  const current = resolveItemTheme(rawCurrent, template.theme);
  const rotation = current.rotation || 0;

  // Text variants (Prompt 13) don't scale their content to the box at
  // all: scale is pinned to 1, and the `.item__scale` wrapper is sized to
  // the box directly (current.width/height) rather than a natural size —
  // width becomes the text's wrapping width, height becomes the space its
  // vertical alignment positions it within. Every other variant keeps the
  // original Prompt 3/11 behavior unchanged: content renders at its fixed
  // natural size and a transform stretches it to fill the box.
  const isTextVariant = !!def && TEXT_VARIANTS.has(def.variant);
  // Prompt 16 item 3: `table` cells are text too (percentage column widths
  // plus fixed px font sizes, same as every other text-bearing variant),
  // but got left out of the Prompt 13 migration above — the box was still
  // stretched via `.item__scale`'s transform, which visibly re-scales
  // (stretches/squashes) already-fixed-size cell text on every resize.
  // The outer resize should still reshape the table's own proportions
  // (row/column layout, Prompt 8's percentage column widths) — it just
  // needs to do that by sizing `.item__scale` directly to the box (like a
  // text variant) rather than by transform-scaling a natural-size render.
  const isTableVariant = def?.variant === 'table';
  const skipBoxScale = isTextVariant || isTableVariant;
  const scaleX = skipBoxScale || !(item.naturalWidth > 0) ? 1 : current.width / item.naturalWidth;
  const scaleY = skipBoxScale || !(item.naturalHeight > 0) ? 1 : current.height / item.naturalHeight;

  // Prompt 14: the box a text variant actually renders (and the one other
  // items' collision checks must respect) is current.width/height grown
  // just enough to contain its own measured content — never smaller than
  // what's stored, only ever larger when the content needs more room.
  const { minRef, wrapRef, minWidth, wrappedHeight } = useMinContentSize(isTextVariant);
  const effectiveWidth = isTextVariant ? Math.max(current.width, minWidth ?? current.width) : current.width;
  const effectiveHeight = isTextVariant ? Math.max(current.height, wrappedHeight ?? current.height) : current.height;

  useEffect(() => {
    if (isTextVariant) setEffectiveSize(item.id, { width: effectiveWidth, height: effectiveHeight });
  }, [isTextVariant, item.id, effectiveWidth, effectiveHeight, setEffectiveSize]);

  const scaleWrapperWidth = skipBoxScale ? effectiveWidth : item.naturalWidth;
  const scaleWrapperHeight = skipBoxScale ? effectiveHeight : item.naturalHeight;

  // Collision must react to what's actually on screen, not a stale stored
  // size — a neighbor's own grown (Prompt 14) box, when it has one, is
  // what beginMove/beginResize below build their neighbor list from.
  const withEffectiveSize = (o) => {
    const eff = effectiveSizes[o.id];
    return eff ? { ...o, width: eff.width, height: eff.height } : o;
  };

  const beginMove = (e) => {
    e.stopPropagation();
    if (item.locked) {
      // Still selectable (so its own style controls, e.g. the footer's,
      // are reachable) — just never moved, resized, or rotated. No
      // shift-toggle/multi-select for a locked item; a plain click just
      // selects it on its own.
      if (!selection.ids.includes(item.id)) setSelection({ ids: [item.id], part: null });
      return;
    }
    draggedRef.current = false;

    // `selection` (context state) won't reflect a shift-toggle made in
    // this very handler until the next render, so the gesture that's
    // about to start needs its own, immediately-correct view of who's
    // selected — computed locally rather than read back from `selection`.
    // Prompt 29 item 3: Ctrl/Cmd-click is a second, more universally-
    // expected modifier for the exact same toggle — most non-Mac design
    // tools reach for Ctrl here rather than Shift, and Cmd is the Mac
    // equivalent of that same "toggle" gesture elsewhere in this app
    // (undo/redo, etc.), so both are accepted identically.
    let effectiveIds = selection.ids;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      effectiveIds = selection.ids.includes(item.id)
        ? selection.ids.filter((id) => id !== item.id)
        : [...selection.ids, item.id];
      setSelection({ ids: effectiveIds, part: null });
    } else if (!selection.ids.includes(item.id)) {
      effectiveIds = [item.id];
      setSelection({ ids: effectiveIds, part: null });
    }

    // Prompt 17 item 3: dragging any one member of a multi-item selection
    // moves the whole group together — but if this shift-click just
    // toggled `item` itself OFF the selection, dragging it should still
    // just move `item` alone (dragging something you just deselected
    // shouldn't silently drag a completely different group instead).
    // Locked members of the selection stay selected but never move.
    const groupIds = effectiveIds.includes(item.id) ? effectiveIds : [item.id];
    const groupMembers = template.items.filter((i) => groupIds.includes(i.id) && !i.locked);
    if (groupMembers.length > 1) {
      beginGroupMove(e, groupMembers);
      return;
    }

    const restoreSelection = beginDragSelectGuard();
    const start = { x: e.clientX, y: e.clientY, origX: item.x, origY: item.y };
    // Prompt 22: captured once per gesture (mirroring `start` itself) —
    // every raw screen-pixel mouse delta below gets divided by this
    // before it ever touches a page-unit coordinate.
    const scale = zoom / 100;
    // Prompt 26 item 1: hidden items are excluded from both the guide/
    // snap candidates derived below AND the collision-neighbor list built
    // from this same `others` — nothing to align to or collide with if
    // it isn't rendered.
    const others = template.items.filter((i) => i.id !== item.id && !i.hidden);
    const bounds = getItemBounds(item, template.page, getFooterTop(template.items, template.page));
    // Prompt 19: the guide-eligible candidates (other items' edges/
    // centers + the page's own center, item 1) plus the page/footer
    // boundary this item's own kind can't cross (still a real snap
    // target — landing flush should feel just as magnetic as aligning to
    // a neighbor — but flagged so resolveAxisSnap skips a REDUNDANT pink
    // line for it; the edge-glow already covers that same edge).
    const xCandidates = [...alignmentCandidates('x', others, template.page), ...boundaryCandidates(bounds, 'x')];
    const yCandidates = [...alignmentCandidates('y', others, template.page), ...boundaryCandidates(bounds, 'y')];
    // Collision is content-vs-content only — shapes stay exempt, same
    // exemption as the Prompt 5 edge-padding rule. Neighbors are the raw
    // items (not pre-expanded boxes) — the cascade needs each one's own
    // id/locked flag to know who it can push, and by how much — captured
    // once here since only one item's OWN position ever changes as a
    // direct result of this gesture (only-just-cascaded neighbors are
    // recomputed fresh every frame from this same static snapshot, never
    // accumulated — see resolveMoveCollision).
    const collisionNeighbors =
      item.kind === 'content' ? others.filter((o) => o.kind === 'content').map(withEffectiveSize) : null;
    let lastValid = { x: item.x, y: item.y };
    let finalPos = null;
    let finalPushed = new Map();
    // Prompt 19 item 3 — sticky snap: whether EACH axis is currently
    // engaged, tracked across this gesture's own mousemove frames so
    // releasing needs to cross the wider release tolerance, not just the
    // tighter engage one (resolveAxisSnap/findStickySnap).
    let stickyX = false;
    let stickyY = false;

    const onMove = (ev) => {
      draggedRef.current = true;
      let nx = start.origX + pxToMm((ev.clientX - start.x) / scale);
      let ny = start.origY + pxToMm((ev.clientY - start.y) / scale);

      // Prompt 19 item 2: who's "in the same row/column" as the dragged
      // box right now — same overlap test the old distance-label always
      // used — feeds BOTH the equal-spacing detector and (when that
      // doesn't trigger) the plain nearest-gap label, for whichever axis
      // isn't doing equal-spacing this frame.
      const rowNeighbors = others
        .filter((o) => o.y < ny + item.height && o.y + o.height > ny)
        .map((o) => ({ pos: o.x, size: o.width }));
      const colNeighbors = others
        .filter((o) => o.x < nx + item.width && o.x + o.width > nx)
        .map((o) => ({ pos: o.y, size: o.height }));

      const snapX = resolveAxisSnap({
        pos: nx,
        size: item.width,
        candidates: xCandidates,
        rowNeighbors,
        wasSnapped: stickyX,
        crossMin: ny,
        crossMax: ny + item.height,
        pageCrossSize: template.page.height,
        scale,
      });
      nx += snapX.delta;
      stickyX = snapX.snapped;

      const snapY = resolveAxisSnap({
        pos: ny,
        size: item.height,
        candidates: yCandidates,
        rowNeighbors: colNeighbors,
        wasSnapped: stickyY,
        crossMin: nx,
        crossMax: nx + item.width,
        pageCrossSize: template.page.width,
        scale,
      });
      ny += snapY.delta;
      stickyY = snapY.snapped;

      // (1) guide/edge snap (above), (2) page/footer boundary clamp, (3)
      // collision clamp last — collision is the hardest constraint, so it
      // must win if it disagrees with a snap; the guide line drawn below
      // reflects the FINAL (post-collision) position, never a snap that
      // collision ended up overriding.
      const clamped = clampToPage({ x: nx, y: ny, width: item.width, height: item.height }, bounds);
      let fx = clamped.x;
      let fy = clamped.y;
      let pushed = new Map();
      if (collisionNeighbors) {
        const resolved = resolveMoveCollision(
          lastValid,
          { x: fx, y: fy },
          { width: item.width, height: item.height },
          item.rotation || 0,
          collisionNeighbors,
          bounds
        );
        fx = resolved.x;
        fy = resolved.y;
        pushed = resolved.pushed;
        lastValid = { x: fx, y: fy };
      }
      finalPos = { x: fx, y: fy };
      finalPushed = pushed;
      setEdgeHighlight(clamped.edges);

      // Fallback single-nearest-gap label (Prompt 6/14, unchanged) for
      // whichever axis ISN'T showing equal-spacing markers this frame —
      // the two never compete for the same axis at once.
      const labels = [];
      if (snapX.spacing.length === 0) {
        const { before, after } = nearestGap(fx, item.width, rowNeighbors);
        if (before !== null && (after === null || before <= after)) {
          labels.push({ x: fx - before / 2, y: fy + item.height / 2, text: `${(before).toFixed(1)}mm` });
        } else if (after !== null) {
          labels.push({ x: fx + item.width + after / 2, y: fy + item.height / 2, text: `${(after).toFixed(1)}mm` });
        }
      }
      if (snapY.spacing.length === 0) {
        const { before, after } = nearestGap(fy, item.height, colNeighbors);
        if (before !== null && (after === null || before <= after)) {
          labels.push({ x: fx + item.width / 2, y: fy - before / 2, text: `${(before).toFixed(1)}mm` });
        } else if (after !== null) {
          labels.push({ x: fx + item.width / 2, y: fy + item.height + after / 2, text: `${(after).toFixed(1)}mm` });
        }
      }

      const spacing = [
        ...snapX.spacing.map((g) => ({ axis: 'x', from: g.start, to: g.end, cross: fy + item.height / 2, text: `${(g.value).toFixed(1)}mm` })),
        ...snapY.spacing.map((g) => ({ axis: 'y', from: g.start, to: g.end, cross: fx + item.width / 2, text: `${(g.value).toFixed(1)}mm` })),
      ];

      setGuides({
        vertical: snapX.line ? [snapX.line] : [],
        horizontal: snapY.line ? [snapY.line] : [],
        labels,
        spacing,
      });
      setLive(finalPos);
      setPushPreview(Object.fromEntries(pushed));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (finalPos) {
        if (finalPushed.size > 0) {
          const ids = [item.id, ...finalPushed.keys()];
          updateItems(ids, (i) => (i.id === item.id ? finalPos : finalPushed.get(i.id)));
        } else {
          updateItem(item.id, finalPos);
        }
      }
      setLive(null);
      setPushPreview({});
      setEdgeHighlight(null);
      setGuides(null);
      restoreSelection();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Prompt 17 item 3: the multi-item-selection counterpart to beginMove
  // above — every member of `groupMembers` (already lock-filtered, always
  // includes `item` itself) translates by the exact same delta, so the
  // group slides as one rigid piece rather than squeezing or leaving
  // members behind. Collision against OUTSIDE items is resolved using the
  // union of the group's own CONTENT members' (shapes stay exempt, same
  // as everywhere else) rotated bounding boxes as a single stand-in
  // "mover" box — since every member moves identically, only that
  // envelope's outer silhouette can ever be what an outside neighbor
  // contacts, so treating it as one solid box is exact, not an
  // approximation, and lets this reuse resolveMoveCollision unchanged.
  // Members never push or collide against EACH OTHER during this gesture
  // (Prompt 17's explicit call) — internal gaps inside the envelope are
  // simply not tested against anything.
  const beginGroupMove = (e, groupMembers) => {
    const restoreSelection = beginDragSelectGuard();
    const start = { x: e.clientX, y: e.clientY };
    const scale = zoom / 100; // Prompt 22 — see beginMove's own comment
    const footerTop = getFooterTop(template.items, template.page);
    const starts = groupMembers.map((m) => ({ id: m.id, item: m, origX: m.x, origY: m.y }));
    const groupIdSet = new Set(groupMembers.map((m) => m.id));

    const contentMembers = groupMembers.filter((m) => m.kind === 'content');
    const outsideContent = template.items
      .filter((i) => i.kind === 'content' && !i.hidden && !groupIdSet.has(i.id))
      .map(withEffectiveSize);
    const bounds = contentMembers.length ? getItemBounds(contentMembers[0], template.page, footerTop) : null;

    let startEnvelope = null;
    if (contentMembers.length) {
      const boxes = contentMembers.map(withEffectiveSize).map(rotatedBoundingBox);
      startEnvelope = {
        minX: Math.min(...boxes.map((b) => b.minX)),
        maxX: Math.max(...boxes.map((b) => b.maxX)),
        minY: Math.min(...boxes.map((b) => b.minY)),
        maxY: Math.max(...boxes.map((b) => b.maxY)),
      };
    }

    // Prompt 19 item 4: the group's OWN bounding box (every member, any
    // kind — shapes included, matching how guides always treat every
    // item) participates in guides as the thing being aligned while it's
    // the one being dragged. The reverse (some OTHER single item snapping
    // to a persisted group selection) doesn't apply here — starting a
    // drag on a different item always collapses the selection to just
    // that item first (see beginMove), so a group's guide box can never
    // be a candidate for anything else to align to; scoped accordingly,
    // per the prompt's own note to check which direction is meaningful.
    // No equal-spacing here (Prompt 17/18 already scoped group gestures
    // away from smart-guide snapping's extra complexity; this pass only
    // adds the page-center/sticky-alignment half, not the flagship
    // equal-spacing detection, to that same gesture).
    const guideBoxes = groupMembers.map(withEffectiveSize).map(rotatedBoundingBox);
    const guideEnvelope = {
      minX: Math.min(...guideBoxes.map((b) => b.minX)),
      minY: Math.min(...guideBoxes.map((b) => b.minY)),
      width: Math.max(...guideBoxes.map((b) => b.maxX)) - Math.min(...guideBoxes.map((b) => b.minX)),
      height: Math.max(...guideBoxes.map((b) => b.maxY)) - Math.min(...guideBoxes.map((b) => b.minY)),
    };
    const othersForGuides = template.items.filter((i) => !groupIdSet.has(i.id) && !i.hidden);
    const groupXCandidates = alignmentCandidates('x', othersForGuides, template.page);
    const groupYCandidates = alignmentCandidates('y', othersForGuides, template.page);
    let stickyX = false;
    let stickyY = false;

    // The single shared delta every member must obey: each member's own
    // kind-aware boundary (getItemBounds — true page edge for a shape,
    // PAGE_PADDING inset for content) caps how far it can personally
    // travel on this axis; intersecting every member's own allowed range
    // gives the range the WHOLE group can move while keeping every
    // member on-page, without any one member clamping more than another
    // (which would squeeze the group instead of sliding it as one piece).
    const allowedDelta = (axis, desired) => {
      let lo = -Infinity;
      let hi = Infinity;
      starts.forEach(({ item: m, origX, origY }) => {
        const b = getItemBounds(m, template.page, footerTop);
        const minB = axis === 'x' ? b.minX : b.minY;
        const maxB = axis === 'x' ? b.maxX : b.maxY;
        const pos = axis === 'x' ? origX : origY;
        const size = axis === 'x' ? m.width : m.height;
        lo = Math.max(lo, minB - pos);
        hi = Math.min(hi, maxB - size - pos);
      });
      return Math.max(lo, Math.min(desired, hi));
    };

    let lastShift = { dx: 0, dy: 0 };
    let finalShift = lastShift;
    let finalPushed = new Map();

    const onMove = (ev) => {
      draggedRef.current = true;
      // Prompt 22: raw screen-pixel deltas converted to page units before
      // anything downstream (snap, boundary clamp, collision) ever sees
      // them.
      const rawDx = pxToMm((ev.clientX - start.x) / scale);
      const rawDy = pxToMm((ev.clientY - start.y) / scale);

      // Prompt 19 item 4: snap the GROUP's own envelope against outside
      // items/page-center before the per-member boundary clamp below —
      // same "snap first, then clamp, then collision" order a single
      // item's own move already follows.
      const candidateX = guideEnvelope.minX + rawDx;
      const candidateY = guideEnvelope.minY + rawDy;
      const snapX = resolveAxisSnap({
        pos: candidateX,
        size: guideEnvelope.width,
        candidates: groupXCandidates,
        rowNeighbors: [],
        wasSnapped: stickyX,
        crossMin: candidateY,
        crossMax: candidateY + guideEnvelope.height,
        pageCrossSize: template.page.height,
        scale,
      });
      stickyX = snapX.snapped;
      const snapY = resolveAxisSnap({
        pos: candidateY,
        size: guideEnvelope.height,
        candidates: groupYCandidates,
        rowNeighbors: [],
        wasSnapped: stickyY,
        crossMin: candidateX + snapX.delta,
        crossMax: candidateX + snapX.delta + guideEnvelope.width,
        pageCrossSize: template.page.width,
        scale,
      });
      stickyY = snapY.snapped;

      let dx = allowedDelta('x', rawDx + snapX.delta);
      let dy = allowedDelta('y', rawDy + snapY.delta);
      let pushed = new Map();

      if (startEnvelope) {
        const size = { width: startEnvelope.maxX - startEnvelope.minX, height: startEnvelope.maxY - startEnvelope.minY };
        const resolved = resolveMoveCollision(
          { x: startEnvelope.minX + lastShift.dx, y: startEnvelope.minY + lastShift.dy },
          { x: startEnvelope.minX + dx, y: startEnvelope.minY + dy },
          size,
          0,
          outsideContent,
          bounds
        );
        dx = resolved.x - startEnvelope.minX;
        dy = resolved.y - startEnvelope.minY;
        pushed = resolved.pushed;
      }

      lastShift = { dx, dy };
      finalShift = lastShift;
      finalPushed = pushed;

      // Prompt 18: EVERY member — including `item` itself, the one whose
      // own mousedown started this gesture — goes through the shared
      // pushPreview channel rather than `item`'s own local `live` state,
      // so GroupSelectionOverlay's box (which reads pushPreview, not any
      // one CanvasItem's private state) can track the live drag too.
      const preview = {};
      starts.forEach(({ id, origX, origY }) => {
        preview[id] = { x: origX + dx, y: origY + dy };
      });
      pushed.forEach((pos, id) => {
        preview[id] = pos;
      });

      const edges = { left: false, right: false, top: false, bottom: false };
      starts.forEach(({ item: m, origX, origY }) => {
        const b = getItemBounds(m, template.page, footerTop);
        const nx = origX + dx;
        const ny = origY + dy;
        if (nx <= b.minX + EDGE_CONTACT_EPSILON_MM) edges.left = true;
        if (nx + m.width >= b.maxX - EDGE_CONTACT_EPSILON_MM) edges.right = true;
        if (ny <= b.minY + EDGE_CONTACT_EPSILON_MM) edges.top = true;
        if (ny + m.height >= b.maxY - EDGE_CONTACT_EPSILON_MM) edges.bottom = true;
      });

      setEdgeHighlight(edges);
      setGuides({ vertical: snapX.line ? [snapX.line] : [], horizontal: snapY.line ? [snapY.line] : [], labels: [], spacing: [] });
      setPushPreview(preview);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const { dx, dy } = finalShift;
      const patches = new Map();
      starts.forEach(({ id, origX, origY }) => patches.set(id, { x: origX + dx, y: origY + dy }));
      finalPushed.forEach((pos, id) => patches.set(id, pos));
      if (dx || dy || finalPushed.size > 0) {
        updateItems([...patches.keys()], (i) => patches.get(i.id));
      }
      setLive(null);
      setPushPreview({});
      setEdgeHighlight(null);
      setGuides(null);
      restoreSelection();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const beginResize = (e, handle) => {
    e.stopPropagation();
    e.preventDefault();
    // A sub-part being selected doesn't hide the whole item's handles
    // (Prompt 15 — internal padding is tight enough that "click empty
    // space to select the container" was often unreachable) — grabbing
    // one both performs the resize AND switches selection to the whole
    // item, so there's no intermediate step required first.
    if (selection.part) setSelection({ ids: [item.id], part: null });
    const restoreSelection = beginDragSelectGuard();
    const start = { x: item.x, y: item.y, width: item.width, height: item.height, rotation: item.rotation || 0 };
    const startMouse = { x: e.clientX, y: e.clientY };
    const scale = zoom / 100; // Prompt 22 — see beginMove's own comment
    const bounds = getItemBounds(item, template.page, getFooterTop(template.items, template.page));
    // Prompt 26 item 1: hidden items are excluded from both the guide/
    // snap candidates derived below AND the collision-neighbor list built
    // from this same `others` — nothing to align to or collide with if
    // it isn't rendered.
    const others = template.items.filter((i) => i.id !== item.id && !i.hidden);
    // Prompt 19: same candidate set a move drag snaps against — every
    // other item's edges/centers, the page's own center (item 1), and
    // the page/footer boundary (silent — see resolveAxisSnap) — a
    // resized edge should land flush against any of those just as
    // readily as a move would. Equal-spacing detection (item 2) is
    // deliberately NOT wired into resize: it's defined in terms of a box
    // translating past fixed-size neighbors, and a resize changes the
    // dragged item's own size mid-gesture, which breaks that model — out
    // of scope for this pass.
    const xCandidates = [...alignmentCandidates('x', others, template.page), ...boundaryCandidates(bounds, 'x')];
    const yCandidates = [...alignmentCandidates('y', others, template.page), ...boundaryCandidates(bounds, 'y')];
    const collisionNeighbors =
      item.kind === 'content' ? others.filter((o) => o.kind === 'content').map(withEffectiveSize) : null;
    let finalBox = null;
    let finalPushed = new Map();
    let stickyX = false;
    let stickyY = false;

    const onMove = (ev) => {
      draggedRef.current = true;
      // Prompt 22: raw screen-pixel mouse delta -> page units, BEFORE it
      // ever reaches resizeRotatedBox's own width/height/position math.
      const raw = resizeRotatedBox(start, handle, pxToMm((ev.clientX - startMouse.x) / scale), pxToMm((ev.clientY - startMouse.y) / scale));

      // Snap only the edge this handle actually moves, keeping the other
      // (fixed) edge untouched — e.g. dragging the W handle may shift x
      // left/right, but must adjust width oppositely so the right edge
      // stays exactly where the resize gesture already fixed it. `size:
      // 0` collapses resolveAxisSnap's 3-point test (pos/center/far) down
      // to just the one edge actually moving, same as the old snapAxis
      // calls here did.
      let lineX = null;
      let lineY = null;
      if (handle.fx === 1) {
        const snap = resolveAxisSnap({ pos: raw.x + raw.width, size: 0, candidates: xCandidates, rowNeighbors: [], wasSnapped: stickyX, crossMin: raw.y, crossMax: raw.y + raw.height, pageCrossSize: template.page.height, scale });
        raw.width += snap.delta;
        stickyX = snap.snapped;
        lineX = snap.line;
      } else if (handle.fx === 0) {
        const snap = resolveAxisSnap({ pos: raw.x, size: 0, candidates: xCandidates, rowNeighbors: [], wasSnapped: stickyX, crossMin: raw.y, crossMax: raw.y + raw.height, pageCrossSize: template.page.height, scale });
        raw.x += snap.delta;
        raw.width -= snap.delta;
        stickyX = snap.snapped;
        lineX = snap.line;
      }
      if (handle.fy === 1) {
        const snap = resolveAxisSnap({ pos: raw.y + raw.height, size: 0, candidates: yCandidates, rowNeighbors: [], wasSnapped: stickyY, crossMin: raw.x, crossMax: raw.x + raw.width, pageCrossSize: template.page.width, scale });
        raw.height += snap.delta;
        stickyY = snap.snapped;
        lineY = snap.line;
      } else if (handle.fy === 0) {
        const snap = resolveAxisSnap({ pos: raw.y, size: 0, candidates: yCandidates, rowNeighbors: [], wasSnapped: stickyY, crossMin: raw.x, crossMax: raw.x + raw.width, pageCrossSize: template.page.width, scale });
        raw.y += snap.delta;
        raw.height -= snap.delta;
        stickyY = snap.snapped;
        lineY = snap.line;
      }

      const clamped = clampResizeToPage(raw, handle, bounds);
      let box = { x: clamped.x, y: clamped.y, width: clamped.width, height: clamped.height, rotation: start.rotation };
      let pushed = new Map();
      if (collisionNeighbors) {
        const resolved = resolveResizeCollision(start, box, handle, collisionNeighbors, bounds);
        box = resolved;
        pushed = resolved.pushed;
      }
      finalBox = { x: box.x, y: box.y, width: box.width, height: box.height };
      finalPushed = pushed;
      setEdgeHighlight(clamped.edges);

      // Fallback nearest-gap labels (Prompt 6/14, unchanged) — resize has
      // no equal-spacing markers to compete with, so these always show.
      const rowNeighbors = others.filter((o) => o.y < box.y + box.height && o.y + o.height > box.y).map((o) => ({ pos: o.x, size: o.width }));
      const colNeighbors = others.filter((o) => o.x < box.x + box.width && o.x + o.width > box.x).map((o) => ({ pos: o.y, size: o.height }));
      const labels = [];
      const gapX = nearestGap(box.x, box.width, rowNeighbors);
      if (gapX.before !== null && (gapX.after === null || gapX.before <= gapX.after)) {
        labels.push({ x: box.x - gapX.before / 2, y: box.y + box.height / 2, text: `${(gapX.before).toFixed(1)}mm` });
      } else if (gapX.after !== null) {
        labels.push({ x: box.x + box.width + gapX.after / 2, y: box.y + box.height / 2, text: `${(gapX.after).toFixed(1)}mm` });
      }
      const gapY = nearestGap(box.y, box.height, colNeighbors);
      if (gapY.before !== null && (gapY.after === null || gapY.before <= gapY.after)) {
        labels.push({ x: box.x + box.width / 2, y: box.y - gapY.before / 2, text: `${(gapY.before).toFixed(1)}mm` });
      } else if (gapY.after !== null) {
        labels.push({ x: box.x + box.width / 2, y: box.y + box.height + gapY.after / 2, text: `${(gapY.after).toFixed(1)}mm` });
      }

      setGuides({ vertical: lineX ? [lineX] : [], horizontal: lineY ? [lineY] : [], labels, spacing: [] });
      setLive(finalBox);
      setPushPreview(Object.fromEntries(pushed));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (finalBox) {
        if (finalPushed.size > 0) {
          const ids = [item.id, ...finalPushed.keys()];
          updateItems(ids, (i) => (i.id === item.id ? finalBox : finalPushed.get(i.id)));
        } else {
          updateItem(item.id, finalBox);
        }
      }
      setLive(null);
      setPushPreview({});
      setEdgeHighlight(null);
      setGuides(null);
      restoreSelection();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Prompt 22 audit: rotate needs NO zoom conversion at all, single-item
  // or group. The angle comes from atan2 of the mouse's position relative
  // to a CENTER already measured via getBoundingClientRect — a browser-
  // computed SCREEN-space rect that already reflects the page-frame's
  // current CSS zoom transform automatically — and both sides of that
  // atan2 (the center and `ev.clientX/clientY`) live in the SAME screen
  // space throughout. An angle is a ratio (dy/dx via atan2), not a raw
  // magnitude, so it's scale-invariant by construction: doubling both dx
  // and dy (as zoom would, if it affected this at all) never changes the
  // angle between them. Confirmed by testing at 50%/150% — rotation felt
  // and behaved identically to 100%.
  const beginRotate = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (selection.part) setSelection({ ids: [item.id], part: null });
    const restoreSelection = beginDragSelectGuard();
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let finalRotation = null;

    const onMove = (ev) => {
      draggedRef.current = true;
      const raw = Math.round((Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90);
      const { value, snapped } = snapRotation(raw);
      finalRotation = { rotation: value };
      setRotationSnapped(snapped);
      setLive(finalRotation);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (finalRotation) updateItem(item.id, finalRotation);
      setLive(null);
      setRotationSnapped(false);
      restoreSelection();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handlePartClick = (e, part) => {
    e.stopPropagation();
    if (draggedRef.current) return; // this click ended a drag, not a part pick
    setSelection({ ids: [item.id], part: { id: item.id, key: part } });
  };

  // Right-click (Prompt 15). `part` is the specific sub-part right-
  // clicked, or null for the whole item. If this item is already part of
  // the current selection (whole or multi), that selection is left alone
  // — right-clicking one of several selected items shows the
  // intersection-of-actions menu for all of them, not a reset to just
  // this one. Otherwise it becomes the new (single) selection first, same
  // as a left-click would, so the menu that follows always matches what's
  // actually selected.
  const beginContextMenu = (e, part) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selection.ids.includes(item.id)) {
      setSelection({ ids: [item.id], part: part ? { id: item.id, key: part } : null });
    } else if (part && !(selection.part && selection.part.id === item.id && selection.part.key === part)) {
      setSelection({ ids: [item.id], part: { id: item.id, key: part } });
    }
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  // Drags one column-boundary divider — redistributes width between just
  // the two columns on either side of it, every other column and the
  // table's own total width/height (the outer 8-point resize) untouched.
  // Uses `live.columnWidths` (merged into `current` below) the same
  // one-undo-step-per-gesture way position/size do.
  const beginColumnResize = (e, colIndex) => {
    e.stopPropagation();
    e.preventDefault();
    const restoreSelection = beginDragSelectGuard();
    const numCols = def.render().columns.length;
    const startWidths = item.columnWidths || defaultColumnWidths(numCols);
    const startMouse = { x: e.clientX, y: e.clientY };
    const rotation = item.rotation || 0;
    const scale = zoom / 100; // Prompt 22 — see beginMove's own comment
    let finalWidths = null;

    const onMove = (ev) => {
      draggedRef.current = true;
      // Prompt 22: screen-pixel delta -> page units before rotateVector
      // (rotateVector is linear, so dividing before or after is
      // equivalent — doing it before keeps every downstream value in
      // page units consistently, matching every other gesture here).
      const local = rotateVector(pxToMm((ev.clientX - startMouse.x) / scale), pxToMm((ev.clientY - startMouse.y) / scale), -rotation);
      const deltaPct = (local.x / item.width) * 100;
      const widths = [...startWidths];
      let a = startWidths[colIndex] + deltaPct;
      let b = startWidths[colIndex + 1] - deltaPct;
      if (a < MIN_COLUMN_PCT) { b -= MIN_COLUMN_PCT - a; a = MIN_COLUMN_PCT; }
      if (b < MIN_COLUMN_PCT) { a -= MIN_COLUMN_PCT - b; b = MIN_COLUMN_PCT; }
      widths[colIndex] = a;
      widths[colIndex + 1] = b;
      finalWidths = widths;
      setLive({ columnWidths: widths });

      // Prompt 20 item 2: live pill labels — the two changing columns'
      // actual pixel widths, and the pixel distance from the dragged
      // divider to every OTHER divider in this same table, so a user can
      // match widths precisely without guessing at the raw percentages.
      const cumulativePct = [];
      let acc = 0;
      widths.forEach((w) => {
        acc += w;
        cumulativePct.push(acc);
      });
      const draggedDividerPct = cumulativePct[colIndex];
      const leftStartPct = colIndex === 0 ? 0 : cumulativePct[colIndex - 1];
      const labels = [
        { xPct: (leftStartPct + draggedDividerPct) / 2, yPct: 42, text: `${((a / 100) * item.width).toFixed(1)}mm` },
        {
          xPct: (draggedDividerPct + cumulativePct[colIndex + 1]) / 2,
          yPct: 42,
          text: `${((b / 100) * item.width).toFixed(1)}mm`,
        },
      ];
      cumulativePct.slice(0, -1).forEach((pct, i) => {
        if (i === colIndex) return; // the dragged divider itself — nothing to measure against it
        const distanceMm = (Math.abs(pct - draggedDividerPct) / 100) * item.width;
        labels.push({ xPct: (pct + draggedDividerPct) / 2, yPct: 68, text: `${distanceMm.toFixed(1)}mm` });
      });
      setColumnDragLabels(labels);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (finalWidths) updateItem(item.id, { columnWidths: finalWidths });
      setLive(null);
      setColumnDragLabels(null);
      restoreSelection();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // The selection outline (`.item--selected::after`) uses border-radius:
  // inherit, so the frame needs to carry the same radius as what's
  // actually rendered inside it — `item.cornerRadius`, a universal
  // per-item style property (Prompt 15) defaulting to 0 for every content
  // type (Logo/Signature/QR and every text-bearing variant included, not
  // just the table it started as) — the shape's own radius (including the
  // ellipse/line special cases) for shapes — otherwise a round shape
  // would get a square selection box.
  // Prompt 24 item 4: `logo`'s shape/mask picker overrides the generic
  // cornerRadius here when set — same frame field, so the selection
  // outline (`border-radius: inherit`) stays in sync either way.
  const logoRadius = item.kind === 'content' ? logoMaskRadius(item) : null;
  // Prompt 27: a top-level `image` item styles its frame exactly like a
  // content item (background/border/corner-radius on `bgColor`/
  // `borderColor`/`borderWidth`/`cornerRadius`) — it just has no
  // ELEMENT_TYPES entry to drive a logo mask, text color, etc., so
  // `logoRadius` (content-only) is correctly always null for it.
  // Prompt 28: reads `current` (theme-resolved), not the raw `item` prop,
  // for every field that can carry a theme-link sentinel — borderColor/
  // bgColor/textColor. `borderWidth`/`cornerRadius` are plain numbers,
  // never linkable, so those stay on `item` (equivalent either way, since
  // resolveItemTheme passes them through unchanged, but `item` is what
  // every OTHER numeric read on this component already uses).
  const frameStyle =
    item.kind === 'content' || item.kind === 'image'
      ? {
          borderRadius: logoRadius !== null ? logoRadius : mm(item.cornerRadius ?? 0),
          borderColor: current.borderColor,
          borderWidth: item.borderWidth ? mm(item.borderWidth) : undefined,
          borderStyle: item.borderWidth ? 'solid' : undefined,
          color: current.textColor,
          background: current.bgColor,
        }
      : { borderRadius: shapeBorderRadius(item) };

  // Only preview the WHOLE item's outline when nothing about it is
  // already selected (whole or part — either one already renders
  // .item--selected on this same frame, so a second, lighter outline on
  // top would just be visual noise) and no sub-part is the one actually
  // being hovered right now (that takes priority, same as clicks do).
  const showHoverWhole = !readOnly && hoverWhole && hoveredPart === null && !isSelected;

  return (
    <div
      className={`item item--${item.kind}${def ? ` item--${def.variant}` : ''}${isSelected ? ' item--selected' : ''}${showHoverWhole ? ' item--hover-preview' : ''}`}
      style={{
        position: 'absolute',
        left: mm(current.x),
        top: mm(current.y),
        // The item's own border/background/selection-outline all live on
        // THIS frame, so growing it (not just the inner `.item__scale`) is
        // what makes an under-sized text box visually contain its content
        // instead of just having the content spill past an unchanged
        // border (Prompt 14).
        width: mm(effectiveWidth),
        height: mm(effectiveHeight),
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        cursor: readOnly ? 'default' : item.locked ? 'default' : 'grab',
        ...frameStyle,
      }}
      onMouseDown={readOnly ? undefined : beginMove}
      onContextMenu={readOnly ? undefined : (e) => beginContextMenu(e, null)}
      onMouseEnter={readOnly ? undefined : () => setHoverWhole(true)}
      onMouseLeave={
        readOnly
          ? undefined
          : () => {
              setHoverWhole(false);
              setHoveredPart(null);
            }
      }
    >
      <div
        className="item__scale"
        style={{
          width: mm(scaleWrapperWidth),
          height: mm(scaleWrapperHeight),
          transform: skipBoxScale ? undefined : `scale(${scaleX}, ${scaleY})`,
          // A box smaller than its text's natural footprint should show
          // that (spill past the box, still fully visible) rather than
          // silently clip it away — same safety net as before, just no
          // longer paired with a scale transform for text variants.
          overflow: isTextVariant ? 'visible' : undefined,
          // Text variants position their (fixed-size) content within any
          // extra box height via this flex wrapper instead of stretching
          // it — top/middle/bottom, Prompt 13's new vertical align control.
          display: isTextVariant ? 'flex' : undefined,
          flexDirection: isTextVariant ? 'column' : undefined,
          justifyContent: isTextVariant ? vAlignToFlex(item.contentAlignY) : undefined,
          // Prompt 24 item 4: the logo shape/mask picker has to clip the
          // actual rendered <img> pixels, not just round the outer frame's
          // own background (which sits entirely behind this wrapper and
          // is never itself visible) — `.item__scale` already clips its
          // content via `overflow: hidden`, so giving IT the same radius
          // is what makes the mask genuinely visible.
          borderRadius: logoRadius !== null ? logoRadius : undefined,
        }}
      >
        {item.kind === 'shape' ? (
          <ShapeBody item={current} />
        ) : item.kind === 'image' ? (
          <ImageBody item={current} />
        ) : (
          <ContentBody
            item={current}
            isPartSelected={isPartSelected}
            onSelectPart={readOnly ? NOOP : handlePartClick}
            isPartHovered={readOnly ? NOOP : isPartHovered}
            onPartHoverEnter={readOnly ? NOOP : onPartHoverEnter}
            onPartHoverLeave={readOnly ? NOOP : onPartHoverLeave}
            onPartContextMenu={readOnly ? NOOP : beginContextMenu}
          />
        )}
      </div>

      {/* Prompt 27 item 3: live pixelation warning — `current.width/
          height` (not the stale stored `item.width/height`) so this
          updates every frame during an active resize gesture, not just
          once at creation, and clears itself the instant the box is
          resized back down under the threshold. Editor-only (never
          shown in readOnly Preview — that's a genuine render, not an
          editing affordance). */}
      {!readOnly && item.kind === 'image' && isImagePixelated(item, current.width, current.height) && (
        <Tooltip label="This image may look pixelated at its current size" className="tooltip-wrap--pixelation-badge">
          <div className="item__pixelation-badge">
            <WarningIcon size={11} />
          </div>
        </Tooltip>
      )}

      {isTextVariant && (
        <>
          <div
            ref={minRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              visibility: 'hidden',
              pointerEvents: 'none',
              zIndex: -1,
              width: def.variant && WRAPPING_VARIANTS.has(def.variant) ? 'min-content' : undefined,
            }}
          >
            <ContentBody item={current} isPartSelected={() => false} onSelectPart={() => {}} isPartHovered={() => false} onPartHoverEnter={() => {}} onPartHoverLeave={() => {}} onPartContextMenu={() => {}} />
          </div>
          <div
            ref={wrapRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              visibility: 'hidden',
              pointerEvents: 'none',
              zIndex: -1,
              width: mm(Math.max(current.width, minWidth ?? current.width)),
            }}
          >
            <ContentBody item={current} isPartSelected={() => false} onSelectPart={() => {}} isPartHovered={() => false} onPartHoverEnter={() => {}} onPartHoverLeave={() => {}} onPartContextMenu={() => {}} />
          </div>
        </>
      )}

      {isWholeSelected && !item.locked && def?.variant === 'table' && (() => {
        const widths = current.columnWidths || defaultColumnWidths(def.render().columns.length);
        let cumulative = 0;
        return widths.slice(0, -1).map((w, i) => {
          cumulative += w;
          return (
            <div
              key={i}
              className="item__col-divider"
              style={{ left: `${cumulative}%` }}
              onMouseDown={(e) => beginColumnResize(e, i)}
            />
          );
        });
      })()}

      {/* Prompt 20 item 2: live distance pills while dragging a column
          divider — reuses the exact same `.align-guide-label` pill
          styling the item-to-item spacing guides use (Prompt 6/19), just
          positioned as percentages of THIS item's own box (like the
          dividers themselves) rather than through the shared canvas-wide
          guides channel, so they inherit the item's rotation for free. */}
      {columnDragLabels && columnDragLabels.map((l, i) => (
        <div key={`cdl-${i}`} className="align-guide-label" style={{ left: `${l.xPct}%`, top: `${l.yPct}%` }}>
          {l.text}
        </div>
      ))}

      {showIndividualHandles && (() => {
        // "left/right/top/bottom" only stays well-defined for an
        // unrotated item — a rotated one just keeps the fixed offset
        // (Infinity clearance on every side is adaptiveHandleOffset's
        // no-neighbor fallback, so this reuses the exact same call).
        const clearance =
          rotation === 0
            ? edgeClearance(item, template.items.filter((i) => i.id !== item.id && !i.hidden).map(withEffectiveSize))
            : { left: Infinity, right: Infinity, top: Infinity, bottom: Infinity };
        return (
          <>
            {RESIZE_HANDLES.map((h) => (
              <div
                key={h.key}
                className="item__resize-handle"
                style={{
                  left: `calc(${h.fx * 100}% + ${adaptiveHandleOffset(h.fx, clearance.left, clearance.right)})`,
                  top: `calc(${h.fy * 100}% + ${adaptiveHandleOffset(h.fy, clearance.top, clearance.bottom)})`,
                  cursor: h.cursor,
                }}
                onMouseDown={(e) => beginResize(e, h)}
              />
            ))}
            <div
              className={`item__rotate-handle${rotationSnapped ? ' item__rotate-handle--snapped' : ''}`}
              onMouseDown={beginRotate}
            >
              {RotateIcon}
            </div>
          </>
        );
      })()}
    </div>
  );
}
