// src/components/PasswordStrength.jsx
import { Check, X } from 'lucide-react'

// Mirrored exactly from apps/users/serializers.py's PASSWORD_RULES —
// keep these two lists in sync. If the backend rules change, this list
// must change too, or the frontend will show "all requirements met"
// for a password the backend still rejects.
const RULES = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'One lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'One number', test: (v) => /[0-9]/.test(v) },
  { label: 'One special character', test: (v) => /[!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|`~]/.test(v) },
]

export function isPasswordValid(password = '') {
  return RULES.every((r) => r.test(password))
}

export default function PasswordStrength({ password = '' }) {
  const results = RULES.map((r) => ({ ...r, met: r.test(password) }))
  const metCount = results.filter((r) => r.met).length
  const allMet = metCount === RULES.length

  // Hide entirely once the password is empty or already meets every rule —
  // there's nothing useful left to show the person once it's valid, and
  // showing nothing for an empty field avoids clutter before they've
  // started typing at all.
  if (password.length === 0 || allMet) return null

  const strength = metCount / RULES.length
  const barColor = strength < 0.4 ? '#F2748B' : strength < 1 ? '#f59e0b' : '#5FD08A'

  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
          marginBottom: 10,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${strength * 100}%`,
            background: barColor,
            borderRadius: 2,
            transition: 'width 0.25s ease, background 0.25s ease',
          }}
        />
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px' }}>
        {results.map((r) => (
          <li
            key={r.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12.5,
              color: r.met ? '#5FD08A' : 'rgba(255,255,255,0.4)',
              transition: 'color 0.2s ease',
            }}
          >
            {r.met ? <Check size={13} /> : <X size={13} />}
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  )
}