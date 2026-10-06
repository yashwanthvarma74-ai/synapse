'use client'
import { useState } from 'react'
import { api } from '@/lib/api'

// "Summarize this board": the server sends the text to an AI service and returns a short summary.
// The result is shown as plain text (never as HTML), because it is generated from content anyone
// with edit access could have written.
export default function Summary({ docId, type }: { docId: string; type: 'doc' | 'canvas' }) {
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const what = type === 'canvas' ? 'board' : 'document'

  async function run() {
    setBusy(true)
    setError('')
    try {
      // give the editor's last keystrokes a moment to reach the server, which reads the saved copy
      await new Promise((r) => setTimeout(r, 400))
      setSummary((await api<{ summary: string }>(`/documents/${docId}/summarize`, { method: 'POST', body: {} })).summary)
    } catch (e) {
      setSummary('')
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Summary" className="panel">
      <h2>Summary</h2>
      <p className="muted">Get a short summary of this {what}. The text of this {what} is sent to an AI service to write it.</p>
      <button className="btn" onClick={run} disabled={busy}>{busy ? 'Writing a summary…' : `Summarize this ${what}`}</button>
      {error && <p role="alert" className="error">{error}</p>}
      <div role="status" aria-live="polite">
        {summary && (
          <>
            <p className="muted" style={{ marginBottom: 4 }}>Written by AI. It can make mistakes, so check it against the {what}.</p>
            <pre className="summary-text">{summary}</pre>
          </>
        )}
      </div>
    </section>
  )
}
