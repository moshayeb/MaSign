import { useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'
import { uploadContract, type UploadResult } from '../api'

interface Props {
  onUploaded: (contract: UploadResult) => void
}

const ACCEPT = '.txt,.pdf,.docx'

export function UploadForm({ onUploaded }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  async function submit(chosen: File) {
    setBusy(true)
    try {
      // One toast follows the upload from "uploading" to its outcome; the
      // error branch shows the API's detail verbatim (docs/frontend.md).
      const contract = await toast.promise(uploadContract(chosen), {
        loading: `Uploading ${chosen.name}…`,
        success: (c) => `${c.filename} uploaded — ${c.chunk_count} chunk${c.chunk_count === 1 ? '' : 's'}`,
        error: (e: Error) => e.message,
      }).unwrap()
      onUploaded(contract)
    } catch {
      // Already reported by the toast.
    } finally {
      setBusy(false)
      setFile(null)
      if (input.current) input.current.value = ''
    }
  }

  function onDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault()
    setDragging(false)
    if (busy) return
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) setFile(dropped)
  }

  return (
    <form
      className={dragging ? 'card upload dragging' : 'card upload'}
      onSubmit={(event) => {
        event.preventDefault()
        if (file) void submit(file)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        if (!busy) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <h2 className="card-title">Upload a contract</h2>
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
      <button type="submit" className="primary block" disabled={busy || !file}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  )
}
