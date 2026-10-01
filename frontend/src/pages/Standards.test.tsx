import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StandardsPage } from './Standards'

// Same pattern as App.test.tsx: toast.promise is mocked to actually run the
// promise and call the matching message builder, the way sonner would.
vi.mock('sonner', async () => {
  const actual = await vi.importActual<typeof import('sonner')>('sonner')
  return {
    ...actual,
    Toaster: () => null,
    toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), promise: vi.fn() }),
  }
})

import { toast } from 'sonner'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function promiseToastBehaviour() {
  vi.mocked(toast.promise).mockImplementation(((promise: Promise<unknown>, messages: Record<string, unknown>) => ({
    unwrap: () =>
      promise.then(
        (value) => {
          const success = messages.success as (v: unknown) => string
          shown.push(['success', success(value)])
          return value
        },
        (error: Error) => {
          const failure = messages.error as (e: Error) => string
          shown.push(['error', failure(error)])
          throw error
        },
      ),
  })) as never)
}

let shown: [string, string][]

beforeEach(() => {
  shown = []
  vi.mocked(toast.error).mockClear()
  promiseToastBehaviour()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const DEFAULT_PROFILE = { id: 'profile-default', name: 'Default', is_default: true }

const DEFAULTS = [
  { id: 'payment_deadline', name: 'Payment deadline', text: 'net 30 days or longer', params: { net_days_min: 30 }, is_default: true },
  { id: 'late_payment', name: 'Late-payment interest / penalty', text: 'at most 1% per month (12% per year)', params: { rate_max_per_month_percent: 1.0 }, is_default: true },
  { id: 'notice_period', name: 'Notice period', text: 'at most 60 days', params: { notice_days_max: 60 }, is_default: true },
  {
    id: 'termination_cost',
    name: 'Termination cost',
    text: 'no early-termination fee',
    params: { mode: 'no_fee', max_percent: null, max_amount: null, currency: null },
    is_default: true,
  },
]

const CLAUSES = [
  { id: 'liability_cap', name: 'Liability cap', enabled: true },
  { id: 'data_protection', name: 'Data protection', enabled: true },
  { id: 'insurance', name: 'Insurance', enabled: true },
  { id: 'indemnification', name: 'Indemnification', enabled: true },
]

function mockApi(
  overrides: {
    profiles?: typeof DEFAULT_PROFILE[]
    onGetProfiles?: () => Response
    onGetStandards?: (profileId: string) => Response
    onPut?: (profileId: string, termId: string, body: unknown) => Response
    onDelete?: (profileId: string, termId: string) => Response
    onCreateProfile?: (name: string) => Response
  } = {},
) {
  const profiles = overrides.profiles ?? [DEFAULT_PROFILE]
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/api/standard-profiles' && (!init || init.method === undefined)) {
      return overrides.onGetProfiles?.() ?? json(200, profiles)
    }
    if (url === '/api/standard-profiles' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { name: string }
      return overrides.onCreateProfile?.(body.name) ?? json(201, { id: `profile-${body.name}`, name: body.name, is_default: false })
    }
    const profileMatch = /^\/api\/standard-profiles\/([^/]+)$/.exec(url)
    if (profileMatch && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { name?: string; is_default?: boolean }
      const base = profiles.find((p) => p.id === profileMatch[1])!
      return json(200, { ...base, ...(body.name !== undefined ? { name: body.name } : {}), ...(body.is_default !== undefined ? { is_default: body.is_default } : {}) })
    }
    if (profileMatch && init?.method === 'DELETE') {
      return new Response(null, { status: 204 })
    }
    const standardsMatch = /^\/api\/standard-profiles\/([^/]+)\/standards$/.exec(url)
    if (standardsMatch && (!init || init.method === undefined)) {
      return overrides.onGetStandards?.(standardsMatch[1]) ?? json(200, DEFAULTS)
    }
    const clausesMatch = /^\/api\/standard-profiles\/([^/]+)\/clauses$/.exec(url)
    if (clausesMatch && (!init || init.method === undefined)) {
      return json(200, CLAUSES)
    }
    const clauseItemMatch = /^\/api\/standard-profiles\/([^/]+)\/clauses\/(\w+)$/.exec(url)
    if (clauseItemMatch && init?.method === 'PUT') {
      const [, , clauseId] = clauseItemMatch
      const { enabled } = JSON.parse(String(init.body)) as { enabled: boolean }
      return json(200, { ...CLAUSES.find((c) => c.id === clauseId)!, enabled })
    }
    const itemMatch = /^\/api\/standard-profiles\/([^/]+)\/standards\/(\w+)$/.exec(url)
    if (itemMatch && init?.method === 'PUT') {
      const [, profileId, termId] = itemMatch
      if (overrides.onPut) return overrides.onPut(profileId, termId, JSON.parse(String(init.body)))
      const body = JSON.parse(String(init.body)) as { params: Record<string, unknown> }
      const base = DEFAULTS.find((d) => d.id === termId)!
      // A small stand-in for the server's `describe()`: only the shape this
      // test file's saves actually exercise (payment_deadline's days).
      const text = termId === 'payment_deadline' ? `net ${body.params.net_days_min} days or longer` : base.text
      return json(200, { ...base, params: body.params, text, is_default: false })
    }
    if (itemMatch && init?.method === 'DELETE') {
      const [profileId, termId] = [itemMatch[1], itemMatch[2]]
      if (overrides.onDelete) return overrides.onDelete(profileId, termId)
      return json(200, DEFAULTS.find((d) => d.id === termId))
    }
    return json(404, { detail: `unexpected ${url}` })
  })
}

describe('company standards settings screen (MAS-120/185)', () => {
  it('shows every standard with its current text and default badge', async () => {
    mockApi()
    render(<StandardsPage />)

    expect(await screen.findByText('net 30 days or longer')).toBeInTheDocument()
    expect(screen.getByText('at most 1% per month (12% per year)')).toBeInTheDocument()
    expect(screen.getByText('at most 60 days')).toBeInTheDocument()
    expect(screen.getByText('no early-termination fee')).toBeInTheDocument()
    expect(screen.getAllByText('MaSign default')).toHaveLength(4)
    expect(screen.getByText(/Changes update existing Overview verdicts/)).toBeInTheDocument()
    expect(screen.getByText('Example · Invoice payable in 30 days')).toBeInTheDocument()
  })

  it('shows every clause enabled by default, and toggling one disables it (MAS-188)', async () => {
    const fetchMock = mockApi()
    render(<StandardsPage />)

    expect(await screen.findByText('Expected clauses', { selector: 'h2' })).toBeInTheDocument()
    const insurance = screen.getByLabelText('Insurance') as HTMLInputElement
    expect(insurance.checked).toBe(true)
    expect((screen.getByLabelText('Liability cap') as HTMLInputElement).checked).toBe(true)

    await userEvent.click(insurance)

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/standard-profiles/profile-default/clauses/insurance' && init?.method === 'PUT',
    )
    expect(putCall).toBeTruthy()
    expect(JSON.parse(String(putCall![1]?.body))).toEqual({ enabled: false })
    expect(await screen.findByLabelText('Insurance')).not.toBeChecked()
    expect(shown).toContainEqual(['success', 'Clause disabled.'])
  })

  async function findCard(name: string): Promise<HTMLElement> {
    const heading = await screen.findByText(name)
    return heading.closest('.standard-card') as HTMLElement
  }

  it('saves a new value and shows the standard as customised', async () => {
    const fetchMock = mockApi()
    render(<StandardsPage />)

    const paymentCard = await findCard('Payment deadline')
    const input = within(paymentCard).getByLabelText('Minimum payment deadline (days)')
    await userEvent.clear(input)
    await userEvent.type(input, '45')
    expect(within(paymentCard).getByRole('button', { name: 'Save rule' })).toBeEnabled()
    expect(within(paymentCard).getByText('Unsaved change')).toBeInTheDocument()
    expect(within(paymentCard).getByText('Deviates')).toBeInTheDocument()
    await userEvent.click(within(paymentCard).getByRole('button', { name: 'Save rule' }))

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/standard-profiles/profile-default/standards/payment_deadline' && init?.method === 'PUT',
    )
    expect(putCall).toBeTruthy()
    expect(JSON.parse(String(putCall![1]?.body))).toEqual({ params: { net_days_min: 45 } })

    expect(await within(paymentCard).findByText('net 45 days or longer')).toBeInTheDocument()
    expect(within(paymentCard).getByLabelText('Minimum payment deadline (days)')).toHaveValue(45)
    expect(within(paymentCard).getByRole('button', { name: 'Save rule' })).toBeDisabled()
    expect(shown).toContainEqual(['success', 'Standard saved.'])
  })

  it('does not apply a save the API rejects, and reports the API detail', async () => {
    // 50 passes the input's own min/max, so the click actually reaches the
    // network; the rejection here stands in for any server-side "no" (a
    // concurrent change, a rule the client-side bounds don't encode, etc).
    mockApi({ onPut: () => json(422, { detail: 'Payment deadline must be between 0 and 3650 days.' }) })
    render(<StandardsPage />)

    const paymentCard = await findCard('Payment deadline')
    const input = within(paymentCard).getByLabelText('Minimum payment deadline (days)')
    await userEvent.clear(input)
    await userEvent.type(input, '50')
    await userEvent.click(within(paymentCard).getByRole('button', { name: 'Save rule' }))

    await vi.waitFor(() => expect(shown).toContainEqual(['error', 'Payment deadline must be between 0 and 3650 days.']))
    // The card still shows the un-saved default -- a rejected save is never applied.
    expect(within(paymentCard).getByText('net 30 days or longer')).toBeInTheDocument()
  })

  it('restores MaSign default and disables the restore button once it is', async () => {
    const fetchMock = mockApi()
    render(<StandardsPage />)

    const paymentCard = await findCard('Payment deadline')
    const input = within(paymentCard).getByLabelText('Minimum payment deadline (days)')
    await userEvent.clear(input)
    await userEvent.type(input, '45')
    await userEvent.click(within(paymentCard).getByRole('button', { name: 'Save rule' }))
    await within(paymentCard).findByText('net 45 days or longer')

    const restoreButton = within(paymentCard).getByRole('button', { name: "Restore MaSign's default" })
    await userEvent.click(restoreButton)

    const deleteCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/standard-profiles/profile-default/standards/payment_deadline' && init?.method === 'DELETE',
    )
    expect(deleteCall).toBeTruthy()
    expect(await within(paymentCard).findByText('net 30 days or longer')).toBeInTheDocument()
    expect(within(paymentCard).getByLabelText('Minimum payment deadline (days)')).toHaveValue(30)
    expect(restoreButton).toBeDisabled()
  })

  it('switches the termination-cost fields with its preference, and saves the amount-cap shape', async () => {
    const fetchMock = mockApi()
    render(<StandardsPage />)

    const terminationCard = await findCard('Termination cost')
    expect(within(terminationCard).getByText('no early-termination fee')).toBeInTheDocument()
    expect(within(terminationCard).queryByLabelText('Maximum termination fee amount')).not.toBeInTheDocument()

    await userEvent.selectOptions(within(terminationCard).getByLabelText('Termination-cost preference'), 'amount_cap')
    expect(within(terminationCard).getByLabelText('Maximum termination fee amount')).toBeInTheDocument()
    expect(within(terminationCard).getByLabelText('Currency')).toBeInTheDocument()

    await userEvent.selectOptions(within(terminationCard).getByLabelText('Currency'), 'SEK')
    await userEvent.type(within(terminationCard).getByLabelText('Maximum termination fee amount'), '25000')
    await userEvent.click(within(terminationCard).getByRole('button', { name: 'Save rule' }))

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/standard-profiles/profile-default/standards/termination_cost' && init?.method === 'PUT',
    )
    expect(JSON.parse(String(putCall![1]?.body))).toEqual({ params: { mode: 'amount_cap', max_amount: 25000, currency: 'SEK' } })
  })

  it('shows a recoverable error instead of loading forever', async () => {
    let attempts = 0
    mockApi({ onGetProfiles: () => (++attempts === 1 ? json(503, { detail: 'Database unavailable.' }) : json(200, [DEFAULT_PROFILE])) })
    render(<StandardsPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable.')
    expect(screen.queryByText('Loading rules…')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('net 30 days or longer')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('gives a sign-in path when the workspace session is missing', async () => {
    mockApi({ onGetProfiles: () => json(401, { detail: 'Sign in to continue.' }) })
    render(<StandardsPage />)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('link', { name: 'Sign in to manage rules' })).toHaveAttribute('href', '/login')
    expect(within(alert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})

describe('named standard profiles (MAS-185)', () => {
  it('lists every profile as a tab, defaulting the selection to the default profile', async () => {
    mockApi({ profiles: [DEFAULT_PROFILE, { id: 'profile-vendor', name: 'Vendor contracts', is_default: false }] })
    render(<StandardsPage />)

    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['DefaultDefault', 'Vendor contracts'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('creates a profile via the inline form (no native dialog) and switches to editing it', async () => {
    const fetchMock = mockApi({
      onGetStandards: (profileId) =>
        profileId === 'profile-vendor'
          ? json(200, DEFAULTS.map((d) => (d.id === 'notice_period' ? { ...d, text: 'at most 14 days', params: { notice_days_max: 14 }, is_default: false } : d)))
          : json(200, DEFAULTS),
      onCreateProfile: (name) => json(201, { id: 'profile-vendor', name, is_default: false }),
    })
    render(<StandardsPage />)

    await screen.findByText('net 30 days or longer')
    await userEvent.click(screen.getByRole('button', { name: '+ New profile' }))
    await userEvent.type(screen.getByLabelText('New profile name'), 'Vendor contracts')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    const postCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/standard-profiles' && init?.method === 'POST')
    expect(postCall).toBeTruthy()
    expect(JSON.parse(String(postCall![1]?.body))).toEqual({ name: 'Vendor contracts' })
    expect(await screen.findByText('at most 14 days')).toBeInTheDocument()
    expect(shown).toContainEqual(['success', 'Profile created.'])
  })

  it('cancelling the new-profile form makes no request', async () => {
    const fetchMock = mockApi()
    render(<StandardsPage />)

    await screen.findByText('net 30 days or longer')
    await userEvent.click(screen.getByRole('button', { name: '+ New profile' }))
    await userEvent.type(screen.getByLabelText('New profile name'), 'Discarded')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('New profile name')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/standard-profiles' && init?.method === 'POST')).toBe(false)
  })

  it('offers to delete a non-default profile but not the default one, with an inline confirm step', async () => {
    const fetchMock = mockApi({ profiles: [DEFAULT_PROFILE, { id: 'profile-vendor', name: 'Vendor contracts', is_default: false }] })
    render(<StandardsPage />)

    await screen.findByText('net 30 days or longer')
    expect(screen.queryByRole('button', { name: 'Delete profile' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /Vendor contracts/ }))
    await screen.findByRole('button', { name: 'Delete profile' })
    expect(screen.getByRole('button', { name: 'Make this the workspace default' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Delete profile' }))
    expect(screen.getByText(/Delete .Vendor contracts/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete profile' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/standard-profiles/profile-vendor' && init?.method === 'DELETE')).toBe(true)
    expect(shown).toContainEqual(['success', 'Profile deleted.'])
  })

  it('renames a profile via the inline form', async () => {
    const fetchMock = mockApi()
    render(<StandardsPage />)

    await screen.findByText('net 30 days or longer')
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Rename profile')
    expect(input).toHaveValue('Default')
    await userEvent.clear(input)
    await userEvent.type(input, 'Renamed default')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const putCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/standard-profiles/profile-default' && init?.method === 'PUT')
    expect(putCall).toBeTruthy()
    expect(JSON.parse(String(putCall![1]?.body))).toEqual({ name: 'Renamed default' })
    expect(shown).toContainEqual(['success', 'Profile renamed.'])
  })
})
