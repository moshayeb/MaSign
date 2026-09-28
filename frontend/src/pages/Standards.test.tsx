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

function mockApi(overrides: { onPut?: (id: string, body: unknown) => Response; onDelete?: (id: string) => Response } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/api/standards' && (!init || init.method === undefined)) return json(200, DEFAULTS)
    const match = /\/api\/standards\/(\w+)$/.exec(url)
    if (match && init?.method === 'PUT') {
      const id = match[1]
      if (overrides.onPut) return overrides.onPut(id, JSON.parse(String(init.body)))
      const body = JSON.parse(String(init.body)) as { params: Record<string, unknown> }
      const base = DEFAULTS.find((d) => d.id === id)!
      // A small stand-in for the server's `describe()`: only the shape this
      // test file's saves actually exercise (payment_deadline's days).
      const text = id === 'payment_deadline' ? `net ${body.params.net_days_min} days or longer` : base.text
      return json(200, { ...base, params: body.params, text, is_default: false })
    }
    if (match && init?.method === 'DELETE') {
      const id = match[1]
      if (overrides.onDelete) return overrides.onDelete(id)
      return json(200, DEFAULTS.find((d) => d.id === id))
    }
    return json(404, { detail: `unexpected ${url}` })
  })
}

describe('company standards settings screen (MAS-120)', () => {
  it('shows every standard with its current text and default badge', async () => {
    mockApi()
    render(<StandardsPage />)

    expect(await screen.findByText('net 30 days or longer')).toBeInTheDocument()
    expect(screen.getByText('at most 1% per month (12% per year)')).toBeInTheDocument()
    expect(screen.getByText('at most 60 days')).toBeInTheDocument()
    expect(screen.getByText('no early-termination fee')).toBeInTheDocument()
    expect(screen.getAllByText('MaSign default')).toHaveLength(4)
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
    await userEvent.click(within(paymentCard).getByRole('button', { name: 'Save' }))

    const putCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/standards/payment_deadline' && init?.method === 'PUT')
    expect(putCall).toBeTruthy()
    expect(JSON.parse(String(putCall![1]?.body))).toEqual({ params: { net_days_min: 45 } })

    expect(await within(paymentCard).findByText('net 45 days or longer')).toBeInTheDocument()
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
    await userEvent.click(within(paymentCard).getByRole('button', { name: 'Save' }))

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
    await userEvent.click(within(paymentCard).getByRole('button', { name: 'Save' }))
    await within(paymentCard).findByText('net 45 days or longer')

    const restoreButton = within(paymentCard).getByRole('button', { name: "Restore MaSign's default" })
    await userEvent.click(restoreButton)

    const deleteCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/standards/payment_deadline' && init?.method === 'DELETE')
    expect(deleteCall).toBeTruthy()
    expect(await within(paymentCard).findByText('net 30 days or longer')).toBeInTheDocument()
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
    await userEvent.click(within(terminationCard).getByRole('button', { name: 'Save' }))

    const putCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/standards/termination_cost' && init?.method === 'PUT')
    expect(JSON.parse(String(putCall![1]?.body))).toEqual({ params: { mode: 'amount_cap', max_amount: 25000, currency: 'SEK' } })
  })
})
