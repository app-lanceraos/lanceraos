// src/components/AuthLayout.jsx
//
// Orbit visual identity ported EXACTLY from v1's AuthLayout.jsx (the real
// source, provided after an earlier version of this file had to be
// reconstructed from a text description and came out visibly different —
// see DECISIONS.md). Adapted only in two ways, both deliberate:
//   1. Logo/wordmark render via LogoSVG/WordmarkSVG (Brand.jsx) instead of
//      an <img> tag + inline <svg>, per DESIGN.md Section 13's explicit
//      rule that the auth-page orbit center uses inline SVG.
//   2. The external prop interface stays `children` + `formMaxWidth`
//      (each page already renders its own title/subtitle/footer content)
//      rather than v1's `title`/`subtitle`/`footer` props — this file
//      only had to change internally, not the call sites in every page.
// Everything else — every class name, every keyframe, every cqw
// measurement, the rotor/slot/counter/unspin structure, the exact orbit
// icon paths — is verbatim from v1.
import { useEffect, useRef } from 'react'
import { LogoSVG, WordmarkSVG } from './Brand'

// Auth-specific palette — fixed per DESIGN.md section 9, deliberately NOT
// theme.css tokens. These never change with the light/dark toggle.
const AUTH_INPUT_BG = '#141126'
const AUTH_INPUT_BORDER = '#342E58'
const AUTH_FOCUS = '#A89CF2'
const AUTH_PLACEHOLDER = '#8074C0'

function useStarfield(containerRef, count = 110) {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (container.childElementCount > 0) return // guard against StrictMode double-run

    const frag = document.createDocumentFragment()
    for (let i = 0; i < count; i++) {
      const s = document.createElement('div')
      s.className = 'orbit-star'
      const size = (Math.random() * 2 + 0.6).toFixed(2)
      s.style.width = size + 'px'
      s.style.height = size + 'px'
      s.style.top = Math.random() * 100 + '%'
      s.style.left = Math.random() * 100 + '%'
      s.style.animationDelay = Math.random() * 4 + 's'
      s.style.animationDuration = 3 + Math.random() * 4 + 's'
      frag.appendChild(s)
    }
    container.appendChild(frag)

    return () => { container.innerHTML = '' }
  }, [containerRef, count])
}

/**
 * Shared shell for every auth page (Login, Register, ForgotPassword,
 * etc). Fixed deep-dark background regardless of the theme toggle —
 * this is the one part of the app that intentionally never responds
 * to light/dark mode (see DESIGN.md section 9).
 */
export default function AuthLayout({ children, formMaxWidth = '22.5rem' }) {
  const starsRef = useRef(null)
  useStarfield(starsRef)

  return (
    <main className="auth-orbit">
      {/* full-page starfield, behind both panels */}
      <div className="orbit-stars" ref={starsRef} aria-hidden="true" />

      {/* ===================== LEFT : ORBIT ===================== */}
      <section className="orbit-left" aria-hidden="true">
        <div className="orbit-brand">
          <div className="orbit-brand__logo">
            <LogoSVG size={36} />
          </div>
          <div className="orbit-brand__wordmark">
            <WordmarkSVG width={117} height={18} />
          </div>
        </div>

        <div className="orbit-wrap">
          <div className="orbit-system">

            <div className="orbit-ring ring-outer" />
            <div className="orbit-ring ring-middle" />
            <div className="orbit-ring ring-inner" />

            {/* OUTER ORBIT : 3 nodes */}
            <div className="rotor rotor-outer">
              <div className="slot" style={{ '--angle': '10deg', '--radius': '50cqw' }}>
                <div className="unspin"><div className="counter counter-a"><div className="node-box">
                  <svg viewBox="0 0 24 24">{/* bank */}
                    <line x1="4" y1="21" x2="20" y2="21"/><line x1="6" y1="21" x2="6" y2="11"/>
                    <line x1="10" y1="21" x2="10" y2="11"/><line x1="14" y1="21" x2="14" y2="11"/>
                    <line x1="18" y1="21" x2="18" y2="11"/><path d="M3 11l9-6 9 6"/>
                  </svg>
                </div></div></div>
              </div>
              <div className="slot" style={{ '--angle': '130deg', '--radius': '50cqw' }}>
                <div className="unspin"><div className="counter counter-a"><div className="node-box">
                  <svg viewBox="0 0 24 24">{/* bar chart */}
                    <line x1="6" y1="19" x2="6" y2="13"/><line x1="12" y1="19" x2="12" y2="9"/>
                    <line x1="18" y1="19" x2="18" y2="5"/>
                  </svg>
                </div></div></div>
              </div>
              <div className="slot" style={{ '--angle': '250deg', '--radius': '50cqw' }}>
                <div className="unspin"><div className="counter counter-a"><div className="node-box">
                  <svg viewBox="0 0 24 24">{/* trending up */}
                    <polyline points="4,17 10,11 14,15 20,7"/><polyline points="14,7 20,7 20,13"/>
                  </svg>
                </div></div></div>
              </div>
            </div>

            {/* MIDDLE ORBIT : 3 nodes */}
            <div className="rotor rotor-middle">
              <div className="slot" style={{ '--angle': '55deg', '--radius': '34.375cqw' }}>
                <div className="unspin"><div className="counter counter-c"><div className="node-box">
                  <svg viewBox="0 0 24 24">{/* person */}
                    <circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>
                  </svg>
                </div></div></div>
              </div>
              <div className="slot" style={{ '--angle': '175deg', '--radius': '34.375cqw' }}>
                <div className="unspin"><div className="counter counter-c"><div className="node-box">
                  <svg viewBox="0 0 24 24">{/* signature */}
                    <path d="M4 17c1.5-5.5 3-5.5 4.5 0s3-5.5 4.5 0"/><path d="M15 13l4.5-7.5"/>
                  </svg>
                </div></div></div>
              </div>
              <div className="slot" style={{ '--angle': '295deg', '--radius': '34.375cqw' }}>
                <div className="unspin"><div className="counter counter-c"><div className="node-box">
                  <svg viewBox="0 0 24 24">{/* document */}
                    <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/>
                    <path d="M14 3v4h4"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="16" x2="15" y2="16"/>
                  </svg>
                </div></div></div>
              </div>
            </div>

            {/* INNER ORBIT : 3 nodes */}
            <div className="rotor rotor-inner">
              <div className="slot" style={{ '--angle': '70deg', '--radius': '18.75cqw' }}>
                <div className="unspin"><div className="counter counter-a"><div className="node-box">
                  <svg viewBox="0 0 24 24">{/* wallet */}
                    <path d="M3 7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v2h2a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
                    <circle cx="16.6" cy="13.5" r="1.15"/>
                  </svg>
                </div></div></div>
              </div>
              <div className="slot" style={{ '--angle': '190deg', '--radius': '18.75cqw' }}>
                <div className="unspin"><div className="counter counter-a"><div className="node-box">
                  <svg viewBox="0 0 24 24">{/* receipt */}
                    <path d="M6 3h12v17l-2-1-2 1-2-1-2 1-2-1-2 1V3z"/>
                    <line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>
                  </svg>
                </div></div></div>
              </div>
              <div className="slot" style={{ '--angle': '310deg', '--radius': '18.75cqw' }}>
                <div className="unspin"><div className="counter counter-a"><div className="node-box">
                  <svg viewBox="0 0 24 24">{/* credit card */}
                    <rect x="3" y="6" width="18" height="13" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                </div></div></div>
              </div>
            </div>

            <div className="center-logo">
              <LogoSVG size={72} />
            </div>

          </div>
        </div>
      </section>

      {/* ===================== RIGHT : FORM SLOT ===================== */}
      <section className="orbit-right">
        <div className="orbit-form" style={{ '--orbit-form-max': formMaxWidth }}>

          {/* mobile-only brand (left panel is hidden < 860px) */}
          <div className="orbit-form__brand">
            <div className="logo"><LogoSVG size={32} /></div>
            <WordmarkSVG width={107} height={16} />
          </div>

          <div className="orbit-form__body">
            {children}
          </div>
        </div>
      </section>

      {/* Scoped styles (theme fixed: dark/purple orbit) — ported verbatim
          from v1, plus the browser-autofill override added afterward
          (autofill styling can only be reached via CSS, never inline
          styles or JS) and the iOS input-zoom-prevention media query. */}
      <style>{`
        .auth-orbit {
          --page-bg:      #050508;
          --white:        #FFFFFF;
          --subtext:      #C7C7C7;
          --link-purple:  #A89CF2;
          --doto-purple:  #B2A7F4;

          /* Auth pages are pre-login — there's no user/session yet for a
             "theme preference" to even represent, and this palette is
             deliberately fixed regardless of the in-app theme (see
             DESIGN.md). These three are shared, theme-dependent tokens
             (set globally for AppShell's use) that would otherwise leak
             in via WordmarkSVG/LogoSVG and break that fixed palette —
             overridden locally here so the auth pages never depend on
             whatever theme happens to be active elsewhere in the app.
             --logo-body/--logo-mark are already theme-invariant globally,
             but pinned here too as defense against that ever changing. */
          --wordmark: #FFFFFF;
          --logo-body: #8074C0;
          --logo-mark: #050508;

          --ring-line:    rgba(160,135,255,0.28);
          --node-card-bg: rgba(6, 3, 20, 0.32);
          --node-border:  rgba(150,110,255,0.9);
          --node-glow:    rgba(154, 139, 250, 0.5);
          --node-icon:    #ddd3ff;

          position: relative;
          min-height: 100vh;
          display: grid;
          grid-template-columns: 1fr 1fr;
          color: var(--white);
          font-family: 'DM Sans', system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
          background: var(--page-bg);
          background-image:
            radial-gradient(ellipse 70% 55% at 50% 42%, #100a1c 0%, #060309 45%, var(--page-bg) 82%);
          background-attachment: fixed;
          overflow-x: hidden;
        }

        /* ---------- starfield ---------- */
        .orbit-stars {
          position: fixed;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 0;
        }
        .orbit-star {
          position: absolute;
          background: #fff;
          border-radius: 50%;
          opacity: .6;
          animation: orbitTwinkle 4s ease-in-out infinite;
        }
        @keyframes orbitTwinkle {
          0%, 100% { opacity: .15; }
          50%      { opacity: .9; }
        }

        /* ---------- left panel ---------- */
        .orbit-left {
          position: relative;
          overflow: hidden;
          background: transparent;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .orbit-brand {
          position: absolute;
          top: 1.75rem;
          left: 2rem;
          z-index: 6;
          display: flex;
          align-items: center;
          gap: 0.6rem;
          height: 2.2rem;
        }
        .orbit-brand__logo {
          width: 2.2rem; height: 2.2rem;
          display: flex; align-items: center; justify-content: center;
          flex: 0 0 auto;
        }
        .orbit-brand__wordmark { display: flex; align-items: center; }

        /* ---------- orbit system ---------- */
        .orbit-wrap {
          position: relative;
          z-index: 2;
          width: min(72%, 30rem);
          aspect-ratio: 1 / 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .orbit-system {
          position: relative;
          width: 100%;
          height: 100%;
          container-type: size;
        }

        .orbit-ring {
          position: absolute;
          top: 50%; left: 50%;
          border-radius: 50%;
          border: 1px solid var(--ring-line);
          box-shadow: 0 0 40px rgba(120,80,255,0.05);
          transform: translate(-50%, -50%);
        }
        .ring-outer  { width: 100%;   height: 100%;   }
        .ring-middle { width: 68.75%; height: 68.75%; }
        .ring-inner  { width: 37.5%;  height: 37.5%;  }

        .rotor {
          position: absolute;
          top: 50%; left: 50%;
          width: 0; height: 0;
        }
        /* outer & inner share the EXACT same rotor (spin-cw 30s); inner base
           angles = outer + 60deg, so all three rings never align at once.
           middle spins independently (ccw 23s). */
        .rotor-outer  { animation: orbitSpinCw 30s linear infinite; }
        .rotor-inner  { animation: orbitSpinCw 30s linear infinite; }
        .rotor-middle { animation: orbitSpinCcw 23s linear infinite; }

        @keyframes orbitSpinCw  { from { transform: rotate(0deg); } to { transform: rotate(360deg);  } }
        @keyframes orbitSpinCcw { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }

        .counter { position: absolute; top: 0; left: 0; width: 0; height: 0; }
        .counter-a { animation: orbitSpinCcw 30s linear infinite; }
        .counter-c { animation: orbitSpinCw  23s linear infinite; }

        .slot {
          position: absolute;
          top: 0; left: 0;
          width: 0; height: 0;
          transform: rotate(var(--angle)) translate(0, calc(var(--radius) * -1));
        }
        .unspin {
          position: absolute;
          top: 0; left: 0;
          width: 0; height: 0;
          transform: rotate(calc(var(--angle) * -1));
        }

        .node-box {
          position: absolute;
          top: 0; left: 0;
          width: 13cqw;
          height: 13cqw;
          min-width: 56px;
          min-height: 56px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: var(--node-card-bg);
          border: 1px solid var(--node-border);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          box-shadow:
            0 0 18px rgba(0,0,0,0.2),
            inset 0 0 10px var(--node-glow);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .node-box svg {
          width: 46%; height: 46%;
          fill: none;
          stroke: var(--node-icon);
          stroke-width: 1.7;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .center-logo {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 19cqw;
          height: 19cqw;
          min-width: 72px;
          min-height: 72px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 5;
          filter: drop-shadow(0 0 22px rgba(255,255,255,0.45));
        }

        /* ---------- right panel ---------- */
        .orbit-right {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 3rem;
        }
        .orbit-form { width: 100%; max-width: var(--orbit-form-max, 22.5rem); }

        .orbit-form__brand { display: none; }
        .orbit-form__body { margin-top: 0; }

        /* ---------- responsive: stack below 860px ---------- */
        @media (max-width: 860px) {
          .auth-orbit { grid-template-columns: 1fr; }
          .orbit-left { display: none; }

          .orbit-right {
            align-items: flex-start;
            padding: 1.75rem 1.5rem 2rem;
            min-height: 100vh;
            min-height: 100dvh;
          }

          .orbit-form { max-width: 26rem; }

          .orbit-form__brand {
            display: flex;
            align-items: center;
            gap: 0.6rem;
            margin-bottom: 2rem;
          }
          .orbit-form__brand .logo {
            width: 2rem; height: 2rem;
            flex: 0 0 auto;
            display: flex; align-items: center; justify-content: center;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .rotor, .counter, .orbit-star { animation: none !important; }
        }

        /* iOS auto-zoom prevention on auth inputs */
        @media (max-width: 768px) {
          .auth-orbit input { font-size: 16px !important; }
        }

        /* Browser autofill (Chrome/Safari) paints its own background
           behind autofilled inputs, which cannot be overridden via
           inline styles or JS — only this -webkit-autofill CSS hook
           can reach it. */
        .auth-orbit input:-webkit-autofill,
        .auth-orbit input:-webkit-autofill:hover,
        .auth-orbit input:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px ${AUTH_INPUT_BG} inset !important;
          -webkit-text-fill-color: #FFFFFF !important;
          caret-color: #FFFFFF;
          transition: background-color 5000s ease-in-out 0s;
        }
      `}</style>
    </main>
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