import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  listStandardProfiles, createStandardProfile, renameStandardProfile, setDefaultStandardProfile, deleteStandardProfile,
  listProfileStandards, saveProfileStandard, resetProfileStandard,
  listProfileClauses, setProfileClauseEnabled,
  listProfilePolicyRules, setProfilePolicyRule, deleteProfilePolicyRule,
  type ClauseConfig, type PolicyRule, type Standard, type StandardProfile,
} from '../api'
import { PageChrome } from '../components/PageChrome'

const CURRENCIES = ['USD', 'EUR', 'SEK'] as const

// The Customer-side positions MaSign compares contract terms against
// (MAS-96/120). Rule-based only: saving or applying a standard never calls
// the model, and a term MaSign could not verify as a number stays "unknown"
// rather than guessing a verdict (honest-outcomes). Since MAS-185 a
// workspace can hold more than one named set ("profile") and assign a
// non-default one to individual contracts (contract header); this page
// always edits whichever profile is selected below.
export function StandardsPage() {
  const [profiles, setProfiles] = useState<StandardProfile[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [standards, setStandards] = useState<Standard[] | null>(null)
  const [clauses, setClauses] = useState<ClauseConfig[] | null>(null)
  const [policyRules, setPolicyRules] = useState<PolicyRule[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [clauseBusyId, setClauseBusyId] = useState<string | null>(null)
  const [policyBusyId, setPolicyBusyId] = useState<string | null>(null)
  const [profileBusy, setProfileBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Inline create/rename/delete-confirm, in place of a native browser dialog
  // (this page uses styled forms everywhere else, same as the rest of MaSign).
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  function fetchProfiles(selectId?: string) {
    listStandardProfiles()
      .then((loaded) => {
        setProfiles(loaded)
        const next = selectId ?? loaded.find((p) => p.is_default)?.id ?? loaded[0]?.id ?? null
        setSelected(next)
      })
      .catch((error: Error) => {
        setLoadError(error.message)
        toast.error(error.message)
      })
  }

  useEffect(() => {
    fetchProfiles()
  }, [])

  useEffect(() => {
    if (!selected) return
    setStandards(null)
    setClauses(null)
    setPolicyRules(null)
    setRenaming(false)
    setConfirmingDelete(false)
    listProfileStandards(selected)
      .then(setStandards)
      .catch((error: Error) => {
        setLoadError(error.message)
        toast.error(error.message)
      })
    listProfileClauses(selected)
      .then(setClauses)
      .catch((error: Error) => {
        setLoadError(error.message)
        toast.error(error.message)
      })
    listProfilePolicyRules(selected)
      .then(setPolicyRules)
      .catch((error: Error) => {
        setLoadError(error.message)
        toast.error(error.message)
      })
  }, [selected])

  function retry() {
    setLoadError(null)
    setProfiles(null)
    fetchProfiles(selected ?? undefined)
  }

  function replace(updated: Standard) {
    setStandards((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev))
  }

  async function save(id: string, params: Record<string, unknown>) {
    if (!selected) return
    setBusyId(id)
    try {
      const updated = await toast
        .promise(saveProfileStandard(selected, id, params), { loading: 'Saving…', success: () => 'Standard saved.', error: (error: Error) => error.message })
        .unwrap()
      replace(updated)
    } catch {
      // Already reported by the toast.
    } finally {
      setBusyId(null)
    }
  }

  async function reset(id: string) {
    if (!selected) return
    setBusyId(id)
    try {
      const updated = await toast
        .promise(resetProfileStandard(selected, id), { loading: 'Restoring default…', success: () => "Restored MaSign's default.", error: (error: Error) => error.message })
        .unwrap()
      replace(updated)
    } catch {
      // Already reported by the toast.
    } finally {
      setBusyId(null)
    }
  }

  async function toggleClause(id: string, enabled: boolean) {
    if (!selected) return
    setClauseBusyId(id)
    try {
      const updated = await toast
        .promise(setProfileClauseEnabled(selected, id, enabled), {
          loading: enabled ? 'Enabling…' : 'Disabling…',
          success: () => (enabled ? 'Clause enabled.' : 'Clause disabled.'),
          error: (error: Error) => error.message,
        })
        .unwrap()
      setClauses((prev) => (prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev))
    } catch {
      // Already reported by the toast.
    } finally {
      setClauseBusyId(null)
    }
  }

  async function savePolicyRule(id: string, ruleText: string) {
    if (!selected) return
    setPolicyBusyId(id)
    try {
      const updated = await toast
        .promise(setProfilePolicyRule(selected, id, ruleText), { loading: 'Saving…', success: () => 'Rule saved.', error: (error: Error) => error.message })
        .unwrap()
      setPolicyRules((prev) => (prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev))
    } catch {
      // Already reported by the toast.
    } finally {
      setPolicyBusyId(null)
    }
  }

  async function clearPolicyRule(id: string) {
    if (!selected) return
    setPolicyBusyId(id)
    try {
      const updated = await toast
        .promise(deleteProfilePolicyRule(selected, id), { loading: 'Clearing…', success: () => 'Rule cleared.', error: (error: Error) => error.message })
        .unwrap()
      setPolicyRules((prev) => (prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev))
    } catch {
      // Already reported by the toast.
    } finally {
      setPolicyBusyId(null)
    }
  }

  async function addProfile(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    setProfileBusy(true)
    try {
      const created = await toast
        .promise(createStandardProfile(trimmed), { loading: 'Creating…', success: () => 'Profile created.', error: (error: Error) => error.message })
        .unwrap()
      setCreating(false)
      setNewName('')
      fetchProfiles(created.id)
    } catch {
      // Already reported.
    } finally {
      setProfileBusy(false)
    }
  }

  async function renameProfile(id: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    setProfileBusy(true)
    try {
      await toast
        .promise(renameStandardProfile(id, trimmed), { loading: 'Renaming…', success: () => 'Profile renamed.', error: (error: Error) => error.message })
        .unwrap()
      setRenaming(false)
      fetchProfiles(id)
    } catch {
      // Already reported.
    } finally {
      setProfileBusy(false)
    }
  }

  async function makeDefault(id: string) {
    setProfileBusy(true)
    try {
      await toast
        .promise(setDefaultStandardProfile(id), { loading: 'Setting default…', success: () => 'Default profile updated.', error: (error: Error) => error.message })
        .unwrap()
      fetchProfiles(id)
    } catch {
      // Already reported.
    } finally {
      setProfileBusy(false)
    }
  }

  async function removeProfile(id: string) {
    setProfileBusy(true)
    try {
      await toast
        .promise(deleteStandardProfile(id), { loading: 'Deleting…', success: () => 'Profile deleted.', error: (error: Error) => error.message })
        .unwrap()
      setConfirmingDelete(false)
      fetchProfiles()
    } catch {
      // Already reported.
    } finally {
      setProfileBusy(false)
    }
  }

  const selectedProfile = profiles?.find((p) => p.id === selected) ?? null

  return (
    <PageChrome>
      <main className="content standards-page">
        <div className="standards-intro">
          <a className="link standards-back" href="/workspace">← Back to workspace</a>
          <p className="standards-eyebrow">Workspace settings</p>
          <h1>Contract comparison rules</h1>
          <p>
            Set the four numeric positions MaSign uses to compare verified contract terms. Create more than one named
            profile to apply different rules to different contracts — assign a profile from a contract's Overview tab.
          </p>
        </div>
        <div className="standards-effect" role="note">
          Changes update existing Overview verdicts, checklists and exports immediately. Contracts are not reread, and no AI call is made.
          If MaSign cannot verify a value, it shows “Can’t compare” instead of a verdict.
        </div>
        {loadError && (
          <div className="card standards-load-error" role="alert">
            <p>Could not load your rules: {loadError}</p>
            {loadError === 'Sign in to continue.' ? (
              <a className="link" href="/login">Sign in to manage rules</a>
            ) : (
              <button type="button" onClick={retry}>Try again</button>
            )}
          </div>
        )}
        {!profiles && !loadError && <p className="muted" role="status">Loading rules…</p>}
        {profiles && (
          <div className="standard-profiles-bar" role="tablist" aria-label="Standard profiles">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                role="tab"
                aria-selected={profile.id === selected}
                className={profile.id === selected ? 'standard-profile-tab active' : 'standard-profile-tab'}
                onClick={() => setSelected(profile.id)}
                disabled={profileBusy}
              >
                {profile.name}
                {profile.is_default && <span className="status none">Default</span>}
              </button>
            ))}
            {creating ? (
              <form
                className="standard-profile-inline-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void addProfile(newName)
                }}
              >
                <input
                  autoFocus
                  className="standard-input"
                  aria-label="New profile name"
                  placeholder='e.g. "Vendor contracts"'
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  disabled={profileBusy}
                />
                <button type="submit" className="primary" disabled={profileBusy || !newName.trim()}>
                  Create
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setCreating(false)
                    setNewName('')
                  }}
                  disabled={profileBusy}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" className="link standard-profile-add" onClick={() => setCreating(true)} disabled={profileBusy}>
                + New profile
              </button>
            )}
          </div>
        )}
        {selectedProfile && !renaming && !confirmingDelete && (
          <div className="standard-profile-actions">
            <button
              type="button"
              className="link"
              onClick={() => {
                setRenameValue(selectedProfile.name)
                setRenaming(true)
              }}
              disabled={profileBusy}
            >
              Rename
            </button>
            {!selectedProfile.is_default && (
              <>
                <button type="button" className="link" onClick={() => makeDefault(selectedProfile.id)} disabled={profileBusy}>
                  Make this the workspace default
                </button>
                <button type="button" className="link standard-profile-delete" onClick={() => setConfirmingDelete(true)} disabled={profileBusy}>
                  Delete profile
                </button>
              </>
            )}
          </div>
        )}
        {selectedProfile && renaming && (
          <form
            className="standard-profile-inline-form"
            onSubmit={(event) => {
              event.preventDefault()
              void renameProfile(selectedProfile.id, renameValue)
            }}
          >
            <input
              autoFocus
              className="standard-input"
              aria-label="Rename profile"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              disabled={profileBusy}
            />
            <button type="submit" className="primary" disabled={profileBusy || !renameValue.trim()}>
              Save
            </button>
            <button type="button" className="link" onClick={() => setRenaming(false)} disabled={profileBusy}>
              Cancel
            </button>
          </form>
        )}
        {selectedProfile && confirmingDelete && (
          <div className="standard-profile-actions standard-profile-confirm-delete" role="alert">
            <span>Delete “{selectedProfile.name}”? Contracts using it fall back to the workspace default.</span>
            <button type="button" className="link standard-profile-delete" onClick={() => removeProfile(selectedProfile.id)} disabled={profileBusy}>
              Yes, delete
            </button>
            <button type="button" className="link" onClick={() => setConfirmingDelete(false)} disabled={profileBusy}>
              Cancel
            </button>
          </div>
        )}
        {standards && (
          <div className="standards-grid">
            {standards.map((standard) => (
              <StandardCard key={standard.id} standard={standard} busy={busyId === standard.id} onSave={(params) => save(standard.id, params)} onReset={() => reset(standard.id)} />
            ))}
          </div>
        )}
        {selected && !standards && !loadError && <p className="muted" role="status">Loading profile…</p>}

        {clauses && (
          <section className="card clauses-settings">
            <div className="card-header">
              <h2 className="card-title">Expected clauses</h2>
            </div>
            <p className="muted small">
              Which clauses MaSign checks for on every reviewed contract using this profile (MAS-188). A clause counts as present only with a
              verbatim quote from the text; disabling one here removes it from the checklist entirely, it is never reported as absent.
            </p>
            <ul className="clauses-list">
              {clauses.map((clause) => (
                <li key={clause.id} className="clauses-list-item">
                  <label>
                    <input
                      type="checkbox"
                      checked={clause.enabled}
                      disabled={clauseBusyId === clause.id}
                      onChange={(event) => void toggleClause(clause.id, event.target.checked)}
                    />
                    {clause.name}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {policyRules && (
          <section className="card policy-rules-settings">
            <div className="card-header">
              <h2 className="card-title">Clause content rules</h2>
            </div>
            <p className="muted small">
              What a present clause must actually say, beyond just being there (MAS-192) — for example "the liability cap must not exceed 12
              months of fees". A rule only ever judges a clause the checklist above found present; it has nothing to say about a clause that
              is absent or not checked.
            </p>
            <ul className="policy-rules-list">
              {policyRules.map((rule) => (
                <PolicyRuleRow
                  key={rule.id}
                  rule={rule}
                  busy={policyBusyId === rule.id}
                  onSave={(text) => void savePolicyRule(rule.id, text)}
                  onClear={() => void clearPolicyRule(rule.id)}
                />
              ))}
            </ul>
          </section>
        )}
      </main>
    </PageChrome>
  )
}

function PolicyRuleRow({
  rule,
  busy,
  onSave,
  onClear,
}: {
  rule: PolicyRule
  busy: boolean
  onSave: (text: string) => void
  onClear: () => void
}) {
  const [text, setText] = useState(rule.rule_text ?? '')
  const dirty = text.trim() !== (rule.rule_text ?? '')
  return (
    <li className="policy-rules-list-item">
      <label htmlFor={`policy-rule-${rule.id}`}>{rule.name} content rule</label>
      <div className="policy-rule-row">
        <input
          id={`policy-rule-${rule.id}`}
          type="text"
          value={text}
          placeholder="No rule configured — this clause is only checked for presence"
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="button" className="primary" disabled={busy || !dirty} onClick={() => onSave(text)} aria-label={`Save ${rule.name} rule`}>
          Save
        </button>
        {rule.rule_text && (
          <button
            type="button"
            className="link"
            disabled={busy}
            aria-label={`Clear ${rule.name} rule`}
            onClick={() => {
              setText('')
              onClear()
            }}
          >
            Clear
          </button>
        )}
      </div>
    </li>
  )
}

interface CardProps {
  standard: Standard
  busy: boolean
  onSave: (params: Record<string, unknown>) => void
  onReset: () => void
}

function StandardCard({ standard, busy, onSave, onReset }: CardProps) {
  return (
    <section className="card standard-card">
      <div className="card-header">
        <h2 className="card-title">{standard.name}</h2>
        <span className={standard.is_default ? 'status none' : 'status ok'}>{standard.is_default ? 'MaSign default' : 'Customised'}</span>
      </div>
      <p className="standard-current"><span>Saved rule</span><strong>{standard.text}</strong></p>
      <StandardForm key={JSON.stringify(standard.params)} standard={standard} busy={busy} onSave={onSave} />
      <button type="button" className="link standard-reset" onClick={onReset} disabled={busy || standard.is_default}>
        Restore MaSign's default
      </button>
    </section>
  )
}

function RuleExample({ clause, meets }: { clause: string; meets: boolean }) {
  return (
    <p className="standard-example">
      <span>Example · {clause}</span>
      <strong className={meets ? 'standard-example-meets' : 'standard-example-deviates'}>{meets ? 'Meets rule' : 'Deviates'}</strong>
    </p>
  )
}

function StandardForm({ standard, busy, onSave }: { standard: Standard; busy: boolean; onSave: (params: Record<string, unknown>) => void }) {
  if (standard.id === 'payment_deadline') return <DaysField standard={standard} busy={busy} onSave={onSave} paramKey="net_days_min" label="Minimum payment deadline (days)" />
  if (standard.id === 'notice_period') return <DaysField standard={standard} busy={busy} onSave={onSave} paramKey="notice_days_max" label="Maximum notice period (days)" />
  if (standard.id === 'late_payment') return <PercentField standard={standard} busy={busy} onSave={onSave} />
  if (standard.id === 'termination_cost') return <TerminationCostFields standard={standard} busy={busy} onSave={onSave} />
  return null
}

function DaysField({ standard, busy, onSave, paramKey, label }: { standard: Standard; busy: boolean; onSave: (params: Record<string, unknown>) => void; paramKey: string; label: string }) {
  const initial = standard.params[paramKey]
  const [value, setValue] = useState(typeof initial === 'number' ? String(initial) : '')
  const dirty = value !== String(initial)
  const inputId = `standard-${standard.id}-days`
  const isPayment = standard.id === 'payment_deadline'
  return (
    <form
      className="standard-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSave({ [paramKey]: Number(value) })
      }}
    >
      <label className="standard-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="standard-form-row">
        <input id={inputId} className="standard-input" type="number" min={0} max={3650} step={1} value={value} onChange={(event) => setValue(event.target.value)} disabled={busy} required />
        <button type="submit" className="primary" disabled={busy || !dirty || value === ''}>
          Save rule
        </button>
      </div>
      {dirty && <span className="standard-unsaved">Unsaved change</span>}
      {value !== '' && <RuleExample clause={isPayment ? 'Invoice payable in 30 days' : '60 days’ termination notice'} meets={isPayment ? 30 >= Number(value) : 60 <= Number(value)} />}
    </form>
  )
}

function PercentField({ standard, busy, onSave }: { standard: Standard; busy: boolean; onSave: (params: Record<string, unknown>) => void }) {
  const initial = standard.params.rate_max_per_month_percent
  const [value, setValue] = useState(typeof initial === 'number' ? String(initial) : '')
  const dirty = value !== String(initial)
  const inputId = `standard-${standard.id}-percent`
  return (
    <form
      className="standard-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSave({ rate_max_per_month_percent: Number(value) })
      }}
    >
      <label className="standard-label" htmlFor={inputId}>
        Maximum late-payment interest (% per month)
      </label>
      <div className="standard-form-row">
        <input id={inputId} className="standard-input" type="number" min={0} max={100} step={0.1} value={value} onChange={(event) => setValue(event.target.value)} disabled={busy} required />
        <button type="submit" className="primary" disabled={busy || !dirty || value === ''}>
          Save rule
        </button>
      </div>
      {dirty && <span className="standard-unsaved">Unsaved change</span>}
      {value !== '' && <RuleExample clause="1% interest per month" meets={1 <= Number(value)} />}
    </form>
  )
}

function TerminationCostFields({ standard, busy, onSave }: { standard: Standard; busy: boolean; onSave: (params: Record<string, unknown>) => void }) {
  const params = standard.params
  const [mode, setMode] = useState(typeof params.mode === 'string' ? params.mode : 'no_fee')
  const [maxPercent, setMaxPercent] = useState(typeof params.max_percent === 'number' ? String(params.max_percent) : '')
  const [maxAmount, setMaxAmount] = useState(typeof params.max_amount === 'number' ? String(params.max_amount) : '')
  const [currency, setCurrency] = useState(typeof params.currency === 'string' ? params.currency : CURRENCIES[0])
  const prefix = `standard-${standard.id}`
  const dirty = mode !== params.mode || (mode === 'percent_cap' && maxPercent !== String(params.max_percent)) ||
    (mode === 'amount_cap' && (maxAmount !== String(params.max_amount) || currency !== params.currency))

  function submit() {
    if (mode === 'no_fee') return onSave({ mode })
    if (mode === 'percent_cap') return onSave({ mode, max_percent: Number(maxPercent) })
    return onSave({ mode, max_amount: Number(maxAmount), currency })
  }

  return (
    <form
      className="standard-form"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label className="standard-label" htmlFor={`${prefix}-mode`}>
        Termination-cost preference
      </label>
      <select id={`${prefix}-mode`} className="standard-input" value={mode} onChange={(event) => setMode(event.target.value)} disabled={busy}>
        <option value="no_fee">No early-termination fee allowed</option>
        <option value="percent_cap">Cap at a percent of remaining fees</option>
        <option value="amount_cap">Cap at a fixed amount</option>
      </select>

      {mode === 'percent_cap' && (
        <div className="standard-form-row">
          <input
            aria-label="Maximum termination fee, percent of remaining fees"
            className="standard-input"
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={maxPercent}
            onChange={(event) => setMaxPercent(event.target.value)}
            disabled={busy}
            required
          />
          <span className="muted small">% of remaining fees</span>
        </div>
      )}

      {mode === 'amount_cap' && (
        <div className="standard-form-row">
          <select aria-label="Currency" className="standard-input standard-currency" value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={busy}>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <input
            aria-label="Maximum termination fee amount"
            className="standard-input"
            type="number"
            min={0}
            step={1}
            value={maxAmount}
            onChange={(event) => setMaxAmount(event.target.value)}
            disabled={busy}
            required
          />
        </div>
      )}

      <button type="submit" className="primary" disabled={busy || !dirty || (mode === 'percent_cap' && maxPercent === '') || (mode === 'amount_cap' && maxAmount === '')}>
        Save rule
      </button>
      {dirty && <span className="standard-unsaved">Unsaved change</span>}
      {mode === 'no_fee' && <RuleExample clause="5% early-termination fee" meets={false} />}
      {mode === 'percent_cap' && maxPercent !== '' && <RuleExample clause="5% of remaining fees" meets={5 <= Number(maxPercent)} />}
      {mode === 'amount_cap' && maxAmount !== '' && <RuleExample clause={`${currency} 2,000 early-termination fee`} meets={2000 <= Number(maxAmount)} />}
    </form>
  )
}
