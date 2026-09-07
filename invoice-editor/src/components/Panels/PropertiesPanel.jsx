import React, { useState } from 'react';
import { useEditor } from '../../state/EditorContext';
import { ELEMENT_TYPES } from '../../data/elementCatalog';
import { getItemBounds, getFooterTop, resolveMoveCollision } from '../../utils/geometry';
import { FONT_FAMILIES, FONT_WEIGHT_LABELS, fontFamilyById } from '../../data/fonts';
import { isLinked, resolveColorValue, resolveFontValue } from '../../utils/theme';
import { CheckIcon, ErrorIcon, WarningIcon } from '../Icons';
import { pxToMm } from '../../utils/units';
import { BINDING_OPTIONS, bindingLabel } from '../../data/bindings';

// Phase 2a: every geometric field in this panel is now mm (position/
// size/border-width/corner-radius/cell-padding — the whole "mm family",
// see utils/units.js's header comment) or pt (font size, the one
// production expresses differently — see design_renderer.py's
// font_size_pt). Displayed to 2 decimal places — matches design_schema.py/
// constants.js's own stored precision convention exactly — while the
// full-precision value stays in template state; this only rounds what's
// SHOWN, never what's committed (typing a new value always commits that
// exact typed number, full precision, same as before this pass).
const round2 = (v) => Math.round((v || 0) * 100) / 100;

// Variants whose text is split into independently-styleable parts (see
// item[part] in CanvasItem.jsx) — kept in sync with CanvasItem:
//   block/qr:     'title' + per-line keys ('body' for qr's image half)
//   label-value:  'label' + 'value' (Due Date / Issue Date)
const SUB_PART_VARIANTS = new Set(['block', 'qr', 'label-value']);

// Prompt 30 item 4: a bulk multi-select style change must reach every
// selected item's ACTUAL rendered text, not just its top-level fields.
// For a SUB_PART_VARIANT (block/qr/label-value), the item's own
// top-level textColor/fontFamily/fontWeight/fontSize are never read at
// all — ContentBody renders those variants entirely through item[part]
// instead (see partInlineStyle in CanvasItem.jsx) — so a bulk write to
// only the top-level field had no visible effect on them, even though it
// worked correctly for flat variants (Business Name, Invoice Number,
// ...). This routes the exact same patch into every text-bearing part
// instead, for exactly those variants; every other variant keeps writing
// the top-level field, same as before. Used for the Typography section's
// Text color and Font controls only — Fill/Border/Radius are already
// whole-item/frame-level fields for every variant (frameStyle reads them
// uniformly), so those never needed this.
function bulkTextStylePatch(item, patch) {
  const def = ELEMENT_TYPES[item.type];
  const variant = def?.variant;
  if (variant === 'block') {
    const result = { title: { ...(item.title || {}), ...patch } };
    def.render().lines.forEach((line) => {
      result[line.key] = { ...(item[line.key] || {}), ...patch };
    });
    return result;
  }
  if (variant === 'qr') {
    // qr's "body" half is the QR graphic itself, not text — only its
    // title takes a text-style patch.
    return { title: { ...(item.title || {}), ...patch } };
  }
  if (variant === 'label-value') {
    return {
      label: { ...(item.label || {}), ...patch },
      value: { ...(item.value || {}), ...patch },
    };
  }
  return patch;
}

// Variants where "how content sits inside its own box" is a meaningful,
// independent choice — distinct from the page-alignment buttons below,
// which move the box itself. `table` cells have their own per-column
// left/right rule, so it's left out entirely; a `spread` label-value item
// (Subtotal etc.) already spreads label/value with `justify-content:
// space-between`, so it only loses the HORIZONTAL control (see showHAlign
// below) — vertical position doesn't fight the spread, so it keeps that
// one.
//
// Prompt 24 item 4 (audit follow-through): `qr` is intentionally in the
// HORIZONTAL set only, not the vertical one — its title text genuinely
// respects `contentAlign` now (see CanvasItem's qr case), but vertical
// position for `qr` (and `table`/`divider`/`image`) is governed by the
// natural-size + scale-transform rendering path, not the flex/justify-
// content mechanism TEXT_VARIANTS use — adding it to the vertical set
// without also moving `qr` into TEXT_VARIANTS (a much bigger rendering
// change, out of scope here) would just be a second dead control, the
// exact class of bug this pass is fixing elsewhere.
const H_ALIGNABLE_VARIANTS = new Set(['text', 'note', 'block', 'label-value', 'qr']);
const V_ALIGNABLE_VARIANTS = new Set(['text', 'note', 'block', 'label-value']);

// Prompt 24 item 4: widened from `variant === 'block'` only — the
// underlying per-part `contentAlign` field (CanvasItem's partInlineStyle)
// was already read generically for every part regardless of variant, so
// `qr`'s title and label-value's label/value spans support it exactly as
// well as block's title/lines already did; only the PROPERTIES PANEL gate
// was artificially narrower than what the rendering already supported.
// `qr`'s "body" part is the exception WITHIN that widening: it's an SVG
// QR graphic, not a text run — its own case in CanvasItem.jsx computes a
// `contentAlign`-derived style but only ever applies the background/
// border pieces of it to `.item__qr-wrap`, never `textAlign`. Exposing
// Align there would just be a second dead control (the exact bug class
// item 4 elsewhere in this pass removes), so qr's own title is singled
// out instead of blanket-including the whole variant.
function isPartAlignable(def, part) {
  if (def.variant === 'block' || def.variant === 'label-value') return true;
  if (def.variant === 'qr') return part === 'title';
  return false;
}

const H_ALIGN_OPTIONS = [['left', 'Left'], ['center', 'Center'], ['right', 'Right']];
const V_ALIGN_OPTIONS = [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];
const LOGO_SHAPE_OPTIONS = [['square', 'Square'], ['rounded', 'Rounded'], ['circle', 'Circle']];

// ---------- Shared field widgets ----------
// Every item-type panel below is built from the same small set of row
// widgets, assembled in the same category order (Prompt 23 item 9):
// Position/Size/Rotation, Fill/Border/Radius, Typography, Alignment
// (content + page), then whatever's type-specific, last.

// Prompt 23 item 7: every slider pairs with an exact-value numeric input —
// dragging the slider updates the number, typing the number updates the
// slider, both drive the same `onChange`. Used everywhere a px-valued
// slider exists (border width, corner radius, cell padding, ...); NOT used
// for rotation (degrees, not px — out of this control's scope).
// Prompt 33 item 2: dragging the range thumb must produce exactly ONE undo
// step per gesture, same rule move/resize/rotate/column-divider already
// follow (see CanvasItem.jsx) — local `dragValue` preview state while the
// thumb moves, a single `onChange` (the real commit) on release. The
// paired number input isn't a drag gesture, so it keeps committing
// immediately.
function SliderRow({ label, min, max, step = 1, value, onChange }) {
  const [dragValue, setDragValue] = useState(null);
  const displayValue = dragValue !== null ? dragValue : value;

  const previewRange = (e) => {
    const v = Number(e.target.value);
    if (!Number.isNaN(v)) setDragValue(v);
  };
  // Prompt 34 item 1: a gesture that ENDS on the value it started at must
  // not write history at all. Committing unconditionally on every release
  // stacked identical snapshots — a click that never moved the thumb, a
  // drag that wandered back to its starting value, and (worst) any keyup
  // at all while the slider still held focus, including the `keyup` half
  // of the very Ctrl+Z the user was pressing to undo. Each one added an
  // Undo step that visibly does nothing, which is what made a single drag
  // look like it needed 8-10 presses to unwind.
  const commitIfChanged = (v) => {
    if (!Number.isNaN(v) && v !== Number(value)) onChange(v);
  };
  const commitRange = (e) => {
    setDragValue(null);
    commitIfChanged(Number(e.target.value));
  };
  const handleNumber = (e) => commitIfChanged(Number(e.target.value));
  return (
    <div className="prop-row">
      <label>{label}</label>
      <div className="slider-with-input">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          onChange={previewRange}
          onMouseUp={commitRange}
          onTouchEnd={commitRange}
          onKeyUp={commitRange}
        />
        <input type="number" min={min} max={max} step={step} value={value} onChange={handleNumber} />
      </div>
    </div>
  );
}

// Prompt 28: the "linked vs custom" selector shared by every control that
// supports theme-linking — a small, consistent pattern rather than a
// bespoke toggle per property (colors get Primary/Secondary/Custom, fonts
// get Heading/Body/Custom, same select+swatch/fields shape either way).
const COLOR_LINK_OPTIONS = [['primary', 'Primary'], ['secondary', 'Secondary'], ['custom', 'Custom']];
const FONT_LINK_OPTIONS = [['heading', 'Heading font'], ['body', 'Body font'], ['custom', 'Custom']];

// A color control that can be linked to the theme's primary/secondary
// slot instead of holding its own literal value. `value` is the RAW
// stored field (a literal string, undefined, or a `{linked}` sentinel —
// see utils/theme.js); `theme` resolves it for display. The swatch is
// disabled while linked — nudging a linked value isn't a local edit, it's
// either "change the theme" (Theme panel) or "detach to custom" (the
// select) — never both at once from the same control.
function LinkableColorRow({ label, value, onChange, theme, fallback = '#faf9f6' }) {
  const linked = isLinked(value) ? value.linked : null;
  // `<input type="color">` can't display 'transparent' at all (some
  // shapes' literal default) — shown as black instead, same as before
  // this control existed.
  let resolved = resolveColorValue(value, theme) || fallback;
  if (resolved === 'transparent') resolved = '#000000';
  return (
    <div className="prop-row">
      <label>{label}</label>
      <div className="linked-control">
        <select
          className="linked-control__select"
          value={linked || 'custom'}
          onChange={(e) => {
            const v = e.target.value;
            // Detach at the currently-resolved appearance (not a jarring
            // reset to some unrelated hardcoded default) when going custom.
            onChange(v === 'custom' ? resolved : { linked: v });
          }}
        >
          {COLOR_LINK_OPTIONS.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
        </select>
        <input type="color" value={resolved} disabled={!!linked} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

// Font-family + font-weight + font-size controls, shared by whole-item and
// per-part property panels alike. `style` is whatever flat style object (an
// item, or an item[part]) already holds textColor/bgColor/etc; `onChange`
// gets just the font patch to merge in the same way those other controls
// do. `defaultSize` is that variant/part's own baked-in CSS size (see the
// matching fallback passed to fontStyle()/partInlineStyle() in
// CanvasItem.jsx) — shown until the user picks an explicit override.
//
// Prompt 28: family+weight now travel as ONE linkable pair — `theme`
// resolves the pair for display (and for what "Custom" detaches AT, so
// switching away from a link never jars to an unrelated default); the
// Family/Weight selects only appear at all once the pair is custom, since
// while linked, both fields come entirely from the theme (see
// resolveFontValue) and the item's own fontWeight is irrelevant/ignored.
function FontControls({ style, onChange, defaultSize, theme }) {
  const linked = isLinked(style.fontFamily) ? style.fontFamily.linked : null;
  const resolvedFont = resolveFontValue(style.fontFamily, style.fontWeight, theme);
  const currentFamily = fontFamilyById(resolvedFont.fontFamily);
  const weights = currentFamily.weights;
  const currentWeight = resolvedFont.fontWeight && weights.includes(resolvedFont.fontWeight) ? resolvedFont.fontWeight : weights[0];

  return (
    <>
      <div className="prop-row">
        <label>Font</label>
        <select
          value={linked || 'custom'}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'custom') {
              onChange({ fontFamily: currentFamily.id, fontWeight: currentWeight });
            } else {
              onChange({ fontFamily: { linked: v }, fontWeight: undefined });
            }
          }}
        >
          {FONT_LINK_OPTIONS.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
        </select>
      </div>
      {!linked && (
        <>
          <div className="prop-row">
            <label>Family</label>
            <select
              value={currentFamily.id}
              onChange={(e) => {
                const next = FONT_FAMILIES.find((f) => f.id === e.target.value);
                onChange({ fontFamily: next.id, fontWeight: next.weights[0] });
              }}
            >
              {FONT_FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div className="prop-row">
            <label>Weight</label>
            <select value={currentWeight} onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}>
              {weights.map((w) => <option key={w} value={w}>{FONT_WEIGHT_LABELS[w]}</option>)}
            </select>
          </div>
        </>
      )}
      <div className="prop-row">
        <label>Size (pt)</label>
        <input
          type="number"
          min="4.5"
          max="54"
          step="0.5"
          value={round2(style.fontSize || defaultSize)}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
        />
      </div>
    </>
  );
}

// Left/center/right (horizontal, text-align/justify-content) or top/
// middle/bottom (vertical, Prompt 13 — the outer `.item__scale` flex
// wrapper's justify-content, since text no longer scales to fill its box)
// — how content sits inside its own box, applied to the WHOLE item (not
// per-part; block's per-line horizontal override, when wanted, is set
// from PartProperties instead — vertical has no per-part equivalent,
// block's lines move together as one group).
function ContentAlignControl({ label, options, value, defaultValue, onChange }) {
  return (
    <div className="prop-row">
      <label>{label}</label>
      <div className="align-grid" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map(([v, text]) => (
          <button
            key={v}
            className="tbtn"
            style={{ fontWeight: (value || defaultValue) === v ? 700 : 400 }}
            onClick={() => onChange(v)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

// Repositions an item against the PAGE's own width/height — never relative
// to other items — respecting the same kind-aware boundary each item
// already can't cross (getItemBounds: true edge for a shape, PAGE_PADDING
// inset for content). Content items route through the exact same
// cascading-push resolution a drag uses (resolveMoveCollision): aligning
// pushes whatever is in the way rather than landing on top of it. Shapes
// stay exempt, same as everywhere else collision applies.
function PageAlignButtons({ item }) {
  const { template, updateItem, updateItems, effectiveSizes } = useEditor();
  const bounds = getItemBounds(item, template.page, getFooterTop(template.items, template.page));

  const moveTo = (x, y) => {
    if (item.kind !== 'content') {
      updateItem(item.id, { x, y });
      return;
    }
    const withEffectiveSize = (o) => {
      const eff = effectiveSizes[o.id];
      return eff ? { ...o, width: eff.width, height: eff.height } : o;
    };
    const neighbors = template.items
      .filter((i) => i.id !== item.id && i.kind === 'content' && !i.hidden)
      .map(withEffectiveSize);
    const resolved = resolveMoveCollision(
      { x: item.x, y: item.y },
      { x, y },
      { width: item.width, height: item.height },
      item.rotation || 0,
      neighbors,
      bounds
    );
    if (resolved.pushed.size > 0) {
      const ids = [item.id, ...resolved.pushed.keys()];
      updateItems(ids, (i) => (i.id === item.id ? { x: resolved.x, y: resolved.y } : resolved.pushed.get(i.id)));
    } else {
      updateItem(item.id, { x: resolved.x, y: resolved.y });
    }
  };

  const alignX = (mode) => {
    const x =
      mode === 'left' ? bounds.minX : mode === 'right' ? bounds.maxX - item.width : (bounds.minX + bounds.maxX - item.width) / 2;
    moveTo(x, item.y);
  };
  const alignY = (mode) => {
    const y =
      mode === 'top' ? bounds.minY : mode === 'bottom' ? bounds.maxY - item.height : (bounds.minY + bounds.maxY - item.height) / 2;
    moveTo(item.x, y);
  };

  return (
    <div className="align-grid">
      <button className="tbtn" onClick={() => alignX('left')}>Left</button>
      <button className="tbtn" onClick={() => alignX('center')}>Center</button>
      <button className="tbtn" onClick={() => alignX('right')}>Right</button>
      <button className="tbtn" onClick={() => alignY('top')}>Top</button>
      <button className="tbtn" onClick={() => alignY('middle')}>Middle</button>
      <button className="tbtn" onClick={() => alignY('bottom')}>Bottom</button>
    </div>
  );
}

// Prompt 23 item 9: one shared "Alignment" section — content alignment
// (how content sits inside its own box) followed by page alignment (where
// the box itself sits on the page), in that order, under a single title —
// applies uniformly to content items, shape items, and (via its own
// smaller call below) a selected sub-part's whole container.
function AlignmentSection({ hAlign, vAlign, pageAlignItem }) {
  if (!hAlign && !vAlign && !pageAlignItem) return null;
  return (
    <>
      <div className="panel__section-title">Alignment</div>
      {hAlign}
      {vAlign}
      {pageAlignItem && <PageAlignButtons item={pageAlignItem} />}
    </>
  );
}

// Which label to show for a sub-part in its own panel. Whether it's
// individually deletable is no longer decided here (Prompt 25) — it's
// asked directly of EditorContext's `canDeleteBlockLine`, the exact same
// guard `deleteBlockLine` itself uses, so this panel's "Delete this line"
// button can never drift out of sync with what actually happens when it's
// clicked.
function partLabel(def, part) {
  if (part === 'title') return 'Title';
  if (def.variant === 'block') {
    const line = def.render().lines.find((l) => l.key === part);
    return line?.label || 'Body';
  }
  if (def.variant === 'label-value') {
    return part === 'label' ? 'Label' : 'Value';
  }
  return 'Body'; // qr's image half
}

// Part-level font-size fallback (pt): label-value's two spans share its
// container size (8.25pt for a `strong` item like Total due, 7.5pt
// otherwise), title uses the block-title 6pt default, everything else is
// a block body line at 6.75pt — mirrors the fallbacks CanvasItem.jsx's
// ContentBody passes to partInlineStyle() for the same parts EXACTLY
// (Phase 2a converted both files' numbers by the same px->pt factor,
// 0.75, so they'd stay in sync rather than drift independently).
function partDefaultFontSize(def, part) {
  if (def.variant === 'label-value') return def.strong ? 8.25 : 7.5;
  if (part === 'title') return 6;
  return 6.75;
}

function PartProperties({ item, part, pageAlignItem }) {
  const { template, updateItemPart, deleteBlockLine, canDeleteBlockLine } = useEditor();
  const theme = template.theme;
  const def = ELEMENT_TYPES[item.type];
  const label = partLabel(def, part);
  const deletable = canDeleteBlockLine(item.id, part);
  const partStyle = item[part] || {};
  const defaultColor = part === 'title' ? '#a2896b' : '#55524a';

  return (
    <>
      <div className="panel__section-title">
        {def.label} — {label}
      </div>

      <div className="panel__section-title">Fill &amp; border</div>
      <LinkableColorRow label="Background" theme={theme} value={partStyle.bgColor} onChange={(v) => updateItemPart(item.id, part, { bgColor: v })} />
      <LinkableColorRow label="Border color" theme={theme} value={partStyle.borderColor} onChange={(v) => updateItemPart(item.id, part, { borderColor: v })} fallback="#262420" />
      <SliderRow label="Border width (mm)" min={0} max={1.6} step={0.1} value={partStyle.borderWidth || 0} onChange={(v) => updateItemPart(item.id, part, { borderWidth: v })} />

      <div className="panel__section-title">Typography</div>
      <LinkableColorRow label="Text color" theme={theme} value={partStyle.textColor} onChange={(v) => updateItemPart(item.id, part, { textColor: v })} fallback={defaultColor} />
      <FontControls
        style={partStyle}
        onChange={(patch) => updateItemPart(item.id, part, patch)}
        defaultSize={partDefaultFontSize(def, part)}
        theme={theme}
      />

      <AlignmentSection
        hAlign={
          isPartAlignable(def, part) && (
            <ContentAlignControl
              label="Align"
              options={H_ALIGN_OPTIONS}
              defaultValue="left"
              value={partStyle.contentAlign}
              onChange={(v) => updateItemPart(item.id, part, { contentAlign: v })}
            />
          )
        }
        pageAlignItem={pageAlignItem}
      />

      {deletable && (
        <button className="tbtn" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => deleteBlockLine(item.id, part)}>
          Delete this line
        </button>
      )}
      {!deletable && def.variant === 'block' && part !== 'title' && (
        <p className="empty-hint">This line is required and can't be removed.</p>
      )}
    </>
  );
}

// Whole-item font-size fallback per variant — mirrors the fallbacks
// CanvasItem.jsx's ContentBody passes to fontStyle() for that same variant.
// (`label-value` never reaches this: it's a SUB_PART_VARIANT, so
// hideTextControls suppresses the whole-item font row entirely — table's
// own dedicated panel below has its own header-size field, but body font
// size is this same generic control now — see Prompt 23 item 10.)
function variantDefaultFontSize(variant) {
  if (variant === 'table') return 6.375;
  if (variant === 'footer') return 5.25;
  return 7.5; // text, note
}

function ContentProperties({ items, pageAlignItem }) {
  const { template, updateItems } = useEditor();
  const theme = template.theme;
  const ids = items.map((i) => i.id);
  const first = items[0];
  // block/qr/label-value's own text lives in their sub-parts (styled via
  // PartProperties instead) — the whole-item selection here only covers
  // their outer card (background/border), not a font a whole-item control
  // would even apply to. Every other variant is a single flat text run,
  // where the whole-item controls ARE the text controls — except
  // 'divider', which has no text at all (its color is the Background
  // control below, matching how the shape-line's color works), and
  // 'image', whose Logo/Signature types now render a real asset rather
  // than a currentColor-recolorable mark — text color and font no longer
  // apply to either. Background/border stay available regardless.
  const firstVariant = ELEMENT_TYPES[first.type].variant;
  const hideTextControls =
    items.length === 1 && (SUB_PART_VARIANTS.has(firstVariant) || firstVariant === 'divider' || firstVariant === 'image');
  const showHAlign = H_ALIGNABLE_VARIANTS.has(firstVariant) && !ELEMENT_TYPES[first.type].spread;
  const showVAlign = V_ALIGNABLE_VARIANTS.has(firstVariant);
  // Prompt 24 item 4: Width/Height (and Rotation) — parity with shapes,
  // which already had exact numeric fields; content items previously
  // could only be resized by dragging handles. Hidden for a locked
  // selection (the footer) the same way Alignment already is — a locked
  // item is never moved/resized/rotated at all.
  const allUnlocked = items.every((i) => !i.locked);
  // Prompt 24 item 4: the logo shape/mask picker (elementCatalog.js's
  // `shapeOptions`, wired up now — see CanvasItem's logoMaskRadius)
  // replaces the generic Corner radius slider for `logo` specifically —
  // a discrete mask, not a continuous px value. `divider`'s Corner
  // radius is removed outright (audit finding): its render path hardcodes
  // the rounded-end radius from `naturalHeight / 2`, so the slider never
  // did anything — its sibling `line` shape already correctly has no such
  // control.
  const isLogo = first.type === 'logo';
  const showCornerRadius = firstVariant !== 'divider' && !isLogo;

  return (
    <>
      <div className="panel__section-title">
        {items.length > 1 ? `${items.length} elements selected` : ELEMENT_TYPES[first.type].label}
      </div>

      {allUnlocked && (
        <>
          <div className="panel__section-title">Position &amp; size</div>
          <div className="prop-row">
            <label>Width (mm)</label>
            <input type="number" step="0.1" value={round2(first.width)} onChange={(e) => updateItems(ids, () => ({ width: Number(e.target.value) }))} />
          </div>
          <div className="prop-row">
            <label>Height (mm)</label>
            <input type="number" step="0.1" value={round2(first.height)} onChange={(e) => updateItems(ids, () => ({ height: Number(e.target.value) }))} />
          </div>
          <SliderRow label="Rotation" min={-180} max={180} value={first.rotation || 0} onChange={(v) => updateItems(ids, () => ({ rotation: v }))} />
        </>
      )}

      {/* Fill / Border / Radius — universal (Prompt 15): every content
          item renders a frame that can take a background/border/radius,
          Logo/Signature/QR included, since their border/background live
          on this same outer frame (see CanvasItem.jsx's frameStyle). */}
      <div className="panel__section-title">Fill &amp; border</div>
      <LinkableColorRow label="Background" theme={theme} value={first.bgColor} onChange={(v) => updateItems(ids, () => ({ bgColor: v }))} />
      <LinkableColorRow label="Border color" theme={theme} value={first.borderColor} onChange={(v) => updateItems(ids, () => ({ borderColor: v }))} fallback="#262420" />
      <SliderRow label="Border width (mm)" min={0} max={1.6} step={0.1} value={first.borderWidth || 0} onChange={(v) => updateItems(ids, () => ({ borderWidth: v }))} />
      {isLogo && (
        <div className="prop-row">
          <label>Shape</label>
          <div className="align-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {LOGO_SHAPE_OPTIONS.map(([v, text]) => (
              <button
                key={v}
                className="tbtn"
                style={{ fontWeight: (first.logoShape || 'square') === v ? 700 : 400 }}
                onClick={() => updateItems(ids, () => ({ logoShape: v }))}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      )}
      {showCornerRadius && (
        <SliderRow label="Corner radius (mm)" min={0} max={6.4} step={0.1} value={first.cornerRadius ?? 0} onChange={(v) => updateItems(ids, () => ({ cornerRadius: v }))} />
      )}

      {!hideTextControls && (
        <>
          <div className="panel__section-title">Typography</div>
          <LinkableColorRow label="Text color" theme={theme} value={first.textColor} onChange={(v) => updateItems(ids, (item) => bulkTextStylePatch(item, { textColor: v }))} fallback="#262420" />
          <FontControls
            style={first}
            onChange={(patch) => updateItems(ids, (item) => bulkTextStylePatch(item, patch))}
            defaultSize={variantDefaultFontSize(firstVariant)}
            theme={theme}
          />
        </>
      )}

      <AlignmentSection
        hAlign={
          showHAlign && (
            <ContentAlignControl
              label="Align"
              options={H_ALIGN_OPTIONS}
              defaultValue="left"
              value={first.contentAlign}
              onChange={(v) => updateItems(ids, () => ({ contentAlign: v }))}
            />
          )
        }
        vAlign={
          showVAlign && (
            <ContentAlignControl
              label="Vertical"
              options={V_ALIGN_OPTIONS}
              defaultValue="top"
              value={first.contentAlignY}
              onChange={(v) => updateItems(ids, () => ({ contentAlignY: v }))}
            />
          )
        }
        pageAlignItem={pageAlignItem}
      />
    </>
  );
}

// Table-only controls (per the elementCatalog.js type key, gated to that
// one item type, not generalized into the generic item panels above) —
// header row styling, row borders/shading, corner radius. Column widths
// are dragged directly on the canvas (the divider handles in
// CanvasItem.jsx); this just points that out, there's no width input here.
//
// Prompt 23 item 10: body font size used to have its OWN input here,
// editing the exact same `item.fontSize` field the generic Typography
// section's "Size" control (above, in ContentProperties) already edits —
// a literal duplicate. Removed here; the generic control is now the one
// place that sets it.
function TableProperties({ item }) {
  const { updateItem } = useEditor();
  const patch = (p) => updateItem(item.id, p);
  const headerWeights = fontFamilyById(item.fontFamily).weights;

  return (
    <>
      <div className="panel__section-title">Table — Header row</div>
      <div className="prop-row">
        <label>Background</label>
        <input type="color" value={item.headerBg || '#faf9f6'} onChange={(e) => patch({ headerBg: e.target.value })} />
      </div>
      <div className="prop-row">
        <label>Text color</label>
        <input type="color" value={item.headerTextColor || '#262420'} onChange={(e) => patch({ headerTextColor: e.target.value })} />
      </div>
      <div className="prop-row">
        <label>Weight</label>
        <select value={item.headerFontWeight || headerWeights[headerWeights.length - 1]} onChange={(e) => patch({ headerFontWeight: Number(e.target.value) })}>
          {headerWeights.map((w) => <option key={w} value={w}>{FONT_WEIGHT_LABELS[w]}</option>)}
        </select>
      </div>
      <div className="prop-row">
        <label>Size (pt)</label>
        <input type="number" min="4.5" max="54" step="0.5" value={round2(item.headerFontSize || 5.25)} onChange={(e) => patch({ headerFontSize: Number(e.target.value) })} />
      </div>

      <div className="panel__section-title">Table — Body rows</div>
      <div className="prop-row">
        <label>Row border color</label>
        <input type="color" value={item.rowBorderColor || '#e5e1d6'} onChange={(e) => patch({ rowBorderColor: e.target.value })} />
      </div>
      <SliderRow label="Row border width (mm)" min={0} max={1} step={0.05} value={item.rowBorderWidth ?? 0.25} onChange={(v) => patch({ rowBorderWidth: v })} />
      <div className="prop-row">
        <label>Alternating shading</label>
        <input type="checkbox" checked={!!item.altRowShading} onChange={(e) => patch({ altRowShading: e.target.checked })} />
      </div>
      {item.altRowShading && (
        <div className="prop-row">
          <label>Shading color</label>
          <input type="color" value={item.altRowColor || '#f5f3ee'} onChange={(e) => patch({ altRowColor: e.target.value })} />
        </div>
      )}

      <div className="panel__section-title">Table — Columns</div>
      <SliderRow label="Cell padding (mm)" min={0} max={4.2} step={0.1} value={item.cellPadding ?? pxToMm(4)} onChange={(v) => patch({ cellPadding: v })} />
      {ELEMENT_TYPES[item.type].render().columns.map((col, j) => {
        const align = item.columnAlign?.[j] || (j === 0 ? 'left' : 'right');
        const setAlign = (v) => {
          const next = [...(item.columnAlign || ELEMENT_TYPES[item.type].render().columns.map((_, i) => (i === 0 ? 'left' : 'right')))];
          next[j] = v;
          patch({ columnAlign: next });
        };
        return (
          <div className="prop-row" key={col}>
            <label>{col}</label>
            <div className="align-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {['left', 'center', 'right'].map((v) => (
                <button key={v} className="tbtn" style={{ fontWeight: align === v ? 700 : 400 }} onClick={() => setAlign(v)}>
                  {v[0].toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <p className="empty-hint">Drag the thin dividers on the table itself to resize individual columns.</p>
    </>
  );
}

// customText-only controls (gated to that one item type, same pattern as
// Table/Footer's own dedicated panels below) — this is where the
// "reverses the no-text-entry rule" content actually lives: a real
// content field in the properties panel, not inline-on-canvas editing.
//
// Why the properties panel, not inline editing: every other editable
// property in this app (position, color, font, alignment, ...) is
// already a properties-panel control — there is no OTHER inline-on-canvas
// editing pattern anywhere in this codebase to be consistent with, and
// building one here would be a second, bespoke interaction model for
// exactly one field. More concretely, contentEditable-on-canvas would
// collide head-on with CanvasItem's own onMouseDown-starts-a-drag
// handling on the same element (beginMove/beginResize both fire on
// mousedown at the item's outer frame) — entering edit mode would need a
// whole separate double-click-to-edit-then-blur-to-commit state machine,
// competing with drag/resize/rotate/part-select for the same pointer
// events, for a benefit (typing "in place") this app's own established
// pattern doesn't need. A plain textarea here is simpler, keeps text
// entry fully separate from every drag gesture, and reuses the exact
// commit-on-change data flow every other field in this panel already
// uses (updateItem, one entry per keystroke — same as the existing
// Width/Height number inputs, not gated behind a separate save step).
//
// Binding picker: real bindings from bindings.js (itself sourced from
// apps/invoices/design_schema.py's SUPPORTED_BINDINGS — see that file's
// own header comment). Selecting a binding calls setItemBinding
// (EditorContext), which enforces the split instance rule's bound half
// (single-instance per binding) and returns false when another item
// already holds that exact binding — surfaced here as a real, visible
// inline message (never a silent no-op), and the select is reset back to
// its prior value since the write didn't happen.
function CustomTextProperties({ item }) {
  const { updateItem, setItemBinding } = useEditor();
  const [bindingError, setBindingError] = useState(null);

  const handleBindingChange = (e) => {
    const v = e.target.value;
    const binding = v === '' ? null : v;
    setBindingError(null);
    const ok = setItemBinding(item.id, binding);
    if (!ok) {
      setBindingError(`"${bindingLabel(binding)}" is already used by another text element on this page — each binding can only be used once.`);
    }
  };

  // If this item's own current binding isn't one of the known
  // BINDING_OPTIONS (e.g. imported from a hand-authored production
  // design — see elementCatalog.js's createGenericTextItem), it still
  // needs to appear as a selectable, non-destructive option in the
  // picker rather than silently vanishing/resetting the moment the
  // panel opens.
  const currentBinding = item.binding || '';
  const knownValues = new Set(BINDING_OPTIONS.map((b) => b.value));
  const hasUnknownCurrent = currentBinding && !knownValues.has(currentBinding);

  return (
    <>
      <div className="panel__section-title">Content</div>
      <div className="prop-row">
        <label>Binding</label>
        <select value={currentBinding} onChange={handleBindingChange}>
          <option value="">No binding (static text)</option>
          {hasUnknownCurrent && <option value={currentBinding}>{currentBinding} (custom)</option>}
          {BINDING_OPTIONS.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>
      </div>
      {bindingError && (
        <p className="empty-hint" style={{ color: 'var(--danger)' }}>{bindingError}</p>
      )}
      {item.binding ? (
        <p className="empty-hint">
          This text shows a live value ({bindingLabel(item.binding)}) once the invoice is generated — sample text shown here is a preview only.
        </p>
      ) : (
        <div className="prop-row" style={{ alignItems: 'flex-start' }}>
          <label style={{ marginTop: 6 }}>Text</label>
          <textarea
            value={item.text || ''}
            onChange={(e) => updateItem(item.id, { text: e.target.value })}
            rows={3}
            style={{
              width: 160,
              resize: 'vertical',
              fontFamily: 'inherit',
              fontSize: 12,
              padding: '6px 8px',
              borderRadius: 4,
              border: '1px solid var(--border-glass)',
              background: 'var(--bg-panel-raised)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
      )}
    </>
  );
}

// Footer-only controls (gated to that one item type, same pattern as
// Prompt 8's table controls). Text color and background are already
// covered by the generic ContentProperties above (which now works for the
// footer since it became selectable) — this just adds the one control
// that's genuinely new: the divider rule above the footer.
function FooterProperties({ item }) {
  const { updateItem } = useEditor();

  return (
    <>
      <div className="panel__section-title">Footer — Divider</div>
      <div className="prop-row">
        <label>Divider color</label>
        <input type="color" value={item.dividerColor || '#e5e1d6'} onChange={(e) => updateItem(item.id, { dividerColor: e.target.value })} />
      </div>
    </>
  );
}

function PageProperties() {
  const { template, updatePageBackground } = useEditor();

  return (
    <>
      <div className="panel__section-title">Page</div>
      <div className="prop-row">
        <label>Background</label>
        <input type="color" value={template.page.backgroundColor} onChange={(e) => updatePageBackground(e.target.value)} />
      </div>
    </>
  );
}

// Prompt 28 item 4: template-level, not per-item — shown alongside the
// page background (PageProperties) in the same "nothing selected" slot,
// since both are whole-document settings rather than something any one
// item owns. Editing any of these four values updates every item
// currently linked to that slot immediately (CanvasItem re-resolves
// `template.theme` on every render — see resolveItemTheme) with no
// per-item action needed.
function ThemePanel() {
  const { template, updateTheme } = useEditor();
  const theme = template.theme;
  const headingFamily = fontFamilyById(theme.headingFont.family);
  const bodyFamily = fontFamilyById(theme.bodyFont.family);

  return (
    <>
      <div className="panel__section-title">Theme</div>
      <div className="prop-row">
        <label>Primary color</label>
        <input type="color" value={theme.primaryColor} onChange={(e) => updateTheme({ primaryColor: e.target.value })} />
      </div>
      <div className="prop-row">
        <label>Secondary color</label>
        <input type="color" value={theme.secondaryColor} onChange={(e) => updateTheme({ secondaryColor: e.target.value })} />
      </div>
      <div className="prop-row">
        <label>Heading font</label>
        <select
          value={headingFamily.id}
          onChange={(e) => {
            const next = FONT_FAMILIES.find((f) => f.id === e.target.value);
            const weight = next.weights.includes(theme.headingFont.weight) ? theme.headingFont.weight : next.weights[0];
            updateTheme({ headingFont: { family: next.id, weight } });
          }}
        >
          {FONT_FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>
      <div className="prop-row">
        <label>Heading weight</label>
        <select
          value={theme.headingFont.weight}
          onChange={(e) => updateTheme({ headingFont: { ...theme.headingFont, weight: Number(e.target.value) } })}
        >
          {headingFamily.weights.map((w) => <option key={w} value={w}>{FONT_WEIGHT_LABELS[w]}</option>)}
        </select>
      </div>
      <div className="prop-row">
        <label>Body font</label>
        <select
          value={bodyFamily.id}
          onChange={(e) => {
            const next = FONT_FAMILIES.find((f) => f.id === e.target.value);
            const weight = next.weights.includes(theme.bodyFont.weight) ? theme.bodyFont.weight : next.weights[0];
            updateTheme({ bodyFont: { family: next.id, weight } });
          }}
        >
          {FONT_FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>
      <div className="prop-row">
        <label>Body weight</label>
        <select
          value={theme.bodyFont.weight}
          onChange={(e) => updateTheme({ bodyFont: { ...theme.bodyFont, weight: Number(e.target.value) } })}
        >
          {bodyFamily.weights.map((w) => <option key={w} value={w}>{FONT_WEIGHT_LABELS[w]}</option>)}
        </select>
      </div>
    </>
  );
}

function ShapeProperties({ items, pageAlignItem }) {
  const { template, updateItems } = useEditor();
  const theme = template.theme;
  const ids = items.map((i) => i.id);
  const first = items[0];

  return (
    <>
      <div className="panel__section-title">{items.length > 1 ? `${items.length} shapes selected` : 'Shape'}</div>

      <div className="panel__section-title">Position &amp; size</div>
      <div className="prop-row">
        <label>Width (mm)</label>
        <input type="number" step="0.1" value={round2(first.width)} onChange={(e) => updateItems(ids, () => ({ width: Number(e.target.value) }))} />
      </div>
      <div className="prop-row">
        <label>Height (mm)</label>
        <input type="number" step="0.1" value={round2(first.height)} onChange={(e) => updateItems(ids, () => ({ height: Number(e.target.value) }))} />
      </div>
      <SliderRow label="Rotation" min={-180} max={180} value={first.rotation} onChange={(v) => updateItems(ids, () => ({ rotation: v }))} />

      <div className="panel__section-title">Fill &amp; border</div>
      <LinkableColorRow label="Fill" theme={theme} value={first.fill} onChange={(v) => updateItems(ids, () => ({ fill: v }))} fallback="#7152F5" />
      <LinkableColorRow label="Border color" theme={theme} value={first.borderColor} onChange={(v) => updateItems(ids, () => ({ borderColor: v }))} fallback="#262420" />
      <SliderRow label="Border width (mm)" min={0} max={2.1} step={0.1} value={first.borderWidth} onChange={(v) => updateItems(ids, () => ({ borderWidth: v }))} />
      {first.type === 'roundedRect' && (
        <SliderRow label="Corner radius (mm)" min={0} max={15.9} step={0.1} value={first.radius} onChange={(v) => updateItems(ids, () => ({ radius: v }))} />
      )}

      <AlignmentSection pageAlignItem={pageAlignItem} />
    </>
  );
}

// Prompt 27: an `image` item's panel — Position/Size/Rotation (same
// pattern content items got in Prompt 24) + Fill/Border/Radius (styled
// exactly like a content item's frame — see CanvasItem's frameStyle) +
// page alignment. No Typography (no text at all) and no content-align
// (nothing to align within the box — the picture just fills it).
function ImageProperties({ items, pageAlignItem }) {
  const { template, updateItems } = useEditor();
  const theme = template.theme;
  const ids = items.map((i) => i.id);
  const first = items[0];
  const allUnlocked = items.every((i) => !i.locked);

  return (
    <>
      <div className="panel__section-title">{items.length > 1 ? `${items.length} images selected` : 'Image'}</div>

      {allUnlocked && (
        <>
          <div className="panel__section-title">Position &amp; size</div>
          <div className="prop-row">
            <label>Width (mm)</label>
            <input type="number" step="0.1" value={round2(first.width)} onChange={(e) => updateItems(ids, () => ({ width: Number(e.target.value) }))} />
          </div>
          <div className="prop-row">
            <label>Height (mm)</label>
            <input type="number" step="0.1" value={round2(first.height)} onChange={(e) => updateItems(ids, () => ({ height: Number(e.target.value) }))} />
          </div>
          <SliderRow label="Rotation" min={-180} max={180} value={first.rotation || 0} onChange={(v) => updateItems(ids, () => ({ rotation: v }))} />
        </>
      )}

      <div className="panel__section-title">Fill &amp; border</div>
      <LinkableColorRow label="Background" theme={theme} value={first.bgColor} onChange={(v) => updateItems(ids, () => ({ bgColor: v }))} />
      <LinkableColorRow label="Border color" theme={theme} value={first.borderColor} onChange={(v) => updateItems(ids, () => ({ borderColor: v }))} fallback="#262420" />
      <SliderRow label="Border width (mm)" min={0} max={1.6} step={0.1} value={first.borderWidth || 0} onChange={(v) => updateItems(ids, () => ({ borderWidth: v }))} />
      <SliderRow label="Corner radius (mm)" min={0} max={6.4} step={0.1} value={first.cornerRadius ?? 0} onChange={(v) => updateItems(ids, () => ({ cornerRadius: v }))} />

      <AlignmentSection pageAlignItem={pageAlignItem} />
    </>
  );
}

// Prompt 24 item 4: a mixed shape+content selection used to show nothing
// but a label — no controls, no guidance. `fill`/`bgColor` are different
// field names for the same "background" concept (shapes render `fill`,
// content items render `bgColor`), so one shared color control writes to
// whichever field actually applies to each selected item's own kind;
// `borderColor`/`borderWidth` are already the same field name for both
// kinds, so those just apply directly. Corner radius is deliberately left
// out — it means different things per shape sub-type (roundedRect only)
// and isn't "genuinely common" the way fill/border are.
function MixedProperties({ items }) {
  const { template, updateItems } = useEditor();
  const theme = template.theme;
  const ids = items.map((i) => i.id);
  const first = items[0];
  // Prompt 28: these two fields are resolved for DISPLAY (a linked value
  // is an object — `<input type="color">` can't render that directly),
  // but this control doesn't offer a link/custom toggle the way the
  // single-kind panels do (a "mixed" resolved default across two
  // different underlying fields, `fill` vs `bgColor`, isn't a clean fit
  // for that pattern) — editing the swatch here always writes a literal,
  // detaching whichever selected items were linked. A deliberate scope
  // line for this already-simplified mixed-selection control, not an
  // oversight.
  const firstBgResolved = resolveColorValue(first.kind === 'shape' ? first.fill : first.bgColor, theme);
  let firstBorderColor = resolveColorValue(first.borderColor, theme) || '#262420';
  if (firstBorderColor === 'transparent') firstBorderColor = '#000000';

  return (
    <>
      <div className="panel__section-title">{items.length} items selected (mixed)</div>
      <div className="prop-row">
        <label>Fill / Background</label>
        <input
          type="color"
          value={firstBgResolved || '#faf9f6'}
          onChange={(e) => {
            const v = e.target.value;
            updateItems(ids, (item) => (item.kind === 'shape' ? { fill: v } : { bgColor: v }));
          }}
        />
      </div>
      <div className="prop-row">
        <label>Border color</label>
        <input type="color" value={firstBorderColor} onChange={(e) => updateItems(ids, () => ({ borderColor: e.target.value }))} />
      </div>
      <SliderRow label="Border width (mm)" min={0} max={2.1} step={0.1} value={first.borderWidth || 0} onChange={(v) => updateItems(ids, () => ({ borderWidth: v }))} />
      <p className="empty-hint" style={{ marginTop: 10 }}>
        Move, resize, and rotate this selection together using the shared handles on the canvas.
      </p>
    </>
  );
}

export default function PropertiesPanel() {
  const { template, selection, saveState } = useEditor();
  const selectedItems = template.items.filter((i) => selection.ids.includes(i.id));
  const partItem = selection.part ? template.items.find((i) => i.id === selection.part.id) : null;
  const kinds = new Set(selectedItems.map((i) => i.kind));
  const singleItem = selectedItems.length === 1 ? selectedItems[0] : null;
  const pageAlignItem = singleItem && !singleItem.locked ? singleItem : null;

  return (
    <div className="panel panel--right">
      {partItem && SUB_PART_VARIANTS.has(ELEMENT_TYPES[partItem.type].variant) ? (
        <PartProperties item={partItem} part={selection.part.key} pageAlignItem={pageAlignItem} />
      ) : (
        <>
          {selectedItems.length > 0 && kinds.size === 1 && kinds.has('content') && (
            <>
              <ContentProperties items={selectedItems} pageAlignItem={pageAlignItem} />
              {selectedItems.length === 1 && selectedItems[0].type === 'itemsTable' && (
                <TableProperties item={selectedItems[0]} />
              )}
              {selectedItems.length === 1 && selectedItems[0].type === 'footer' && (
                <FooterProperties item={selectedItems[0]} />
              )}
              {selectedItems.length === 1 && selectedItems[0].type === 'customText' && (
                <CustomTextProperties item={selectedItems[0]} />
              )}
            </>
          )}
          {selectedItems.length > 0 && kinds.size === 1 && kinds.has('shape') && (
            <ShapeProperties items={selectedItems} pageAlignItem={pageAlignItem} />
          )}
          {selectedItems.length > 0 && kinds.size === 1 && kinds.has('image') && (
            <ImageProperties items={selectedItems} pageAlignItem={pageAlignItem} />
          )}
          {selectedItems.length > 0 && kinds.size > 1 && (
            <MixedProperties items={selectedItems} />
          )}
        </>
      )}
      {selectedItems.length === 0 && (
        <>
          <ThemePanel />
          <PageProperties />
        </>
      )}

      {saveState.status !== 'idle' && (
        <div className="validation-list">
          <div className="panel__section-title" style={{ margin: 0, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            {saveState.status === 'saved' && <CheckIcon size={12} />}
            <span>{saveState.status === 'saved' ? 'Saved' : 'Fix before saving'}</span>
          </div>
          {saveState.issues.map((issue, i) => (
            <div key={i} className={`validation-item validation-item--${issue.level}`}>
              <span className="validation-item__icon">{issue.level === 'error' ? <ErrorIcon size={13} /> : <WarningIcon size={13} />}</span>
              <span>{issue.message}</span>
            </div>
          ))}
          {saveState.status === 'saved' && saveState.issues.length === 0 && (
            <div className="validation-item" style={{ color: 'var(--success)' }}>Template passed all checks.</div>
          )}
        </div>
      )}
    </div>
  );
}
