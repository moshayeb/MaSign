import { useEffect, useState, type Ref } from 'react'
import { toast } from 'sonner'
import { listStandardProfiles, setContractStandardProfile, type Contract, type KeyTermSource, type KeyTermValue, type RiskReview, type StandardProfile } from '../api'
import type { SourceRef } from './PassageReader'
import { Timeline } from './Timeline'

interface Props {
  review: RiskReview
  // The contract this card is for; its standard_profile_id drives the
  // picker below (MAS-185). Optional only so the many existing tests that
  // build a bare review fixture keep compiling without one.
  contract?: Contract
  contracts?: Contract[]
  onShowSource?: (source: SourceRef) => void
  // Called after the contract's standard profile changes, so the caller can
  // re-read the review and refresh the contract list (new deviation counts).
  onProfileChanged?: () => void
  // Lets a summary tile scroll to this card (MAS-124).
  ref?: Ref<HTMLElement>
}

// The financial key terms of the selected contract (MAS-82): what is paid,
// when, what late payment and leaving cost, how long it binds — each value
// with the passage that states it. Since MAS-104 only stated terms get a
// tile; the terms that are not stated share one line, so an absence costs a
// few words, not a card. Absence is only called "not stated" when every
// passage was read; otherwise it is "not checked" (honest-outcomes).
export function KeyTermsCard({ review, contract, contracts = [], onShowSource, onProfileChanged, ref }: Props) {
  const running = review.status === 'pending' || review.status === 'running'
  const stated = review.key_terms.filter((t) => t.status === 'found' || t.status === 'conflicting')
  const notStated = review.key_terms.filter((t) => t.status === 'not_stated')
  const unchecked = review.key_terms.filter((t) => t.status === 'unchecked')
  const conflicting = review.key_terms.filter((t) => t.status === 'conflicting')
  const deviations = review.key_terms.filter((t) => t.standard?.status === 'deviates').length
  // Documents the text points to but that were not uploaded: a "not stated"
  // term may live there, so say so next to the group (MAS-84).
  const external = (review.coverage?.external_references ?? []).map((r) => r.name)

  return (
    <section className="card key-terms" aria-live="polite" tabIndex={-1} ref={ref}>
      <div className="answer-header">
        <h2>
          Key terms
          {running && <span className="status running">Extracting…</span>}
          {!running && review.status === 'done' && review.key_terms_complete && (
            <span className={deviations > 0 ? 'status warn' : 'status ok'}>
              {stated.length} of {review.key_terms.length} stated
              {deviations > 0 ? ` · ${deviations} deviate${deviations === 1 ? 's' : ''}` : ''}
            </span>
          )}
          {!running && review.status === 'done' && !review.key_terms_complete && (
            <span className="status warn">
              {stated.length} of {review.key_terms.length} stated · partly checked
            </span>
          )}
          {review.status === 'failed' && <span className="status warn">Not extracted</span>}
        </h2>
        {contract && <StandardProfilePicker contract={contract} onChanged={onProfileChanged} />}
      </div>

      {review.status === 'done' && !review.key_terms_complete && (
        <p className="badge unverified" role="status">
          Some passages could not be checked for key terms{review.chunks_withheld > 0 ? ' (withheld from the model or unreadable reply)' : " (the model's reply was unreadable)"}
          . A term shown as “Not checked” may still be in the contract. Values shown are verified against their passage.
        </p>
      )}
      {review.status === 'failed' && (
        <p className="badge unverified" role="status">
          The review stopped before the key terms were extracted{review.error ? `: ${review.error}` : ''}. Run it again.
        </p>
      )}
      {conflicting.length > 0 && (
        <p className="badge unverified" role="status">
          {conflicting.length === 1 ? 'One term is' : `${conflicting.length} terms are`} stated differently in several passages — read both
          before relying on either.
        </p>
      )}

      {running && stated.length === 0 && <p className="muted small">Reading the passages for fees, deadlines and terms…</p>}

      {stated.length > 0 && (
        <dl className="terms">
          {stated.map((term) => (
            <TermTile key={term.id} term={term} contracts={contracts} onShowSource={onShowSource} reviewingContractId={review.contract_id} />
          ))}
        </dl>
      )}

      {!running && (notStated.length > 0 || unchecked.length > 0) && (
        <ul className="terms-missing">
          {notStated.length > 0 && (
            <li className="not_stated">
              <span className="terms-missing-label">Not stated in the reviewed text</span>
              <span className="terms-missing-names">{notStated.map((t) => t.name).join(', ')}</span>
              {external.length > 0 && <span className="muted small"> — may be in {external.join(' or ')} (not uploaded)</span>}
            </li>
          )}
          {unchecked.length > 0 && (
            <li className="unchecked">
              <span className="terms-missing-label">Not checked</span>
              <span className="terms-missing-names">{unchecked.map((t) => t.name).join(', ')}</span>
            </li>
          )}
        </ul>
      )}

      {review.status === 'done' && <Timeline review={review} contracts={contracts} onShowSource={onShowSource} />}

      <p className="muted disclaimer">
        Each value is quoted from the passage named beside it; nothing is inferred. Deadlines are date arithmetic over those values, standards are
        the Customer-side defaults from the rubric (docs/risk-rubric.md), compared by rule — a first read, not legal advice.
      </p>
    </section>
  )
}

// Where a value (the main source, or one of `others`) came from: the
// document it names only when that document isn't the one being reviewed
// (MAS-190) -- the reviewed contract's own passages read exactly as before.
function sourceInfo(item: KeyTermSource, contracts: Contract[], reviewingContractId: string) {
  const sourceFilename = item.contract_id ? contracts.find((c) => c.contract_id === item.contract_id)?.filename : null
  const isLinkedDocument = Boolean(item.contract_id && item.contract_id !== reviewingContractId)
  return { sourceFilename, isLinkedDocument, passageLabel: `passage ${item.chunk_index + 1}` }
}

function TermTile({ term, contracts, onShowSource, reviewingContractId }: { term: KeyTermValue; contracts: Contract[]; onShowSource?: (source: SourceRef) => void; reviewingContractId: string }) {
  const source = term.source!
  const verdict = term.standard && term.standard.status !== 'none' ? term.standard : null
  const { sourceFilename, isLinkedDocument, passageLabel } = sourceInfo(source, contracts, reviewingContractId)
  return (
    <div className={`term ${term.status}${verdict?.status === 'deviates' ? ' deviates' : ''}`}>
      <dt>
        {term.name}
        {term.status === 'conflicting' && <span className="status warn tiny">Conflicting</span>}
      </dt>
      <dd>
        <span className="term-value">{term.value}</span>
        <span className="term-meta muted small">
          {onShowSource ? (
            <button
              type="button"
              className="link term-source-link"
              onClick={() => onShowSource({ contract_id: source.contract_id, chunk_index: source.chunk_index, quote: source.quote })}
              aria-label={isLinkedDocument ? `Show ${term.name} in ${sourceFilename ?? 'linked document'}, ${passageLabel}` : `Show ${term.name} in contract`}
              title={isLinkedDocument ? `${sourceFilename ?? 'Linked document'}, ${passageLabel}` : undefined}
            >
              {isLinkedDocument ? (
                <>
                  <span className="term-source-document">{sourceFilename ?? 'Linked document'}</span>
                  <span aria-hidden="true"> · {passageLabel}</span>
                </>
              ) : (
                passageLabel
              )}
            </button>
          ) : (
            <>passage {source.chunk_index + 1}</>
          )}
          {verdict && (
            <span
              className={`status ${verdict.status === 'meets' ? 'ok' : verdict.status === 'deviates' ? 'warn' : 'none'}`}
              title={`Your standard: ${verdict.standard ?? ''}`}
            >
              {verdict.status === 'meets' ? 'Meets standard' : verdict.status === 'deviates' ? 'Deviates' : "Can't compare"}
            </span>
          )}
        </span>
        <blockquote className="term-quote">“{source.quote}”</blockquote>
        {verdict && verdict.status !== 'meets' && (
          <p className={`term-standard ${verdict.status} muted small`}>
            {verdict.status === 'deviates' && verdict.detail
              ? `${verdict.detail} — your standard: ${verdict.standard}`
              : `stated, but not as a number the text confirms — your standard: ${verdict.standard}`}
          </p>
        )}
        {term.others.length > 0 && (
          <ul className="term-others">
            {term.others.map((other) => {
              const otherSource = sourceInfo(other, contracts, reviewingContractId)
              return (
                <li key={other.chunk_id} className="muted small">
                  Also stated{otherSource.isLinkedDocument ? ` in ${otherSource.sourceFilename ?? 'a linked document'},` : ' in'}{' '}
                  {onShowSource ? (
                    <button
                      type="button"
                      className="link term-source-link"
                      onClick={() => onShowSource({ contract_id: other.contract_id, chunk_index: other.chunk_index, quote: other.quote })}
                      aria-label={
                        otherSource.isLinkedDocument
                          ? `Show ${term.name} also stated in ${otherSource.sourceFilename ?? 'linked document'}, ${otherSource.passageLabel}`
                          : `Show ${term.name} also stated in contract, ${otherSource.passageLabel}`
                      }
                    >
                      {otherSource.passageLabel}
                    </button>
                  ) : (
                    otherSource.passageLabel
                  )}
                  : “{other.value}”
                </li>
              )
            })}
          </ul>
        )}
      </dd>
    </div>
  )
}

// Which named standard profile (MAS-185) this contract compares against.
// Loads the workspace's profiles once; "Workspace default" is its own
// option (value '') rather than the first profile, since the contract's own
// assignment can be null independently of which profile happens to be
// is_default right now.
function StandardProfilePicker({ contract, onChanged }: { contract: Contract; onChanged?: () => void }) {
  const [profiles, setProfiles] = useState<StandardProfile[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    listStandardProfiles()
      .then((loaded) => {
        if (!cancelled && Array.isArray(loaded)) setProfiles(loaded)
      })
      .catch(() => {
        // Non-essential control; the rest of the card still works without it.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!profiles || profiles.length <= 1) return null

  async function onChange(value: string) {
    setBusy(true)
    try {
      await toast
        .promise(setContractStandardProfile(contract.contract_id, value || null), {
          loading: 'Switching standards profile…',
          success: () => 'Standards profile updated.',
          error: (error: Error) => error.message,
        })
        .unwrap()
      onChanged?.()
    } catch {
      // Already reported by the toast.
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className="key-terms-profile-picker">
      <span className="muted small">Standards profile</span>
      <select
        aria-label="Standards profile"
        value={contract.standard_profile_id ?? ''}
        disabled={busy}
        onChange={(event) => void onChange(event.target.value)}
      >
        <option value="">Workspace default</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
    </label>
  )
}
