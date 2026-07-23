// src/components/SaveButton.jsx
export default function SaveButton({ onClick, disabled, saving, label = 'Save Changes' }) {
  return (
    <button onClick={onClick} disabled={disabled || saving} className="fos-btn fos-btn-accent" style={{ padding: '9px 22px' }}>
      {saving ? (
        <>
          <span className="fos-spinner" /> Saving…
        </>
      ) : disabled ? (
        'No Changes'
      ) : (
        label
      )}
    </button>
  )
}