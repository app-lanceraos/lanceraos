// src/pages/paymentImportApi.js
//
// The network side of the payment import dialog. Nothing here decides anything: it builds the multipart body and calls
// the four endpoints. The two uploads get a 60 s timeout (the shared instance defaults to 15 s, too short for a 2 MB
// file on a phone connection); the Content-Type override is the same convention the Profile and Signature uploads use.
import api from '@/lib/api'
import { buildUploadForm } from './paymentImportHelpers'

const UPLOAD_OPTIONS = { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }

export async function previewFile({ file, source, mapping }) {
  const { data } = await api.post('/payments/import/preview/', buildUploadForm({ file, source, mapping }), UPLOAD_OPTIONS)
  return data
}

export async function commitImport({ file, source, mapping, fingerprint, includeRows }) {
  const { data } = await api.post(
    '/payments/import/', buildUploadForm({ file, source, mapping, fingerprint, includeRows }), UPLOAD_OPTIONS,
  )
  return data
}

export async function listBatches() {
  const { data } = await api.get('/payments/import/batches/')
  return data
}

export async function undoBatch(id) {
  const { data } = await api.delete(`/payments/import/batches/${id}/`, { data: { confirm: true } })
  return data
}
