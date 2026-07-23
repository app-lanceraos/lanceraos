// src/components/AuthLayout.jsx
import { useMemo } from 'react'
import { Calculator, FileText, ShieldCheck, Users, Wallet } from 'lucide-react'
import { LogoSVG, WordmarkSVG } from './Brand'

// Auth-specific palette — fixed per DESIGN.md section 9, deliberately NOT
// theme.css tokens. These never change with the light/dark toggle.
const AUTH_INPUT_BG = '#141126'
const AUTH_INPUT_BORDER = '#342E58'
const AUTH_FOCUS = '#A89CF2'
const AUTH_PLACEHOLDER = '#8074C0'

const ORBIT_NODES = [
  { Icon: FileText, ring: 'outer', angle: 20 },
  { Icon: Wallet, ring: 'outer', angle: 200 },
  { Icon: ShieldCheck, ring: 'middle', angle: 100 },
  { Icon: Users, ring: 'middle', angle: 280 },
  { Icon: Calculator, ring: 'inner', angle: 45 },
]

function useStarfield(count = 110) {
  return useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: 0.6 + Math.random() * 2.0,
        delay: Math.random() * 4,
        duration: 3 + Math.random() * 4,
      })),
    [count],
  )
}

function OrbitNode({ children }) {
  return (
    <div
      style={{
        width: '13cqw',
        height: '13cqw',
        minWidth: 30,
        minHeight: 30,
        maxWidth: 46,
        maxHeight: 46,
        borderRadius: '50%',
        background: 'rgba(6,3,20,0.32)',
        border: '1px solid rgba(150,110,255,0.9)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: AUTH_FOCUS,
      }}
    >
      {children}
    </div>
  )
}

function OrbitRing({ radiusPercent, icons, ringClass, nodeClass }) {
  return (
    <div
      className={ringClass}
      style={{
        position: 'absolute',
        inset: `${radiusPercent}%`,
        borderRadius: '50%',
        border: '1px solid rgba(150,110,255,0.26)',
      }}
    >
      {icons.map(({ Icon, angle }, i) => (
        <div key={i} style={{ position: 'absolute', inset: 0, transform: `rotate(${angle}deg)` }}>
          <div
            className={nodeClass}
            style={{ position: 'absolute', top: -1, left: '50%', transform: 'translate(-50%, -50%)' }}
          >
            <OrbitNode>
              <Icon size={15} />
            </OrbitNode>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Shared shell for every auth page (Login, Register, ForgotPassword,
 * etc). Fixed deep-dark background regardless of the theme toggle —
 * this is the one part of the app that intentionally never responds
 * to light/dark mode (see DESIGN.md section 9).
 */
export default function AuthLayout({ children, formMaxWidth = 360 }) {
  const stars = useStarfield(110)

  return (
    <div
      className="lanceraos-auth-shell"
      style={{
        minHeight: '100vh',
        width: '100%',
        background: '#050508',
        backgroundImage:
          'radial-gradient(ellipse 70% 55% at 50% 42%, #100a1c 0%, #060309 45%, #050508 82%)',
        backgroundAttachment: 'fixed',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <style>{`
        @keyframes lanceraos-star-twinkle {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 1; }
        }
        @keyframes lanceraos-orbit-cw {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes lanceraos-orbit-ccw {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        .lanceraos-ring-outer  { animation: lanceraos-orbit-cw 30s linear infinite; }
        .lanceraos-ring-middle { animation: lanceraos-orbit-ccw 23s linear infinite; }
        .lanceraos-ring-inner  { animation: lanceraos-orbit-cw 30s linear infinite; }
        .lanceraos-node-outer  { animation: lanceraos-orbit-ccw 30s linear infinite; }
        .lanceraos-node-middle { animation: lanceraos-orbit-cw 23s linear infinite; }
        .lanceraos-node-inner  { animation: lanceraos-orbit-ccw 30s linear infinite; }

        @media (prefers-reduced-motion: reduce) {
          .lanceraos-ring-outer, .lanceraos-ring-middle, .lanceraos-ring-inner,
          .lanceraos-node-outer, .lanceraos-node-middle, .lanceraos-node-inner {
            animation: none !important;
          }
          .lanceraos-star { animation: none !important; opacity: 0.5 !important; }
        }

        @media (max-width: 860px) {
          .lanceraos-auth-shell { grid-template-columns: 1fr !important; }
          .lanceraos-orbit-panel { display: none !important; }
          .lanceraos-mobile-brand { display: flex !important; }
        }

        /* iOS auto-zoom prevention on auth inputs */
        @media (max-width: 768px) {
          .lanceraos-auth-shell input { font-size: 16px !important; }
        }
      `}</style>

      {/* Starfield */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} aria-hidden="true">
        {stars.map((s) => (
          <div
            key={s.id}
            className="lanceraos-star"
            style={{
              position: 'absolute',
              top: `${s.top}%`,
              left: `${s.left}%`,
              width: s.size,
              height: s.size,
              borderRadius: '50%',
              background: '#ffffff',
              animation: `lanceraos-star-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Left panel — orbit visualization, hidden ≤860px */}
      <div
        className="lanceraos-orbit-panel"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          containerType: 'inline-size',
          zIndex: 1,
        }}
      >
        <div style={{ position: 'relative', width: '60cqw', height: '60cqw', maxWidth: 440, maxHeight: 440 }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              zIndex: 2,
            }}
          >
            <LogoSVG size={56} />
            <WordmarkSVG width={150} height={22} />
          </div>

          <OrbitRing
            radiusPercent={0}
            icons={ORBIT_NODES.filter((n) => n.ring === 'outer')}
            ringClass="lanceraos-ring-outer"
            nodeClass="lanceraos-node-outer"
          />
          <OrbitRing
            radiusPercent={15}
            icons={ORBIT_NODES.filter((n) => n.ring === 'middle')}
            ringClass="lanceraos-ring-middle"
            nodeClass="lanceraos-node-middle"
          />
          <OrbitRing
            radiusPercent={32}
            icons={ORBIT_NODES.filter((n) => n.ring === 'inner')}
            ringClass="lanceraos-ring-inner"
            nodeClass="lanceraos-node-inner"
          />
        </div>
      </div>

      {/* Right panel — form */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 24px',
        }}
      >
        <div
          className="lanceraos-mobile-brand"
          style={{ display: 'none', alignItems: 'center', gap: 10, marginBottom: 32 }}
        >
          <LogoSVG size={32} />
          <WordmarkSVG width={120} height={18} />
        </div>

        <div style={{ width: '100%', maxWidth: formMaxWidth }}>{children}</div>
      </div>
    </div>
  )
}

// Exported so Login/Register/etc. can style their <input>s and buttons
// consistently without redefining these values themselves.
export const authTokens = {
  inputBg: AUTH_INPUT_BG,
  inputBorder: AUTH_INPUT_BORDER,
  focus: AUTH_FOCUS,
  placeholder: AUTH_PLACEHOLDER,
  primaryBg: '#A89CF2',
  primaryText: '#F6F4FE',
  success: '#5FD08A',
  error: '#F2748B',
}