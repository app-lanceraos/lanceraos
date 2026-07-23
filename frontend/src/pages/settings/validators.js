// src/pages/settings/validators.js

/**
 * These are first-line UX checks only, to catch obvious format mistakes
 * before a network round-trip — the backend (set_cnic/set_ntn/set_pseb
 * in models.py) is the real authority, including the cross-account
 * uniqueness check these validators can't perform client-side.
 *
 * NOTE: v1's NTN validator only accepted exactly 7 digits. The actual
 * backend accepts 7 OR 8 digits (confirmed by
 * apps/users/tests/test_models.py::test_ntn_accepts_seven_or_eight_digits).
 * Matching that exactly here, not v1's stricter (wrong) rule.
 */
export const validators = {
  cnic: (v) => {
    if (!v) return null
    const digits = v.replace(/-/g, '')
    return /^\d{13}$/.test(digits) ? null : 'CNIC must be 13 digits (XXXXX-XXXXXXX-X)'
  },
  ntn: (v) => {
    if (!v) return null
    const digits = v.replace(/-/g, '')
    return /^\d{7,8}$/.test(digits) ? null : 'NTN must be 7 or 8 digits'
  },
  pseb: (v) => {
    if (!v) return null
    return v.length >= 4 ? null : 'PSEB number is too short'
  },
  phone: (v) => {
    if (!v) return null
    return /^(\+92|0)[0-9]{10}$/.test(v.replace(/\s/g, '')) ? null : 'Enter a valid Pakistani number, e.g. +923001234567'
  },
  bank_account: (v) => {
    if (!v) return null
    return /^\d{10,24}$/.test(v.replace(/\s/g, '')) ? null : 'Must be 10–24 digits'
  },
  jazzcash: (v) => {
    if (!v) return null
    return /^(03\d{9}|\+923\d{9})$/.test(v.replace(/\s/g, '')) ? null : 'e.g. 03001234567'
  },
  easypaisa: (v) => {
    if (!v) return null
    return /^(03\d{9}|\+923\d{9})$/.test(v.replace(/\s/g, '')) ? null : 'e.g. 03001234567'
  },
  payoneer_email: (v) => {
    if (!v) return null
    return /\S+@\S+\.\S+/.test(v) ? null : 'Enter a valid email address'
  },
}

export function formatCNIC(value) {
  const digits = value.replace(/\D/g, '').slice(0, 13)
  if (digits.length <= 5) return digits
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`
}