import type { Contract, RiskReview } from '../api'
import { allPast, buildTimeline, hasAnyDate, standings } from '../timeline'
import type { SourceRef } from './PassageReader'

interface Props {
  review: RiskReview
  contracts?: Contract[]
  onShowSource?: (source: SourceRef) => void
  // Injectable so the tests do not depend on the day they run.
  today?: Date
}

const NOTICE_SOON_DAYS = 90
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The contract's dates as a line rather than a heap of tiles (MAS-110):
// effective date → notice deadline → term end → first renewal. A milestone
// that could not be established keeps its place and says why; the line is
// never drawn as if a contract had no dates when it simply was not read.
export function Timeline({ review, contracts = [], onShowSource, today = new Date() }: Props) {
  const milestones = buildTimeline(review)
  const standing = standings(milestones, today)
  const known = hasAnyDate(milestones)
  const finished = allPast(milestones, today)

  return (
    <section className="timeline-wrap" aria-labelledby="timeline-heading">
      <h3 id="timeline-heading">Timeline</h3>
      {!known && (
        <p className="muted small">
          No dates could be established from the reviewed text, so there is no timeline to draw — the reasons are below, term by term.
        </p>
      )}
      <ol className={`timeline${known ? '' : ' undated'}`} aria-label="Contract timeline">
        {milestones.map((milestone) => {
          const state = standing.get(milestone.id)!
          const soon = milestone.id === 'notice_deadline' && !state.past && state.daysAway !== null && state.daysAway <= NOTICE_SOON_DAYS
          const classes = ['milestone', milestone.date ? '' : 'undated', state.past ? 'past' : '', state.next ? 'next' : '', soon ? 'soon' : '']
          return (
            <li
              key={milestone.id}
              className={classes.filter(Boolean).join(' ')}
              title={milestone.how ? `${milestone.how} — arithmetic over the key terms, not a quote` : undefined}
            >
              <span className="milestone-dot" aria-hidden="true" />
              <span className="milestone-body">
                <span className="milestone-name">
                  {state.past && milestone.id === 'notice_deadline' ? 'Notice was due' : milestone.name}
                </span>
                {milestone.date ? (
                  <>
                    <strong className="milestone-date">{formatISO(milestone.date)}</strong>
                    <span className="milestone-tags">
                      {soon && (
                        <span className="status warn">
                          in {state.daysAway} day{state.daysAway === 1 ? '' : 's'}
                        </span>
                      )}
                      {state.past && <span className="status none">passed</span>}
                      {state.next && !soon && <span className="status ok">next</span>}
                    </span>
                    {milestone.how && <span className="muted small milestone-how">{milestone.how}</span>}
                    {milestone.source && onShowSource && (
                      <button
                        type="button"
                        className="link"
                        onClick={() => onShowSource(milestone.source!)}
                        aria-label={`Show ${milestone.name.toLowerCase()} in contract`}
                      >
                        {milestone.source.contract_id ? `${contracts.find((item) => item.contract_id === milestone.source!.contract_id)?.filename ?? 'contract'}, passage ${milestone.source.chunk_index + 1}` : `passage ${milestone.source.chunk_index + 1}`}
                      </button>
                    )}
                  </>
                ) : (
                  <span className="muted small milestone-missing">cannot compute: {milestone.reason}</span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
      {finished && <p className="muted small">Every date above is in the past; the initial term and its first renewal have run their course.</p>}
    </section>
  )
}

// "28 Feb 2029", independent of the browser's locale — the same form the
// deadline formulas use, so a date and its arithmetic read as one sentence.
function formatISO(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : iso
}
