// Fixed, professional shape primitives only. No freeform/polygon drawing.
import { pxToMm, roundMm } from '../utils/units';

// Phase 2a: defaultSize/position/radius below are still authored at their
// original px values and converted to mm once, at module load — same
// mechanical-conversion reasoning as elementCatalog.js's own boxMm (this
// is seed/demo sizing, not a tuned UX-feel constant).
const toMm = (v) => roundMm(pxToMm(v));

export const SHAPE_TYPES = {
  roundedRect: {
    label: 'Rounded rectangle',
    defaultSize: { width: toMm(160), height: toMm(90) },
    defaultProps: { fill: '#7152F5', borderColor: 'transparent', borderWidth: 0, radius: toMm(12) },
  },
  ellipse: {
    label: 'Circle / ellipse',
    defaultSize: { width: toMm(120), height: toMm(120) },
    defaultProps: { fill: '#A89CF2', borderColor: 'transparent', borderWidth: 0 },
  },
  line: {
    label: 'Line / divider',
    defaultSize: { width: toMm(200), height: toMm(4) },
    defaultProps: { fill: '#7152F5', borderColor: 'transparent', borderWidth: 0 },
  },
  // Production's `generic:container` (design_schema.GENERIC_TYPES,
  // design_renderer.SHAPE_TYPES_WITH_OWN_FILL) is a real, tested,
  // functioning background/grouping box — the exact same fill/border/
  // corner-radius resolution `rectangle` gets (design_renderer.py's
  // attach_generic_content shares one code path for both types), just
  // under its own semantic name for "a background panel behind other
  // content" rather than "a decorative shape." No real BUILTIN_DESIGNS
  // seed uses one yet, but it's genuine, live-rendering, schema-validated
  // production surface (apps/invoices/tests/test_design_renderer.py's own
  // test_generic_container_renders_as_a_background_box), not dead code —
  // importing a hand-authored design that uses one used to drop it
  // silently (designDataAdapter.js's own importGenericShape previously
  // warned "no editor equivalent" and discarded it). Defaults sized/
  // colored as a large, subtle background panel (rather than
  // roundedRect's smaller accent-purple default) to read as a distinct
  // catalog choice, not a duplicate of Rounded rectangle.
  container: {
    label: 'Container',
    defaultSize: { width: toMm(300), height: toMm(200) },
    defaultProps: { fill: '#F4F2ED', borderColor: 'transparent', borderWidth: 0, radius: 0 },
  },
};

export const createShape = (type, position = { x: toMm(40), y: toMm(40) }) => {
  const def = SHAPE_TYPES[type];
  return {
    id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: 'shape',
    type,
    x: position.x,
    y: position.y,
    width: def.defaultSize.width,
    height: def.defaultSize.height,
    naturalWidth: def.defaultSize.width,
    naturalHeight: def.defaultSize.height,
    rotation: 0,
    ...def.defaultProps,
    // Prompt 28 item 3: a new shape defaults to the theme's primary color
    // (fill + border) rather than the catalog's own hardcoded editor-
    // brand purple (`defaultProps.fill` above) — shapes start with no
    // default template of their own to keep visually identical (the
    // initial template has zero shapes), so linking them by default is a
    // pure win for the "built entirely from defaults already looks
    // cohesive" goal, not a regression risk the way some content-item
    // defaults were (see elementCatalog.js's own comment on that).
    // `borderWidth` stays at `defaultProps`' own 0, so the border link is
    // invisible until a user actually turns a border on.
    fill: { linked: 'primary' },
    borderColor: { linked: 'primary' },
  };
};
