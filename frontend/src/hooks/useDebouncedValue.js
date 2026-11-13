// src/hooks/useDebouncedValue.js
//
// Returns `value` after it has stopped changing for `ms` milliseconds. The timer is cleared on every change and on unmount, so
// only the last value of a burst arrives and nothing fires after the component is gone.
import { useEffect, useState } from 'react'

export default function useDebouncedValue(value, ms) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}
