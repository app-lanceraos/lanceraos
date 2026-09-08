import { PAGE_PADDING } from '../data/initialState';
import { pxToMm, roundMm, mmToPx } from './units';

// Phase 2a: every constant below now expresses a real mm quantity — the
// unit boundary conversion (pxToMm) is applied ONCE, here, at module
// load, from the ORIGINAL px value each constant was tuned/verified at
// (kept as the literal argument, not silently replaced with a rounded mm
// number, so the history/reasoning in each constant's own comment stays
// legible and auditable against the value it actually produces). See
// each constant's own comment below for whether that direct conversion
// was the right call, or whether it was deliberately retuned to a
// cleaner mm value instead — the two cases have different reasoning and
// are called out individually, not applied uniformly.
const mmFromPx = (px) => roundMm(pxToMm(px));

// Minimum on-canvas item size — was a bare `16` (px) threaded through
// resizeRotatedBox/clampResizeToPage/resolveResizeCollision's own hard
// floors. 16px -> 4.23mm; retuned to a clean 4mm (a small but still
// real, grabbable element on an actual invoice page) rather than kept at
// the raw conversion's extra digit of precision that was never
// deliberate in the first place (16 was itself just a round px number).
export const MIN_ITEM_SIZE_MM = 4;
// The SMALLER absolute floor used only during a proportional GROUP
// resize (GroupSelectionOverlay's own scale-down floor, was a bare `4`
// px there — a last-resort "never quite reach zero" guard, not a
// meaningful minimum size in its own right) — converted the same way,
// 4px -> 1.06mm, rounded to a clean 1mm.
export const MIN_SCALED_ITEM_SIZE_MM = 1;

// The footer is fixed/locked (never moved or resized by the user), so its
// top edge — where every other item's reserved bottom space begins — is
// just its own stored `y`, no DOM measurement needed. Falls back to the
// page's own bottom (i.e. no additional restriction) if a template were
// ever missing it.
export function getFooterTop(items, page) {
  const footer = items.find((i) => i.type === 'footer');
  return footer ? footer.y : page.height;
}

// The valid position/size envelope for an item: shapes may sit flush
// against the true page edge (0/page.width — a decorative bar/divider
// along a page edge is a legitimate design choice on its own merits) and
// content items must stay at least PAGE_PADDING away from every edge —
// EXCEPT at the bottom, where the footer's own top edge applies instead
// whenever it's the more restrictive of the two. Every kind is excluded
// from the footer's strip, including shapes: a decorative shape is
// allowed flush against the true page edge everywhere else, but not
// through the footer specifically.
export function getItemBounds(item, page, footerTop = page.height) {
  const bottomLimit = Math.min(page.height, footerTop);
  if (item.kind === 'shape') {
    return { minX: 0, maxX: page.width, minY: 0, maxY: bottomLimit };
  }
  return {
    minX: PAGE_PADDING,
    maxX: page.width - PAGE_PADDING,
    minY: PAGE_PADDING,
    maxY: Math.min(page.height - PAGE_PADDING, bottomLimit),
  };
}

// Rotate a vector (dx,dy) by `degrees` around the origin.
export function rotateVector(dx, dy, degrees) {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

// Snap a rotate-handle angle to the nearest straight orientation (0/90/180/270,
// plus their negative/wrap-around equivalents) when within `tolerance` degrees
// of it, so dragging past a "straight" pose feels/looks intentional.
const SNAP_TARGETS = [-360, -270, -180, -90, 0, 90, 180, 270, 360];

export function snapRotation(degrees, tolerance = 5) {
  let closest = degrees;
  let closestDist = Infinity;
  for (const target of SNAP_TARGETS) {
    const dist = Math.abs(degrees - target);
    if (dist < closestDist) {
      closestDist = dist;
      closest = target;
    }
  }
  if (closestDist <= tolerance) return { value: closest, snapped: true };
  return { value: degrees, snapped: false };
}

// The 8 resize handles shared by every canvas item (shape or content).
// fx/fy locate the handle on the item's own unrotated box in [0,1]
// (0 = left/top edge, 1 = right/bottom edge, 0.5 = centered on that axis —
// used by edge handles to mean "this axis doesn't move").
export const RESIZE_HANDLES = [
  { key: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { key: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { key: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { key: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { key: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { key: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { key: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { key: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

// Compute the new {x,y,width,height} for a rotated, resizable box given a
// drag of one of its 8 handles. `start` is the box's geometry as it was
// AT THE START of the drag (never mutated mid-gesture); `handle` is one of
// RESIZE_HANDLES; `dx,dy` is the cumulative mouse movement in page-space
// pixels since the drag began.
//
// Rotation pivots around the box's own center (the CSS default
// transform-origin), so resizing from a corner/edge while keeping the
// OPPOSITE corner/edge visually fixed has to happen in the box's own
// unrotated local space: rotate the mouse delta into that local space,
// move the dragged point there while the fixed point stays put, derive
// the new width/height/center from those two local points, then rotate
// the resulting center back out to page space.
export function resizeRotatedBox(start, handle, dx, dy, minSize = MIN_ITEM_SIZE_MM) {
  const { x, y, width, height, rotation = 0 } = start;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const local = rotateVector(dx, dy, -rotation);

  let newWidth = width;
  let newHeight = height;
  let centerOffsetX = 0;
  let centerOffsetY = 0;

  if (handle.fx !== 0.5) {
    const fixedLocalX = (1 - handle.fx - 0.5) * width;
    const draggedLocalX = (handle.fx - 0.5) * width + local.x;
    const rawWidth = draggedLocalX - fixedLocalX;
    newWidth = Math.max(minSize, Math.abs(rawWidth));
    const sign = rawWidth < 0 ? -1 : 1;
    const clampedDraggedX = fixedLocalX + sign * newWidth;
    centerOffsetX = (fixedLocalX + clampedDraggedX) / 2;
  }

  if (handle.fy !== 0.5) {
    const fixedLocalY = (1 - handle.fy - 0.5) * height;
    const draggedLocalY = (handle.fy - 0.5) * height + local.y;
    const rawHeight = draggedLocalY - fixedLocalY;
    newHeight = Math.max(minSize, Math.abs(rawHeight));
    const sign = rawHeight < 0 ? -1 : 1;
    const clampedDraggedY = fixedLocalY + sign * newHeight;
    centerOffsetY = (fixedLocalY + clampedDraggedY) / 2;
  }

  const worldOffset = rotateVector(centerOffsetX, centerOffsetY, rotation);
  const newCx = cx + worldOffset.x;
  const newCy = cy + worldOffset.y;

  return {
    x: newCx - newWidth / 2,
    y: newCy - newHeight / 2,
    width: newWidth,
    height: newHeight,
  };
}

// ---------- Prompt 19: professional alignment guides ----------
//
// Rebuilt as a set of small composable pieces rather than one monolithic
// "compute everything" function — CanvasItem orchestrates which of these
// apply to a given gesture (single-item move gets the full set including
// equal-spacing; resize and group-move get page-center + sticky point-
// align only; see CanvasItem.jsx for exactly why).

// Point-alignment candidates for ONE axis ('x' or 'y'): every OTHER
// item's own left/center/right (or top/center/bottom), each carrying its
// own cross-axis span so a guide line that matches it can be drawn only
// between the two elements actually involved (Prompt 19 visual-polish —
// a guide reads as "these two things line up," not page-wide decoration)
// — plus the page's own center (Prompt 19 item 1), which — being
// page-wide by nature, not item-to-item — is flagged `isPage` so its
// guide line spans the FULL page instead.
export function alignmentCandidates(axis, others, page) {
  const candidates = others.flatMap((o) => {
    const pos = axis === 'x' ? o.x : o.y;
    const size = axis === 'x' ? o.width : o.height;
    const crossMin = axis === 'x' ? o.y : o.x;
    const crossMax = axis === 'x' ? o.y + o.height : o.x + o.width;
    return [pos, pos + size / 2, pos + size].map((value) => ({ value, crossMin, crossMax, isPage: false, isBoundary: false }));
  });
  const pageCrossSize = axis === 'x' ? page.height : page.width;
  const pageValue = (axis === 'x' ? page.width : page.height) / 2;
  candidates.push({ value: pageValue, crossMin: 0, crossMax: pageCrossSize, isPage: true, isBoundary: false });
  return candidates;
}

// The page/footer boundary a move already flushes against (Prompt 5) —
// still a real snap TARGET (landing flush against the page edge should
// feel just as magnetic as aligning to a neighbor), but it already has
// its own dedicated indicator (the edge-glow — see clampToPage) so it's
// flagged `isBoundary` to suppress a REDUNDANT pink guide line for the
// exact same edge (acceptance criteria: the two systems must stay
// separate, never merged/confused).
export function boundaryCandidates(bounds, axis) {
  const values = axis === 'x' ? [bounds.minX, bounds.maxX] : [bounds.minY, bounds.maxY];
  return values.map((value) => ({ value, crossMin: -Infinity, crossMax: Infinity, isPage: false, isBoundary: true }));
}

// Point-alignment snap, richer than a plain delta: which CANDIDATE
// matched (needed to tell a real "no match" apart from "matched with
// exactly zero delta," which sticky hysteresis below needs to
// distinguish, and to carry the candidate's own cross-span/isPage/
// isBoundary flags through to the guide-rendering step).
export function findNearestSnap(pos, size, candidates, tolerance) {
  const points = [pos, pos + size / 2, pos + size];
  let best = null;
  let bestDist = tolerance;
  points.forEach((p) => {
    candidates.forEach((c) => {
      const d = c.value - p;
      if (Math.abs(d) <= bestDist) {
        bestDist = Math.abs(d);
        best = { delta: d, candidate: c };
      }
    });
  });
  return best;
}

// Prompt 19 item 3 — sticky snap: the tolerance to ENGAGE a snap is
// tighter than the tolerance to stay snapped once already there, so
// crossing the engage threshold once doesn't immediately un-snap on the
// very next pixel of mouse movement (this is what makes Canva/Figma-style
// snapping feel deliberate rather than twitchy). `wasSnapped` is this
// same axis's own engagement state from the PREVIOUS frame of the same
// gesture — inherently per-gesture, per-axis state a pure function can't
// hold itself, so the caller (CanvasItem) tracks it across mousemove
// frames and passes it back in each call.
// Phase 2a: was 4px/10px (page-unit == px, before this pass). Converted
// via the STRAIGHT pxToMm conversion, deliberately NOT rounded to a
// "nicer" mm number the way PAGE_PADDING/COLLISION_MARGIN were — these
// two specific values were already tuned and explicitly verified to feel
// right (Prompt 19/22's own comment: "felt identically sticky at every
// level tried" across 50/100/150% zoom), so preserving the EXACT screen-
// pixel feel they were tuned at is the correct goal here, not picking a
// cleaner-looking number that would subtly change it. See resolveAxisSnap
// (CanvasItem.jsx) for how dividing by zoom scale still keeps this a
// constant SCREEN-pixel tolerance after the mm conversion — the same
// division that did this job for the old px constant does it here too,
// unchanged in shape, because it's mm (a fixed physical unit) not being
// re-scaled by zoom, exactly like px wasn't inherently either.
export const SNAP_ENGAGE_TOLERANCE = mmFromPx(4); // -> 1.06mm
export const SNAP_RELEASE_TOLERANCE = mmFromPx(10); // -> 2.65mm
// Prompt 22: `engageTolerance`/`releaseTolerance` are optional overrides
// of the two constants above — the caller (CanvasItem's resolveAxisSnap)
// divides them by the current canvas zoom's scale factor before passing
// them in, so a fixed-feeling SCREEN-pixel tolerance (the actual UX goal)
// holds at any zoom level even though these are, underneath, page-unit
// thresholds. Left un-overridden, behavior is identical to before zoom
// existed.
export function findStickySnap(pos, size, candidates, wasSnapped, engageTolerance = SNAP_ENGAGE_TOLERANCE, releaseTolerance = SNAP_RELEASE_TOLERANCE) {
  const tolerance = wasSnapped ? releaseTolerance : engageTolerance;
  return findNearestSnap(pos, size, candidates, tolerance);
}

// Backward-compatible plain-delta snap (used where the richer match
// object isn't needed) — kept as a thin wrapper over findNearestSnap so
// the two never drift apart.
export function snapAxis(pos, size, otherEdges, tolerance = SNAP_ENGAGE_TOLERANCE) {
  const found = findNearestSnap(pos, size, otherEdges.map((value) => ({ value })), tolerance);
  return found ? found.delta : 0;
}

// The cross-axis span a guide LINE should actually be drawn across
// (Prompt 19 visual polish): the full page for a page-center match,
// otherwise only from the nearer of [dragged box, matched item] to the
// farther of the two — a line that reads as "THESE two things align,"
// never page-wide decoration for an ordinary item-to-item match.
export function guideSpan(boxCrossMin, boxCrossMax, candidate, pageCrossSize) {
  if (candidate.isPage) return [0, pageCrossSize];
  return [Math.min(boxCrossMin, candidate.crossMin), Math.max(boxCrossMax, candidate.crossMax)];
}

// How far away (mm) a neighboring item can be for its gap to still be
// worth showing as a live distance label — beyond this it's not "nearby"
// in any visually useful sense. Was 160px (42.33mm at the straight
// conversion); retuned to a clean 42mm — this is a physical "still close
// on the page" judgment call (like PAGE_PADDING), not a screen-feel
// tolerance the way SNAP_ENGAGE/RELEASE above are, so a clean round mm
// number is the right call here rather than preserving conversion noise.
const DISTANCE_LABEL_RANGE = 42;

// The plain "nearest gap on either side" reading Prompt 6/14 already
// showed — kept as the fallback for whichever axis ISN'T currently doing
// equal-spacing detection (see detectEqualSpacing below), so a lone
// neighbor still gets a live distance readout the way it always has.
// `neighbors` are {pos, size} on THIS axis, already filtered by the
// caller to whichever items share the cross-axis band.
export function nearestGap(pos, size, neighbors) {
  let before = null;
  let after = null;
  neighbors.forEach((n) => {
    if (n.pos + n.size <= pos) {
      const gap = pos - (n.pos + n.size);
      if (gap <= DISTANCE_LABEL_RANGE && (before === null || gap < before)) before = gap;
    }
    if (n.pos >= pos + size) {
      const gap = n.pos - (pos + size);
      if (gap <= DISTANCE_LABEL_RANGE && (after === null || gap < after)) after = gap;
    }
  });
  return { before, after };
}

// Prompt 19/20 item 2 — Canva-style EQUAL-SPACING detection, the
// flagship feature of this pass: given the dragged box's CANDIDATE
// position/size on one axis and the other items sharing its cross-axis
// band (already "in the same row/column" by the same overlap test
// nearestGap's caller uses), insert the dragged box into that line's
// sorted sequence and look for an established rhythm to continue —
// generalized (Prompt 20) to ANY number of in-line items, not just
// exactly 3:
//   - established rhythm: two or more STATIONARY (non-dragged) gaps
//     elsewhere in the line already mutually agree (within `tolerance`)
//     on a shared spacing value — the dominant, largest such cluster is
//     the "rhythm" a longer line of already-evenly-spaced items has
//     settled on. Whichever of the dragged item's own adjacent gap(s) is
//     closest to that rhythm gets solved to match it EXACTLY, regardless
//     of whether the dragged item ends up sandwiched between two
//     neighbors or sitting outside an existing pair.
//   - bare 3-item fallback: with fewer than 2 mutually-consistent
//     stationary gaps to establish a rhythm from (the ORIGINAL 3-item
//     scope: one single stationary gap — "continuing" it verbatim — or,
//     sandwiched between exactly two items with nothing else in the
//     line — solve the dragged item's own two gaps to match EACH OTHER,
//     the classic "center it between these two" case). Unchanged from
//     Prompt 19 — this is what keeps the original 3-item behavior a
//     strict subset of the general case, not a regression.
// `rowItems` are {pos, size} on this axis, EXCLUDING the dragged item.
// Returns null when nothing is within `tolerance` of matching; otherwise
// `{ targetPos, gaps }` — `targetPos` is the exact position (this axis
// only) that achieves equality, and `gaps` is every gap that's part of
// the matched rhythm — the established cluster's own gaps (their real,
// individual values) plus the newly-solved dragged gap (exactly
// `referenceValue`), each `{ start, end, value }` for a separate small
// marker in that ONE gap (Prompt 20 item 1), never one line spanning the
// whole group. A sandwiched item's OTHER side is included too, but only
// when it independently lands close enough to the same rhythm — never
// force-labeled "equal" when it plainly isn't.
export function detectEqualSpacing(draggedPos, draggedSize, rowItems, tolerance) {
  if (rowItems.length < 2) return null;
  const combined = rowItems
    .map((it) => ({ pos: it.pos, size: it.size, dragged: false }))
    .concat([{ pos: draggedPos, size: draggedSize, dragged: true }])
    .sort((a, b) => a.pos - b.pos);

  const gapAt = (seq, i) => ({
    value: seq[i + 1].pos - (seq[i].pos + seq[i].size),
    start: seq[i].pos + seq[i].size,
    end: seq[i + 1].pos,
    leftDragged: seq[i].dragged,
    rightDragged: seq[i + 1].dragged,
  });
  const gaps = [];
  for (let i = 0; i < combined.length - 1; i++) gaps.push(gapAt(combined, i));
  const draggedGaps = gaps.filter((g) => g.leftDragged || g.rightDragged);
  const stationaryGaps = gaps.filter((g) => !g.leftDragged && !g.rightDragged);
  if (draggedGaps.length === 0) return null;

  // The dominant established rhythm: the largest cluster of stationary
  // gaps that are all mutually within `tolerance` of one another; its
  // average is the value to continue. A cluster of exactly one (only a
  // single stationary gap exists) still counts — that's the original
  // 3-item "continuing" case, just expressed as a 1-element cluster.
  let referenceValue = null;
  let referenceCluster = [];
  if (stationaryGaps.length) {
    let bestCluster = [];
    stationaryGaps.forEach((g) => {
      const cluster = stationaryGaps.filter((h) => Math.abs(h.value - g.value) <= tolerance);
      if (cluster.length > bestCluster.length) bestCluster = cluster;
    });
    referenceCluster = bestCluster;
    referenceValue = bestCluster.reduce((sum, g) => sum + g.value, 0) / bestCluster.length;
  }

  if (referenceValue !== null) {
    let best = null;
    let bestDiff = tolerance;
    draggedGaps.forEach((dg) => {
      const diff = Math.abs(dg.value - referenceValue);
      if (diff <= bestDiff) {
        bestDiff = diff;
        best = dg;
      }
    });
    if (best) {
      const targetPos = best.rightDragged ? best.start + referenceValue : best.end - draggedSize - referenceValue;
      const bestSpan = best.rightDragged ? { start: best.start, end: targetPos } : { start: targetPos + draggedSize, end: best.end };
      // Report the ORIGINAL cluster gaps (each keeping its own real
      // value — they're already within `tolerance` of each other, but
      // not necessarily bit-identical) plus the newly-solved dragged gap
      // (forced to exactly `referenceValue`) — always >= 2 markers,
      // never force-labels a gap "equal" that isn't: a sandwiched item's
      // OTHER side is only added below when it independently qualifies.
      const resultGaps = [
        ...referenceCluster.map((g) => ({ start: g.start, end: g.end, value: g.value })),
        { ...bestSpan, value: referenceValue },
      ];
      const other = draggedGaps.find((g) => g !== best);
      if (other) {
        const otherSpan = other.rightDragged
          ? { start: other.start, end: targetPos }
          : { start: targetPos + draggedSize, end: other.end };
        const otherValue = otherSpan.end - otherSpan.start;
        if (Math.abs(otherValue - referenceValue) <= tolerance) {
          resultGaps.push({ ...otherSpan, value: otherValue });
        }
      }
      return { targetPos, gaps: resultGaps };
    }
  }

  // Bare 3-item fallback (no established rhythm to draw from): solve the
  // dragged item's own two gaps to match each other exactly.
  if (draggedGaps.length === 2) {
    const [gL, gR] = draggedGaps;
    if (Math.abs(gL.value - gR.value) <= tolerance) {
      const targetPos = (gL.start + gR.end - draggedSize) / 2;
      const targetValue = (gR.end - gL.start - draggedSize) / 2;
      return {
        targetPos,
        gaps: [
          { start: gL.start, end: targetPos, value: targetValue },
          { start: targetPos + draggedSize, end: gR.end, value: targetValue },
        ],
      };
    }
  }
  return null;
}

// ---------- Content-vs-content collision (Prompt 12) ----------
//
// Content items may never overlap. Each item claims a margin on every
// side that no OTHER item's own box may cross, so when two items are as
// close as the constraint allows, there's real empty space between their
// actual borders (margin x2, mover + neighbor). Shapes are exempt — same
// exemption as the Prompt 5 edge-padding rule, since a decorative shape
// is meant to sit flush against/behind content, not be pushed away by it.
//
// Phase 2a: was a bare 1px. Rather than convert that number in isolation
// (1px -> 0.26mm), this now REUSES production's own OVERLAP_EPSILON_MM
// (frontend/src/lib/designEditor/constants.js) = 0.3mm directly — the
// exact same tolerance the backend's own _validate_page_bounds/
// boxes_overlap checks enforce for this exact same purpose (absorbing
// mm<->px<->mm round-trip noise at a shared edge). Using a DIFFERENT
// number here would mean this editor's own live "no overlap" guarantee
// could disagree with what the backend will actually accept the instant
// this schema is wired up — the two are correct only if they match
// exactly, so this deliberately isn't an independently-chosen value.
export const COLLISION_MARGIN = 0.3;

// Phase 2a: the "close enough to the page/footer boundary to count as
// edge contact" tolerance (drives the edge-glow highlight in clampToPage/
// clampResizeToPage below, the outside-bounds check in validation.js, and
// the group-move edge highlight in CanvasItem.jsx) — was a bare 0.5px
// scattered across all three call sites. Consolidated into one shared,
// exported constant (it never was one before) and given the same 0.3mm
// value as COLLISION_MARGIN just above — both exist to absorb the exact
// same class of noise (mm<->px<->mm round-trip / sub-pixel measurement
// jitter), so they should move together rather than drift independently.
export const EDGE_CONTACT_EPSILON_MM = 0.3;

// The axis-aligned box that encloses a (possibly rotated) item — two
// rotated items can visually overlap well before their unrotated x/y/
// width/height boxes would, so collision is always tested against this,
// never the raw box. Rotation pivots around the box's own center, same
// convention resizeRotatedBox already uses.
export function rotatedBoundingBox(box) {
  const { x, y, width, height, rotation = 0 } = box;
  if (!rotation) return { minX: x, maxX: x + width, minY: y, maxY: y + height };
  const cx = x + width / 2;
  const cy = y + height / 2;
  const corners = [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ].map(([lx, ly]) => rotateVector(lx, ly, rotation));
  const xs = corners.map((c) => cx + c.x);
  const ys = corners.map((c) => cy + c.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// Precomputes every blocking neighbor's rotated bounding box, each already
// expanded by its own margin — the one-time-per-gesture setup step, so the
// per-frame resolve functions below just do plain interval math.
export function collisionBoxes(items, margin = COLLISION_MARGIN) {
  return items.map((item) => {
    const bbox = rotatedBoundingBox(item);
    return { minX: bbox.minX - margin, maxX: bbox.maxX + margin, minY: bbox.minY - margin, maxY: bbox.maxY + margin };
  });
}

// `epsilon` shrinks `a` by that much on every side before testing — used
// only for the "is this box already invalid" defensive checks below, so a
// pair of items sitting at (or a hair under) the exact collision margin —
// which a text item's live-measured effective size (Prompt 14) can
// legitimately land on, sub-pixel rendering being what it is — doesn't
// register as a violation and freeze every future gesture on it. The
// bisections that do the actual resolving stay at epsilon 0: precision
// there isn't the problem, only the binary "did the gesture start valid"
// gate is.
function boxesOverlap(a, b, epsilon = 0) {
  return (
    a.minX + epsilon < b.maxX && a.maxX - epsilon > b.minX && a.minY + epsilon < b.maxY && a.maxY - epsilon > b.minY
  );
}
const COLLISION_EPSILON = 1;

// How far this (unrotated) item's own left/right/top/bottom edge is from
// the nearest other item's (possibly rotated) bounding box in that exact
// direction — Infinity when nothing's in the way. Used to shrink a resize
// handle's fixed outward offset only when a neighbor is actually close
// enough to need it (Prompt 14's audit finding: at the Prompt 12 minimum
// 2px gap, a handle's full fixed offset visually oversat onto the
// neighbor) — everywhere else, the handle keeps its normal offset. Only
// meaningful for an unrotated item: "left/right/top/bottom" stops being a
// well-defined pair of directions once the item itself is rotated, so
// CanvasItem only calls this for rotation === 0 and falls back to the
// fixed offset otherwise.
export function edgeClearance(item, others) {
  const bbox = { minX: item.x, maxX: item.x + item.width, minY: item.y, maxY: item.y + item.height };
  let left = Infinity;
  let right = Infinity;
  let top = Infinity;
  let bottom = Infinity;
  others.forEach((o) => {
    const obb = rotatedBoundingBox(o);
    const yOverlap = bbox.minY < obb.maxY && bbox.maxY > obb.minY;
    const xOverlap = bbox.minX < obb.maxX && bbox.maxX > obb.minX;
    if (yOverlap) {
      if (obb.maxX <= bbox.minX) left = Math.min(left, bbox.minX - obb.maxX);
      if (obb.minX >= bbox.maxX) right = Math.min(right, obb.minX - bbox.maxX);
    }
    if (xOverlap) {
      if (obb.maxY <= bbox.minY) top = Math.min(top, bbox.minY - obb.maxY);
      if (obb.minY >= bbox.maxY) bottom = Math.min(bottom, obb.minY - bbox.maxY);
    }
  });
  return { left, right, top, bottom };
}

// Cascading push, one page-aligned axis at a time, in "forward" coordinate
// space: the advancing edge starts at `startFront` (a position this same
// edge already validly occupied) and wants to reach `desiredFront`
// (`desiredFront > startFront` — callers of `cascadeEdge` below negate
// coordinates for the decreasing-direction case so this never has to know
// which real axis/sign it's working in). `chain` is every candidate
// neighbor that could be in the way, as `{ id, near, far, locked }` in
// that same forward space (near < far), restricted by the caller to
// whichever ones share the relevant cross-axis band. `boundary` is the
// genuinely immovable cap in this space (a page/footer edge). `gap` is
// the real minimum separation to maintain between raw (unexpanded) boxes
// (2 * COLLISION_MARGIN — 1px claimed by each side).
//
// Single left-to-right sweep: everything from `startFront` on is already
// non-overlapping (the gesture's own invariant), so once a candidate
// clears (its near edge is `gap` or more ahead of the current occupied
// front), everything further along the sorted chain clears too — nothing
// to backtrack. A locked item can't move, so the sweep stops dead there;
// otherwise the candidate gets pushed to sit exactly `gap` ahead of
// whatever's already occupying the front, and the front advances to its
// far edge for the next link. If the fully-pushed chain would overshoot
// the wall it eventually hits (locked item or boundary), every push
// (mover included) is reduced by the same overshoot — a uniform backward
// slide of the whole rigid chain, which — because the ORIGINAL, pre-
// gesture arrangement was already non-overlapping — can never push
// anything to less than zero (see the proof in the prompt 16 notes: the
// pre-gesture gap between any two chain links, summed along the chain,
// already covers exactly this compression).
export function cascadePush1D(startFront, desiredFront, chain, boundary, gap) {
  const shifts = new Map();
  if (desiredFront <= startFront) return { front: desiredFront, shifts };
  const sorted = chain.filter((it) => it.near >= startFront).sort((a, b) => a.near - b.near);
  let cursor = desiredFront;
  let jammedAt = null;
  for (const it of sorted) {
    if (it.near >= cursor + gap) break; // sorted ascending — nothing further is in the way either
    if (it.locked) {
      jammedAt = it.near - gap;
      break;
    }
    const size = it.far - it.near;
    shifts.set(it.id, cursor + gap - it.near);
    cursor = cursor + gap + size;
  }
  const wallLimit = jammedAt !== null ? jammedAt : boundary;
  if (cursor > wallLimit) {
    const overshoot = cursor - wallLimit;
    for (const [id, amt] of shifts) shifts.set(id, amt - overshoot);
    return { front: desiredFront - overshoot, shifts };
  }
  return { front: desiredFront, shifts };
}

// Wraps cascadePush1D for one real page-aligned axis ('x' or 'y') and
// direction (`dir` = +1/-1, whichever way the advancing edge is
// traveling) — converts real coordinates to/from the forward space
// cascadePush1D expects (a plain identity for dir>0, negated for dir<0,
// same mirror trick used throughout), and filters `neighbors` (plain
// {id,x,y,width,height,rotation,locked} content items) down to whichever
// ones actually share the perpendicular band the moving edge is sweeping
// through. Returns `{ edge, pushed }`: the edge's actual final real
// coordinate, and a Map<id, delta> of by how much (signed, this axis
// only) each neighbor must translate.
function cascadeEdge(axis, dir, startEdge, desiredEdge, crossMin, crossMax, neighbors, boundaryEdge, gap) {
  const chain = [];
  neighbors.forEach((n) => {
    const nb = rotatedBoundingBox(n);
    const nCrossMin = axis === 'x' ? nb.minY : nb.minX;
    const nCrossMax = axis === 'x' ? nb.maxY : nb.maxX;
    if (crossMin >= nCrossMax || crossMax <= nCrossMin) return; // not in the moving edge's path
    const rawNear = axis === 'x' ? nb.minX : nb.minY;
    const rawFar = axis === 'x' ? nb.maxX : nb.maxY;
    chain.push(
      dir > 0
        ? { id: n.id, near: rawNear, far: rawFar, locked: !!n.locked }
        : { id: n.id, near: -rawFar, far: -rawNear, locked: !!n.locked }
    );
  });
  const startFront = dir > 0 ? startEdge : -startEdge;
  const desiredFront = dir > 0 ? desiredEdge : -desiredEdge;
  const boundary = dir > 0 ? boundaryEdge : -boundaryEdge;
  const { front, shifts } = cascadePush1D(startFront, desiredFront, chain, boundary, gap);
  const edge = dir > 0 ? front : -front;
  const pushed = new Map();
  shifts.forEach((amt, id) => pushed.set(id, amt * dir));
  return { edge, pushed };
}

// Per-axis cascading-push resolution for a MOVE: X is resolved first
// (using the last valid Y as the reference row), then Y is resolved using
// the just-resolved X as the reference column — same sequential "slide
// along the wall" order the old hard-stop version used, just letting each
// axis push a chain of neighbors (see cascadePush1D) instead of freezing
// at first contact. `lastValid` must be a position this same item was
// already legally at (no overlap) — the gesture's gradually-updated
// last-good frame, not the drag's original start, so movement stays
// continuous. `neighbors` are plain content items (not pre-expanded
// boxes — the cascade needs each one's own id/locked flag to know who it
// can push and by how much). `bounds` is this item's own page/footer
// envelope (see getItemBounds) — the chain's outermost, genuinely
// immovable limit when nothing locked stops it first.
export function resolveMoveCollision(lastValid, desired, size, rotation, neighbors, bounds, margin = COLLISION_MARGIN) {
  if (!neighbors.length) return { x: desired.x, y: desired.y, pushed: new Map() };
  // Local (pre-translation) bbox offsets — rotation/size don't change
  // during a move, so this is the same shape at every (x, y), just shifted.
  const local = rotatedBoundingBox({ x: 0, y: 0, width: size.width, height: size.height, rotation });
  const gap = margin * 2;
  const pushedX = new Map();
  const pushedY = new Map();

  let x = desired.x;
  if (desired.x !== lastValid.x) {
    const dir = desired.x > lastValid.x ? 1 : -1;
    const rowMinY = lastValid.y + local.minY;
    const rowMaxY = lastValid.y + local.maxY;
    const startEdge = dir > 0 ? lastValid.x + local.maxX : lastValid.x + local.minX;
    const desiredEdge = dir > 0 ? desired.x + local.maxX : desired.x + local.minX;
    const boundaryEdge = dir > 0 ? bounds.maxX : bounds.minX;
    const { edge, pushed } = cascadeEdge('x', dir, startEdge, desiredEdge, rowMinY, rowMaxY, neighbors, boundaryEdge, gap);
    x = dir > 0 ? edge - local.maxX : edge - local.minX;
    pushed.forEach((v, id) => pushedX.set(id, v));
  }

  let y = desired.y;
  if (desired.y !== lastValid.y) {
    const dir = desired.y > lastValid.y ? 1 : -1;
    const colMinX = x + local.minX;
    const colMaxX = x + local.maxX;
    const shiftedNeighbors = neighbors.map((n) => (pushedX.has(n.id) ? { ...n, x: n.x + pushedX.get(n.id) } : n));
    const startEdge = dir > 0 ? lastValid.y + local.maxY : lastValid.y + local.minY;
    const desiredEdge = dir > 0 ? desired.y + local.maxY : desired.y + local.minY;
    const boundaryEdge = dir > 0 ? bounds.maxY : bounds.minY;
    const { edge, pushed } = cascadeEdge('y', dir, startEdge, desiredEdge, colMinX, colMaxX, shiftedNeighbors, boundaryEdge, gap);
    y = dir > 0 ? edge - local.maxY : edge - local.minY;
    pushed.forEach((v, id) => pushedY.set(id, v));
  }

  const pushed = new Map();
  neighbors.forEach((n) => {
    const dx = pushedX.get(n.id) || 0;
    const dy = pushedY.get(n.id) || 0;
    if (dx || dy) pushed.set(n.id, { x: n.x + dx, y: n.y + dy });
  });
  return { x, y, pushed };
}

// Hard-stop fallback for a ROTATED resize's growing edge: cascading push
// assumes an advancing edge sweeps a page-aligned band, which no longer
// holds once growth happens along a rotated local axis (widening a
// rotated box moves BOTH its AABB's X and Y extents at once) — so a
// rotated item keeps the original bisection-to-first-contact behavior
// instead (same "opposite edge stays fixed" contract, just capped rather
// than cascaded). `box` is the frame's current (possibly X-already-
// resolved) working box.
function hardStopResizeAxis(axis, startBox, box, neighbors, margin) {
  const neighborBoxes = collisionBoxes(neighbors, margin);
  const collides = (b, epsilon = 0) => {
    const bbox = rotatedBoundingBox(b);
    const expanded = { minX: bbox.minX - margin, maxX: bbox.maxX + margin, minY: bbox.minY - margin, maxY: bbox.maxY + margin };
    return neighborBoxes.some((n) => boxesOverlap(expanded, n, epsilon));
  };
  const testAt = (t) =>
    axis === 'x'
      ? {
          x: startBox.x + (box.x - startBox.x) * t,
          y: startBox.y,
          width: startBox.width + (box.width - startBox.width) * t,
          height: startBox.height,
          rotation: box.rotation,
        }
      : {
          x: box.x,
          y: startBox.y + (box.y - startBox.y) * t,
          width: box.width,
          height: startBox.height + (box.height - startBox.height) * t,
          rotation: box.rotation,
        };
  const start = axis === 'x' ? { x: startBox.x, width: startBox.width } : { y: startBox.y, height: startBox.height };
  const end = axis === 'x' ? { x: box.x, width: box.width } : { y: box.y, height: box.height };
  if (collides(testAt(0), COLLISION_EPSILON)) return start;
  if (!collides(testAt(1))) return end;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    if (collides(testAt(t))) hi = t;
    else lo = t;
  }
  const r = testAt(lo);
  return axis === 'x' ? { x: r.x, width: r.width } : { y: r.y, height: r.height };
}

// Per-axis cascading-push resolution for a RESIZE. `handle` matters here,
// not just the two boxes: a corner handle changes width AND height from
// ONE mouse position, but the two are independent degrees of freedom — a
// neighbor that only blocks the growing HEIGHT must not also freeze
// WIDTH, which has nothing to do with it. Each axis the handle actually
// touches (skipped entirely when `handle.fx`/`fy` is 0.5 — that axis
// doesn't move for this handle) advances its growing edge from `startBox`
// (the gesture's fixed, guaranteed-valid starting box) towards
// `candidateBox` (this frame's fully snapped/boundary-clamped target),
// X first using the start height as the reference row, then Y using the
// just-resolved width as the reference column — the same order
// resolveMoveCollision uses. The opposite (non-growing) edge never moves,
// so it never needs to push anything. Only meaningful for an UNROTATED
// item — see hardStopResizeAxis for the rotated fallback.
export function resolveResizeCollision(startBox, candidateBox, handle, neighbors, bounds, margin = COLLISION_MARGIN) {
  const rotation = candidateBox.rotation || 0;
  if (!neighbors.length) return { x: candidateBox.x, y: candidateBox.y, width: candidateBox.width, height: candidateBox.height, rotation, pushed: new Map() };
  const gap = margin * 2;
  let x = candidateBox.x;
  let y = candidateBox.y;
  let width = candidateBox.width;
  let height = candidateBox.height;
  const pushedX = new Map();
  const pushedY = new Map();

  if (handle.fx !== 0.5) {
    if (rotation === 0) {
      const dir = handle.fx === 1 ? 1 : -1;
      const fixedX = dir > 0 ? candidateBox.x : candidateBox.x + candidateBox.width;
      const rowMinY = startBox.y;
      const rowMaxY = startBox.y + startBox.height;
      const startEdge = dir > 0 ? startBox.x + startBox.width : startBox.x;
      const desiredEdge = dir > 0 ? candidateBox.x + candidateBox.width : candidateBox.x;
      const boundaryEdge = dir > 0 ? bounds.maxX : bounds.minX;
      const { edge, pushed } = cascadeEdge('x', dir, startEdge, desiredEdge, rowMinY, rowMaxY, neighbors, boundaryEdge, gap);
      if (dir > 0) {
        x = fixedX;
        width = Math.max(MIN_ITEM_SIZE_MM, edge - fixedX);
      } else {
        x = edge;
        width = Math.max(MIN_ITEM_SIZE_MM, fixedX - edge);
      }
      pushed.forEach((v, id) => pushedX.set(id, v));
    } else {
      const r = hardStopResizeAxis('x', startBox, { x, y, width, height, rotation }, neighbors, margin);
      x = r.x;
      width = r.width;
    }
  }

  if (handle.fy !== 0.5) {
    if (rotation === 0) {
      const dir = handle.fy === 1 ? 1 : -1;
      const fixedY = dir > 0 ? candidateBox.y : candidateBox.y + candidateBox.height;
      const shiftedNeighbors = neighbors.map((n) => (pushedX.has(n.id) ? { ...n, x: n.x + pushedX.get(n.id) } : n));
      const colMinX = x;
      const colMaxX = x + width;
      const startEdge = dir > 0 ? startBox.y + startBox.height : startBox.y;
      const desiredEdge = dir > 0 ? candidateBox.y + candidateBox.height : candidateBox.y;
      const boundaryEdge = dir > 0 ? bounds.maxY : bounds.minY;
      const { edge, pushed } = cascadeEdge('y', dir, startEdge, desiredEdge, colMinX, colMaxX, shiftedNeighbors, boundaryEdge, gap);
      if (dir > 0) {
        y = fixedY;
        height = Math.max(MIN_ITEM_SIZE_MM, edge - fixedY);
      } else {
        y = edge;
        height = Math.max(MIN_ITEM_SIZE_MM, fixedY - edge);
      }
      pushed.forEach((v, id) => pushedY.set(id, v));
    } else {
      const r = hardStopResizeAxis('y', startBox, { x, y, width, height, rotation }, neighbors, margin);
      y = r.y;
      height = r.height;
    }
  }

  const pushed = new Map();
  neighbors.forEach((n) => {
    const dx = pushedX.get(n.id) || 0;
    const dy = pushedY.get(n.id) || 0;
    if (dx || dy) pushed.set(n.id, { x: n.x + dx, y: n.y + dy });
  });
  return { x, y, width, height, rotation, pushed };
}

// Hard boundary constraint for a MOVE: clamp a box's position so it never
// leaves `bounds` (see getItemBounds — [0,page.width] for a shape,
// [PAGE_PADDING, page.width-PAGE_PADDING] for a content item, same on Y),
// while still allowing it to sit exactly flush against whichever boundary
// applies to this item. Also reports which edges the (clamped) box is now
// touching, so the caller can drive an edge-contact highlight. Width/height
// don't change here — a move only ever slides x/y.
export function clampToPage(box, bounds) {
  const width = Math.min(box.width, bounds.maxX - bounds.minX);
  const height = Math.min(box.height, bounds.maxY - bounds.minY);
  const x = Math.max(bounds.minX, Math.min(box.x, bounds.maxX - width));
  const y = Math.max(bounds.minY, Math.min(box.y, bounds.maxY - height));
  return {
    x,
    y,
    width,
    height,
    edges: {
      left: x <= bounds.minX + EDGE_CONTACT_EPSILON_MM,
      right: x + width >= bounds.maxX - EDGE_CONTACT_EPSILON_MM,
      top: y <= bounds.minY + EDGE_CONTACT_EPSILON_MM,
      bottom: y + height >= bounds.maxY - EDGE_CONTACT_EPSILON_MM,
    },
  };
}

// Prompt 27 item 3: how far past its own true pixel resolution an image
// can be stretched before it's likely to look visibly soft/pixelated —
// checked per axis (a non-uniform resize can over-stretch just one
// dimension) against `item.sourceWidth/Height` (captured once at upload,
// never touched again — see EditorContext's addImageItem). Lives here
// (not in CanvasItem.jsx, its original home) so both CanvasItem's live
// per-item badge and validation.js's save-time check can import it
// without CanvasItem's own EditorContext dependency creating a cycle.
export const PIXELATION_THRESHOLD = 1.5;
// Phase 2a: `width`/`height` are now the item's RENDERED size in mm, but
// `item.sourceWidth/Height` (the image's true decoded pixel dimensions —
// see addImageItem in EditorContext.jsx) are, and always were, raw raster
// pixels — a unit that has nothing to do with the page's own mm geometry.
// Before this pass the two happened to share a unit (both px) purely
// because the page itself was px-denominated; now that it isn't, the
// rendered size has to be converted back to an equivalent PIXEL size
// (via the same 96/25.4 CSS reference-pixel ratio the rest of this app's
// mm<->px boundary uses) before comparing it against the source image's
// own real pixel count — comparing mm directly against raw px would have
// made this warning fire on nearly every image, at any size.
export function isImagePixelated(item, width, height) {
  if (!item.sourceWidth || !item.sourceHeight) return false;
  const widthPx = mmToPx(width);
  const heightPx = mmToPx(height);
  return widthPx / item.sourceWidth > PIXELATION_THRESHOLD || heightPx / item.sourceHeight > PIXELATION_THRESHOLD;
}

// Hard boundary constraint for a RESIZE, against the same kind-aware
// `bounds`. Unlike a move, a resize has a FIXED edge (whichever one the
// dragged handle isn't on — see resizeRotatedBox) that must never shift;
// only the growing edge's extent gets capped at the boundary. Using the
// position-only clampToPage here would incorrectly slide the fixed edge
// inward instead, breaking the "opposite corner/edge stays put" contract
// of a resize gesture.
export function clampResizeToPage(box, handle, bounds, minSize = MIN_ITEM_SIZE_MM) {
  let { x, y, width, height } = box;

  if (handle.fx === 1) {
    if (x < bounds.minX) { width += x - bounds.minX; x = bounds.minX; }
    width = Math.max(minSize, Math.min(width, bounds.maxX - x));
  } else if (handle.fx === 0) {
    const right = x + width;
    x = Math.max(bounds.minX, x);
    width = Math.max(minSize, right - x);
  }

  if (handle.fy === 1) {
    if (y < bounds.minY) { height += y - bounds.minY; y = bounds.minY; }
    height = Math.max(minSize, Math.min(height, bounds.maxY - y));
  } else if (handle.fy === 0) {
    const bottom = y + height;
    y = Math.max(bounds.minY, y);
    height = Math.max(minSize, bottom - y);
  }

  return {
    x,
    y,
    width,
    height,
    edges: {
      left: x <= bounds.minX + EDGE_CONTACT_EPSILON_MM,
      right: x + width >= bounds.maxX - EDGE_CONTACT_EPSILON_MM,
      top: y <= bounds.minY + EDGE_CONTACT_EPSILON_MM,
      bottom: y + height >= bounds.maxY - EDGE_CONTACT_EPSILON_MM,
    },
  };
}
