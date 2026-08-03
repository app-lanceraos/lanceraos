// src/components/SaveButton.jsx
export default function SaveButton({ onClick, disabled, saving, label = 'Save Changes' }) {
  // Renders nothing at all until there's an actual change to save —
  // deliberately changed from the earlier "always visible, disabled,
  // reads 'No Changes'" convention (see STANDARDS.md/DECISIONS.md).
  // Saving still needs to render even though `disabled` may be true
  // during the save itself (disabled={disabled || saving} upstream),
  // so the in-flight spinner doesn't disappear mid-save.
  if (disabled && !saving) return null

  return (
    <button onClick={onClick} disabled={disabled || saving} className="fos-btn fos-btn-accent" style={{ padding: '9px 22px' }}>
      {saving ? (
        <>
          <span className="fos-spinner" /> Saving…
        </>
      ) : (
        label
      )}
    </button>
  )
}