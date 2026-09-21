import { useEffect, useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'
import { uploadContract, type UploadResult } from '../api'

interface Props {
  onUploaded: (contract: UploadResult) => void
}

const ACCEPT = '.txt,.pdf,.docx'

// A compact "+ New contract" action (MAS-104): the dropzone only opens when
// asked for, or when a file is dropped on the closed card, and closes again
// after a successful upload.
export function UploadForm({ onUploaded }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  // Opening puts the cursor on the file field, so keyboard users land in the form.
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  async function submit(chosen: File) {
    setBusy(true)
    try {
      // One toast follows the upload from "uploading" to its outcome; the
      // error branch shows the API's detail verbatim (docs/frontend.md).
      const contract = await toast
        .promise(uploadContract(chosen), {
          loading: `Uploading ${chosen.name}…`,
          success: (c) => `${c.filename} uploaded — ${c.chunk_count} chunk${c.chunk_count === 1 ? '' : 's'}`,
          error: (e: Error) => e.message,
        })
        .unwrap()
      onUploaded(contract)
      setOpen(false)
    } catch {
      // Already reported by the toast; the form stays open for another try.
    } finally {
      setBusy(false)
      setFile(null)
      if (input.current) input.current.value = ''
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDragging(false)
    if (busy) return
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) {
      setFile(dropped)
      setOpen(true)
    }
  }

  return (
    <section
      className={dragging ? 'card upload dragging' : 'card upload'}
      onDragOver={(event) => {
        event.preventDefault()
        if (!busy) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <button type="button" className="primary block new-contract" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">+</span> New contract
      </button>
      {open && (
        <form
          className="upload-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (file) void submit(file)
          }}
        >
          <label htmlFor="contract-file" className="dropzone">
            <input
              id="contract-file"
              ref={input}
              type="file"
              accept={ACCEPT}
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              aria-label="Contract file (TXT, PDF or DOCX, up to 10 MB)"
            />
            <span className="dropzone-text">
              {file ? (
                <strong>{file.name}</strong>
              ) : (
                <>
                  <strong>Choose a file</strong> or drop it here
                </>
              )}
            </span>
            <span className="muted small">TXT, PDF or DOCX · up to 10 MB</span>
          </label>
          <div className="upload-actions">
            <button type="button" className="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !file}>
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
