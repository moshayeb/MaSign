import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { linkContract, unlinkContract, uploadContract, type Contract, type ContractLink, type ExternalReference } from '../api'

interface Props {
  primary: Contract
  links: ContractLink[]
  references: ExternalReference[]
  contracts: Contract[]
  onChanged: () => void
  onUploaded: (contract: Contract) => void
}

// A reference is only resolved after the person reviewing it confirms the
// exact source name and document. Filename similarity is never a decision.
export function ContractLinks({ primary, links, references, contracts, onChanged, onUploaded }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [candidate, setCandidate] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<{ reference: string; contract: Contract } | null>(null)
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const choices = contracts.filter((contract) => contract.contract_id !== primary.contract_id)

  async function confirmLink() {
    if (!confirming) return
    const { reference, contract } = confirming
    try {
      await toast.promise(linkContract(primary.contract_id, contract.contract_id, reference), {
        loading: `Linking ${contract.filename}…`,
        success: `${contract.filename} linked as ${reference}.`,
        error: (error: Error) => error.message,
      }).unwrap()
      setConfirming(null)
      onChanged()
    } catch {
      // The toast carries the API detail verbatim.
    }
  }

  async function remove(link: ContractLink) {
    try {
      await toast.promise(unlinkContract(link.primary_contract_id, link.id), {
        loading: `Unlinking ${link.reference_name}…`,
        success: `${link.reference_name} is no longer linked. Review it again before relying on the result.`,
        error: (error: Error) => error.message,
      }).unwrap()
      onChanged()
    } catch {
      // The toast carries the API detail verbatim.
    }
  }

  async function uploadForReference(file: File, reference: string) {
    setUploadingFor(reference)
    try {
      const uploaded = await toast.promise(uploadContract(file), {
        loading: `Uploading ${file.name}…`,
        success: (item) => `${item.filename} uploaded — choose Confirm link to attach it.`,
        error: (error: Error) => error.message,
      }).unwrap()
      onUploaded(uploaded)
      setConfirming({ reference, contract: uploaded })
    } catch {
      // The toast carries the API detail verbatim.
    } finally {
      setUploadingFor(null)
      if (input.current) input.current.value = ''
    }
  }

  if (references.length === 0 && links.length === 0) return null
  return (
    <section className="contract-links" aria-label="Related documents">
      {references.map((reference) => (
        <div key={reference.name} className="link-action link-action-unresolved">
          <div className="link-action-copy">
            <h3>{reference.name}</h3>
            <p>Choose an uploaded document to add it to this review.</p>
          </div>
          <div className="link-action-main">
            <label>
              <span className="sr-only">Choose a document to link as {reference.name}</span>
              <select value={candidate[reference.name] ?? ''} onChange={(event) => setCandidate({ ...candidate, [reference.name]: event.target.value })}>
                <option value="">Choose an uploaded document</option>
                {choices.map((contract) => <option key={contract.contract_id} value={contract.contract_id}>{contract.filename}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="primary link-confirm-button"
              disabled={!candidate[reference.name]}
              onClick={() => {
                const contract = choices.find((item) => item.contract_id === candidate[reference.name])
                if (contract) setConfirming({ reference: reference.name, contract })
              }}
            >
              Link document
            </button>
          </div>
          <div className="link-action-alternative">
            <span className="muted">Do not have it uploaded?</span>
            <input
              ref={input}
              hidden
              type="file"
              accept=".txt,.pdf,.docx"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadForReference(file, reference.name)
              }}
            />
            <button type="button" className="link" disabled={uploadingFor !== null} onClick={() => input.current?.click()}>
              {uploadingFor === reference.name ? 'Uploading...' : 'Upload a document'}
            </button>
            <span className="muted small">Upload starts its normal review (about 2 model calls for up to 8 passages).</span>
          </div>
        </div>
      ))}
      {links.map((link) => (
        <div key={link.id} className="link-action">
          <span><strong>{link.reference_name}</strong> linked</span>
          <button type="button" className="link" onClick={() => void remove(link)}>Unlink</button>
        </div>
      ))}
      {confirming && (
        <div className="confirm-box" role="dialog" aria-modal="true" aria-label="Confirm document link">
          <p>Link <strong>{confirming.contract.filename}</strong> as the <strong>{confirming.reference}</strong> referenced in {primary.filename}?</p>
          <p className="muted small">This is explicit. MaSign will not match documents automatically. If this was uploaded here, its normal review has already started.</p>
          <button type="button" className="primary" onClick={() => void confirmLink()}>Confirm link</button>
          <button type="button" className="link" onClick={() => setConfirming(null)}>Cancel</button>
        </div>
      )}
    </section>
  )
}
