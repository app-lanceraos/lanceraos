// src/components/HealthRadar.jsx
//
// The five areas as a radar: each axis is that area's share of its own points (0 to 100), one neutral series. An area the
// server could not score has percent null: it is drawn at the centre because the polygon needs a value, but its axis label
// says "not scored" and a sentence under the chart explains that the centre does not mean zero. Rendered only when at least
// three areas are scored (a radar of two points is a line). The chart is a glance: every figure in it is also visible text
// in the area cards, so the SVG is hidden from assistive tech and the wrapper is a role="img" with a one-sentence label.
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts'

import useTheme from '@/hooks/useTheme'
import {
  HEALTH_RADAR_COLORS, RADAR_EXPLANATION, RADAR_SUBTITLE, RADAR_TITLE, RADAR_UNSCORED_TICK, radarHasUnscored, radarLabel, radarRows,
  radarTip, showRadar,
} from '@/pages/healthHelpers'
import DashboardCard from './DashboardCard'

const TICK_NUDGE = 8
const TICK_LINE = 13

// The axis label: the area name on up to two lines, then "not scored" for an unknown area. Recharts hands the tick its
// position (x, y) and anchor; `rows` says which areas are unscored.
export function RadarTick({ x, y, cx, cy, textAnchor, payload, rows }) {
  const row = (rows || []).find((r) => r.label === payload?.value)
  const words = String(payload?.value ?? '').split(' ')
  const lines = words.length > 1 ? [words[0], words.slice(1).join(' ')] : words
  const lineCount = lines.length + (row && !row.scored ? 1 : 0)
  // Push the label a few pixels away from the centre so a full-marks vertex never touches it; a label above the centre grows
  // upward (its extra lines go above its first), one below grows downward.
  const dx = x - (cx ?? x)
  const dy = y - (cy ?? y)
  const length = Math.hypot(dx, dy) || 1
  const nx = x + (dx / length) * TICK_NUDGE
  const ny = y + (dy / length) * TICK_NUDGE - (dy < -TICK_NUDGE ? (lineCount - 1) * TICK_LINE : 0)
  return (
    <text x={nx} y={ny} textAnchor={textAnchor} fontSize={11} style={{ fill: 'var(--text-secondary)' }}>
      {lines.map((line, index) => <tspan key={line} x={nx} dy={index === 0 ? 0 : TICK_LINE}>{line}</tspan>)}
      {row && !row.scored && <tspan x={nx} dy={TICK_LINE} style={{ fill: 'var(--text-tertiary)' }}>{RADAR_UNSCORED_TICK}</tspan>}
    </text>
  )
}

export default function HealthRadar({ data, loading, className }) {
  const { isDark } = useTheme()
  const color = HEALTH_RADAR_COLORS[isDark ? 'dark' : 'light']
  if (!data && loading) {
    return (
      <DashboardCard id="health-radar" title={RADAR_TITLE} subtitle={RADAR_SUBTITLE} className={className}>
        <div aria-busy="true" style={{ height: 260, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      </DashboardCard>
    )
  }
  if (!data || !showRadar(data)) return null
  const rows = radarRows(data.dimensions)
  return (
    <DashboardCard id="health-radar" title={RADAR_TITLE} subtitle={RADAR_SUBTITLE} className={className}>
      <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
        <div role="img" aria-label={radarLabel(data.dimensions)} style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <RadarChart data={rows} outerRadius="62%" margin={{ top: 16, right: 44, bottom: 16, left: 44 }} accessibilityLayer={false}>
              <PolarGrid stroke="var(--border-subtle)" />
              <PolarAngleAxis dataKey="label" tick={<RadarTick rows={rows} />} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar dataKey="value" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.18} isAnimationActive={false} />
              <Tooltip
                formatter={(_value, _name, item) => [radarTip(item.payload), item.payload.label]}
                separator=": "
                contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem' }}
                labelStyle={{ display: 'none' }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        {radarHasUnscored(data.dimensions) && (
          <p style={{ margin: '8px 0 0', fontSize: '0.74rem', color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>{RADAR_EXPLANATION}</p>
        )}
      </div>
    </DashboardCard>
  )
}
