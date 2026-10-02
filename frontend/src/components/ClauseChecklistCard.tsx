import type { ClauseResult, ClauseSource, Contract, PolicyResult, RiskReview } from '../api'
import type { SourceRef } from './PassageReader'

interface Props {
  review: RiskReview
  contracts?: Contract[]
  onShowSource?: (source: SourceRef) => void
}

// The expected-clause checklist (MAS-188): for each clause the contract's
// active standard profile checks for, whether the reviewed text states it,
// with the passage that states it when it does. A clause reads "not in the
// reviewed text" only once every passage was checked against the checklist;
// an incomplete pass says "not checked" instead, never "absent"
// (honest-outcomes, same discipline as KeyTermsCard).
export function ClauseChecklistCard({ review, contracts = [], onShowSource }: Props) {
  const clauses = review.clauses ?? []
  if (clauses.length === 0) return null
  const present = clauses.filter((c) => c.status === 'present')
  const absent = clauses.filter((c) => c.status === 'absent')
  const cannotTell = clauses.filter((c) => c.status === 'cannot_tell')
  // Policy-content rules (MAS-192): a verdict on what a present clause
  // actually says, keyed by clause id. Only clauses with a configured rule
  // appear here at all -- `not_applicable` (clause absent/cannot_tell) is
  // still possible but never shown, since there is nothing to show for a
  // clause this card doesn't render as present.
  const policyByClause = new Map((review.policy ?? []).map((p) => [p.id, p]))

  return (
    <section className="card clause-checklist" aria-live="polite">
      <div className="answer-header">
        <h2>
          Expected clauses
          <span className={absent.length > 0 || cannotTell.length > 0 ? 'status warn' : 'status ok'}>
            {present.length} of {clauses.length} present{!review.clauses_complete ? ' · partly checked' : ''}
          </span>
        </h2>
      </div>

      {!review.clauses_complete && (
        <p className="badge unverified" role="status">
          Some passages could not be checked against the clause checklist. A clause shown as "Not checked" may still be in the contract.
        </p>
      )}

      {present.length > 0 && (
        <dl className="terms">
          {present.map((clause) => (
            <ClauseTile
              key={clause.id}
              clause={clause}
              policy={policyByClause.get(clause.id)}
              contracts={contracts}
              onShowSource={onShowSource}
              reviewingContractId={review.contract_id}
            />
          ))}
        </dl>
      )}

      {(absent.length > 0 || cannotTell.length > 0) && (
        <ul className="terms-missing">
          {absent.length > 0 && (
            <li className="not_stated">
              <span className="terms-missing-label">Not in the reviewed text</span>
              <span className="terms-missing-names">{absent.map((c) => c.name).join(', ')}</span>
            </li>
          )}
          {cannotTell.length > 0 && (
            <li className="unchecked">
              <span className="terms-missing-label">Not checked</span>
              <span className="terms-missing-names">{cannotTell.map((c) => c.name).join(', ')}</span>
            </li>
          )}
        </ul>
      )}

      <p className="muted disclaimer">
        A clause counts as present only when the reviewed text quotes it; whether its terms are adequate is the risk review's job above, not this checklist.
      </p>
    </section>
  )
}

// Where a clause's source (the main one, or one of `others`) came from: the
// document it names only when that document isn't the one being reviewed
// (same rule as KeyTermsCard's sourceInfo, MAS-190).
function sourceInfo(item: ClauseSource, contracts: Contract[], reviewingContractId: string) {
  const sourceFilename = contracts.find((c) => c.contract_id === item.contract_id)?.filename
  const isLinkedDocument = item.contract_id !== reviewingContractId
  return { sourceFilename, isLinkedDocument, passageLabel: `passage ${item.chunk_index + 1}` }
}

const POLICY_STATUS_LABEL: Record<string, string> = {
  compliant: 'Meets policy',
  violated: 'Policy violation',
  cannot_tell: 'Policy not checked',
}

function ClauseTile({
  clause,
  policy,
  contracts,
  onShowSource,
  reviewingContractId,
}: {
  clause: ClauseResult
  policy?: PolicyResult
  contracts: Contract[]
  onShowSource?: (source: SourceRef) => void
  reviewingContractId: string
}) {
  const source = clause.source!
  const { sourceFilename, isLinkedDocument, passageLabel } = sourceInfo(source, contracts, reviewingContractId)
  // not_applicable shouldn't reach here (the clause this tile renders is
  // always present), but guard anyway rather than show a misleading pill.
  const showPolicy = policy && policy.status !== 'not_applicable'
  return (
    <div className="term present">
      <dt>
        {clause.name}
        {showPolicy && (
          <span className={`status ${policy!.status === 'compliant' ? 'ok' : 'warn'}`} title={policy!.rule_text}>
            {POLICY_STATUS_LABEL[policy!.status]}
          </span>
        )}
      </dt>
      <dd>
        <span className="term-meta muted small">
          {onShowSource ? (
            <button
              type="button"
              className="link term-source-link"
              onClick={() => onShowSource({ contract_id: source.contract_id, chunk_index: source.chunk_index, quote: source.quote })}
              aria-label={isLinkedDocument ? `Show ${clause.name} in ${sourceFilename ?? 'linked document'}, ${passageLabel}` : `Show ${clause.name} in contract`}
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
        </span>
        <blockquote className="term-quote">“{source.quote}”</blockquote>
        {clause.others.length > 0 && (
          <ul className="term-others">
            {clause.others.map((other) => {
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
                          ? `Show ${clause.name} also stated in ${otherSource.sourceFilename ?? 'linked document'}, ${otherSource.passageLabel}`
                          : `Show ${clause.name} also stated in contract, ${otherSource.passageLabel}`
                      }
                    >
                      {otherSource.passageLabel}
                    </button>
                  ) : (
                    otherSource.passageLabel
                  )}
                  : “{other.quote}”
                </li>
              )
            })}
          </ul>
        )}
      </dd>
    </div>
  )
}
