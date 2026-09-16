import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { uploadContract, type UploadResult } from '../api'

interface Props {
  onUploaded: (contract: UploadResult) => void
}

const ACCEPT = '.txt,.pdf,.docx'

export function UploadForm({ onUploaded }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [hasFile, setHasFile] = useState(false)

  async function submit(file: File) {
    setBusy(true)
    try {
      // One toast follows the upload from "uploading" to its outcome; the
      // error branch shows the API's detail verbatim (docs/frontend.md).
      const contract = await toast.promise(uploadContract(file), {
        loading: `Uploading ${file.name}…`,
        success: (c) => `${c.filename} uploaded — ${c.chunk_count} chunk${c.chunk_count === 1 ? '' : 's'}`,
        error: (e: Error) => e.message,
      }).unwrap()
      onUploaded(contract)
    } catch {
      // Already reported by the toast.
    } finally {
      setBusy(false)
      setHasFile(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <form
      className="upload"
      onSubmit={(event) => {
        event.preventDefault()
        const file = input.current?.files?.[0]
        if (file) void submit(file)
      }}
    >
      <label htmlFor="contract-file">Contract file (TXT, PDF or DOCX, up to 10 MB)</label>
      <div className="upload-row">
        <input
          id="contract-file"
          ref={input}
          type="file"
          accept={ACCEPT}
          disabled={busy}
          onChange={(event) => setHasFile((event.target.files?.length ?? 0) > 0)}
        />
        <button type="submit" disabled={busy || !hasFile}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </div>
    </form>
  )
}
