// src/components/AuthField.jsx
import { useId } from 'react'
import { authTokens } from './AuthLayout'

/**
 * Shared floating-label input for every auth page. Uses CSS's
 * `:not(:placeholder-shown)` + a `::before` notch to hide the border
 * behind the floated label — see DECISIONS.md for why this scoped
 * <style> block is a deliberate, documented exception to the "no
 * per-page style blocks" rule (this is a shared component, not a page,
 * and the mechanism genuinely can't be done via inline styles/JS).
 */
export default function AuthField({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  disabled = false,
  icon: Icon,
  rightElement,
  error,
}) {
  const id = useId()
  const borderColor = error ? authTokens.error : authTokens.inputBorder

  return (
    <div className="af-wrap">
      <div className={`af-field ${Icon ? 'af-field--icon' : ''} ${error ? 'af-field--error' : ''} ${rightElement ? 'af-field--right' : ''}`}>
        {Icon && (
          <span className="af-field__icon" aria-hidden="true">
            <Icon size={18} />
          </span>
        )}

        <input
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          disabled={disabled}
          placeholder=" " // IMPORTANT: single space for :placeholder-shown trick
        />
        <label htmlFor={id}>{label}</label>

        {rightElement && <div className="af-field__right">{rightElement}</div>}
      </div>

      {error && <p className="af-error">{error}</p>}

      <style>{`
        .af-wrap { position: relative; width: 100%; }
        .af-field { position: relative; width: 100%; }

        .af-field input {
          width: 100%;
          height: 3.1rem;
          background: ${authTokens.inputBg};
          border: 1px solid ${borderColor};
          border-radius: 10px;
          padding: 0 1rem;
          font-family: 'DM Sans', sans-serif;
          font-size: 0.875rem;
          line-height: 1.15rem;
          color: #FFFFFF;
          outline: none;
          transition: border-color 0.2s ease;
        }
        .af-field input:focus { border-color: ${authTokens.focus}; }
        .af-field--error input { border-color: ${authTokens.error} !important; }

        .af-field--icon input { padding-left: 2.85rem; }
        .af-field--right input { padding-right: 2.85rem; }

        .af-field__icon {
          position: absolute;
          left: 1rem; top: 50%;
          transform: translateY(-50%);
          color: ${authTokens.placeholder};
          pointer-events: none;
          display: flex; z-index: 2;
        }

        .af-field__right {
          position: absolute;
          right: 0.9rem; top: 50%;
          transform: translateY(-50%);
          z-index: 3; display: flex;
        }

        .af-field label {
          position: absolute;
          left: ${Icon ? '2.85rem' : '1rem'};
          top: 50%;
          transform: translateY(-50%);
          font-size: 0.875rem;
          line-height: 1.15rem;
          color: ${authTokens.placeholder};
          pointer-events: none;
          transition: top 0.18s ease, font-size 0.18s ease, left 0.18s ease;
          z-index: 2;
        }

        /* This is the notch that hides the border */
        .af-field label::before {
          content: "";
          position: absolute;
          left: -4px; right: -4px; top: 50%;
          height: 2px;
          background: ${authTokens.inputBg};
          transform: translateY(-50%) scaleX(0);
          transition: transform 0.18s ease;
          z-index: -1;
        }

        .af-field input:focus + label,
        .af-field input:not(:placeholder-shown) + label {
          top: 0;
          left: 0.75rem;
          font-size: 0.75rem;
        }

        .af-field input:focus + label::before,
        .af-field input:not(:placeholder-shown) + label::before {
          transform: translateY(-50%) scaleX(1);
        }

        .af-error {
          margin-top: 6px;
          font-size: 0.78rem;
          color: ${authTokens.error};
        }

        /* autofill fix */
        .af-field input:-webkit-autofill {
          -webkit-text-fill-color: #FFFFFF;
          -webkit-box-shadow: 0 0 0 1000px ${authTokens.inputBg} inset;
          caret-color: #FFFFFF;
          transition: background-color 5000s ease-in-out 0s;
        }

        @media (max-width: 860px) {
          .af-field input { font-size: 16px; }
          .af-field label { font-size: 16px; }
          .af-field input:focus + label,
          .af-field input:not(:placeholder-shown) + label { font-size: 0.8rem; }
        }
      `}</style>
    </div>
  )
}