// src/components/FormSelect.jsx
import { useId } from 'react'

export default function FormSelect({ label, value, onChange, options, disabled = false, required = false }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="fos-label">
        {label}
        {required && <span className="required">*</span>}
      </label>
      <select id={id} value={value} onChange={onChange} disabled={disabled} className="fos-input fos-select">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}