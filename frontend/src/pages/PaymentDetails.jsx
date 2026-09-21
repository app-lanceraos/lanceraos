// src/pages/PaymentDetails.jsx
//
// /invoice/:token/pay — the public payment-details page. This is where an
// invoice's QR code and "Pay online" link land (Invoice.payment_page_url,
// apps/invoices/models.py): who to pay, how much is still owed, and every
// payment method the freelancer has configured, each field with its own
// Copy button.
//
// Distinct from InvoiceView.jsx (/invoice/:token), which shows the frozen
// invoice DOCUMENT. This page reads the freelancer's CURRENT payment
// details from GET /api/invoices/portal/view/<token>/payment-details/ on
// purpose — see apps/invoices/payment_details.py — and that endpoint has
// no side effects, so simply opening this page never marks the invoice
// "viewed". The "View invoice" link at the bottom goes to the document
// route, which does.
//
// Deliberately NOT here: a "report a payment" form. That already exists
// for saved clients inside ClientPortal.jsx; this page is read-only.
//
// No AppShell; fixed light palette from DESIGN.md Section 10 ("Payment
// Page" is named there), not theme tokens — a public page a client who
// has no LanceraOS account is looking at.
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, Check, CheckCircle2, Clock, Copy, FileText } from 'lucide-react'

import api from '@/lib/api'
import useTitle from '@/hooks/useTitle'

const COPIED_RESET_MS = 2000

function formatAmount(amount, currency) {
  const value = Number(amount || 0)
  return `${currency} ${value.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Terminal statuses' own one-line explanation, shown instead of any
// payment method when the backend says accepts_payment is false.
const NOT_PAYABLE_MESSAGES = {
  paid: 'This invoice has been paid. Nothing more is due.',
  refunded: 'This invoice has been refunded. Nothing is due.',
  cancelled: 'This invoice has been cancelled. Nothing is due.',
  bad_debt: 'This invoice is closed. Please contact the sender directly about it.',
}

function CopyButton({ label, value }) {
  // 'idle' | 'copied' | 'failed'
  const [state, setState] = useState('idle')
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function handleCopy() {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      // navigator.clipboard is missing outside a secure context and can
      // reject on a denied permission — say so rather than pretending.
      setState('failed')
    }
    timer.current = setTimeout(() => setState('idle'), COPIED_RESET_MS)
  }

  const copied = state === 'copied'
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      style={{ ...copyButtonStyle, ...(copied ? copyButtonCopiedStyle : null) }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span role="status">{copied ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}</span>
    </button>
  )
}

function PaymentMethod({ method }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#1e3a5f' }}>
        {method.label}
      </h2>
      <div style={{ border: '1px solid rgba(0,0,0,.08)', borderRadius: 12, overflow: 'hidden' }}>
        {method.fields.map((field, i) => (
          <div
            key={field.label}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
              padding: '12px 14px', borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,.07)',
            }}
          >
            <div style={{ minWidth: 0, flex: '1 1 160px' }}>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#64748b' }}>{field.label}</p>
              <p style={{ margin: '2px 0 0', fontSize: '0.95rem', fontWeight: 600, color: '#334155', wordBreak: 'break-all' }}>
                {field.value}
              </p>
            </div>
            <CopyButton label={field.label} value={field.value} />
          </div>
        ))}
      </div>
    </section>
  )
}

function Notice({ icon: Icon, iconColor, title, children }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 0' }}>
      <Icon size={28} style={{ color: iconColor, marginBottom: 10 }} />
      <p style={{ margin: 0, fontSize: '0.95rem', color: '#334155', fontWeight: 600 }}>{title}</p>
      {children && <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: '#64748b' }}>{children}</p>}
    </div>
  )
}

export default function PaymentDetails() {
  const { token } = useParams()
  // 'loading' | 'ready' | 'not_found' | 'rate_limited' | 'error'
  const [state, setState] = useState('loading')
  const [details, setDetails] = useState(null)

  useTitle(details?.invoice_number ? `Pay ${details.invoice_number} — LanceraOS` : 'Payment details — LanceraOS')

  useEffect(() => {
    const controller = new AbortController()
    api.get(`/invoices/portal/view/${token}/payment-details/`, { signal: controller.signal })
      .then(({ data }) => {
        setDetails(data)
        setState('ready')
      })
      .catch((e) => {
        if (e.code === 'ERR_CANCELED') return
        const code = e.response?.status
        setState(code === 404 ? 'not_found' : code === 429 ? 'rate_limited' : 'error')
      })
    return () => controller.abort()
  }, [token])

  return (
    <div style={pageWrapStyle}>
      <main style={cardStyle}>
        {state === 'loading' && (
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b', textAlign: 'center' }}>Loading payment details…</p>
        )}

        {state === 'not_found' && (
          <Notice icon={AlertCircle} iconColor="#c0392b" title="This payment link is invalid or no longer available." />
        )}

        {state === 'rate_limited' && (
          <Notice icon={Clock} iconColor="#8a7d5c" title="Too many requests." >Please try again in a little while.</Notice>
        )}

        {state === 'error' && (
          <Notice icon={AlertCircle} iconColor="#c0392b" title="Couldn't load the payment details.">Please check your connection and try again.</Notice>
        )}

        {state === 'ready' && details && (
          <>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Pay</p>
            <h1 style={{ margin: '2px 0 0', fontSize: '1.25rem', fontWeight: 700, color: '#1e3a5f', wordBreak: 'break-word' }}>
              {details.business_name}
            </h1>

            <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid rgba(0,0,0,.07)' }}>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#64748b' }}>
                {details.accepts_payment ? 'Amount due' : 'Invoice total'}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '1.6rem', fontWeight: 700, color: '#1e3a5f' }}>
                {formatAmount(details.accepts_payment ? details.outstanding_amount : details.total, details.currency)}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                Invoice {details.invoice_number || '(unnumbered)'}
                {details.accepts_payment && details.outstanding_amount !== details.total
                  ? ` · Total ${formatAmount(details.total, details.currency)}`
                  : ''}
              </p>
            </div>

            {!details.accepts_payment && (
              <div style={{ marginTop: 20 }}>
                <Notice icon={CheckCircle2} iconColor="#00c896" title={NOT_PAYABLE_MESSAGES[details.status] || 'No payment is due on this invoice.'} />
              </div>
            )}

            {details.accepts_payment && details.payment_methods.length === 0 && (
              <div style={{ marginTop: 20 }}>
                <Notice icon={AlertCircle} iconColor="#8a7d5c" title="No payment details are on file yet.">
                  Please contact {details.business_name} directly to arrange payment.
                </Notice>
              </div>
            )}

            {details.accepts_payment && details.payment_methods.map((method) => (
              <PaymentMethod key={method.key} method={method} />
            ))}

            {details.accepts_payment && details.payment_methods.length > 0 && (
              <p style={{ margin: '20px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                Use invoice number {details.invoice_number || 'above'} as the payment reference if your bank lets you add one.
              </p>
            )}

            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid rgba(0,0,0,.07)' }}>
              <Link to={`/invoice/${token}`} style={viewInvoiceLinkStyle}>
                <FileText size={14} /> View invoice
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

const pageWrapStyle = {
  minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  padding: '32px 16px', background: '#f8fafc', boxSizing: 'border-box',
  fontFamily: "'DM Sans', sans-serif",
}

const cardStyle = {
  width: '100%', maxWidth: 480, boxSizing: 'border-box',
  background: '#ffffff', border: '1px solid rgba(0,0,0,.08)', borderRadius: 12,
  boxShadow: '0 2px 12px rgba(0,0,0,.07)', padding: '28px 24px',
}

const copyButtonStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
  padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,.12)', cursor: 'pointer',
  background: '#ffffff', color: '#1e3a5f', fontSize: '0.78rem', fontWeight: 600,
  fontFamily: "'DM Sans', sans-serif",
}

// Navy text on a teal tint, not white on the #00c896 accent — white on
// that teal is only ~2:1 contrast.
const copyButtonCopiedStyle = {
  background: 'rgba(0,200,150,.14)', borderColor: '#00c896', color: '#1e3a5f',
}

const viewInvoiceLinkStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: '0.82rem', fontWeight: 600, color: '#2e5987', textDecoration: 'none',
}
