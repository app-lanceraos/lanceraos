// src/lib/designEditor/blocks.js
//
// The drag-and-drop palette — one GrapesJS block per zone_1/zone_2 type,
// exactly matching design_schema.py's ZONE_1_TYPES/ZONE_2_TYPES vocabulary
// (nothing added, nothing removed). Dropped onto the canvas, each produces
// a real 'lancera-zone1-element'/'lancera-zone2-element' component that
// serialization.js already knows how to read back.
import { ZONE_1_TYPE_META, ZONE_2_TYPE_META } from './constants'

const ZONE1_BLOCK_CATEGORY = 'Zone 1 — Fixed Layout'
const ZONE2_BLOCK_CATEGORY = 'Zone 2 — Flow Layout'

export function registerBlocks(editor) {
  const { BlockManager } = editor

  Object.entries(ZONE_1_TYPE_META).forEach(([type, meta]) => {
    BlockManager.add(`zone1-${type}`, {
      label: meta.label,
      category: ZONE1_BLOCK_CATEGORY,
      media: '', // icons rendered by the React palette wrapper instead, see DesignEditor.jsx
      content: {
        type: 'lancera-zone1-element',
        classes: ['lancera-el', 'dyn-zone1-el'],
        attributes: {
          'data-el-type': type,
          'data-style-json': JSON.stringify({}),
        },
        style: {
          position: 'absolute',
          left: '20px',
          top: '20px',
          width: `${Math.round(meta.defaultWidth * (96 / 25.4))}px`,
          height: `${Math.round(meta.defaultHeight * (96 / 25.4))}px`,
        },
        // Real content isn't known yet at drop time (no backend round
        // trip inside GrapesJS's own drop handler) — DesignEditor.jsx's
        // 'component:add' listener fetches and fills this in
        // immediately after, the same real per-element endpoint a
        // style-panel edit already uses. A brief empty box between drop
        // and that fetch resolving is the only placeholder moment left
        // anywhere in this editor.
        content: '',
      },
    })
  })

  Object.entries(ZONE_2_TYPE_META).forEach(([type, meta]) => {
    BlockManager.add(`zone2-${type}`, {
      label: meta.label,
      category: ZONE2_BLOCK_CATEGORY,
      media: '',
      content: {
        type: 'lancera-zone2-element',
        classes: ['lancera-el', 'dyn-zone2-el'],
        attributes: {
          'data-el-type': type,
          'data-style-json': JSON.stringify({}),
          'data-paired': 'false',
        },
        style: { 'margin-top': '12px' },
        content: '',
      },
    })
  })
}
