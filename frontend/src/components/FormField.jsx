// src/components/FormField.jsx
import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export default function FormField({
  label,
  value,
  onChange,
  onFocus,
  type = 'text',
  placeholder,
  disabled = false,
  error,
  hint,
  required = false,
  autoComplete,
  autoFocus,
}) {
  const id = useId()
  const [showPassword, setShowPassword] = useState(false)
  const isPasswordField = type === 'password'
  const resolvedType = isPasswordField && showPassword ? 'text' : type

  return (
    <div>
      <label htmlFor={id} className="fos-label">
        {label}
        {required && <span className="required">*</span>}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          type={resolvedType}
          value={value ?? ''}
          onChange={onChange}
          onFocus={onFocus}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className={`fos-input${error ? ' error' : ''}`}
          style={isPasswordField ? { paddingRight: 40 } : undefined}
        />
        {isPasswordField && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)',
              display: 'flex', padding: 0,
            }}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {hint && !error && <p className="fos-hint">{hint}</p>}
      {error && <p className="fos-error">{error}</p>}
    </div>
  )
}