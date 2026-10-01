import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'

// jsdom implements no matchMedia; MAS-177's useIsWide hook needs one in
// every test that mounts App. Default every query to "matches" so narrow is
// true and isWide is false, keeping the existing single-tab-switch citation
// tests (written before the wide-screen side panel existed) passing
// unchanged. Tests exercising the panel stub their own non-matching
// matchMedia locally (see SourcePanel.test.tsx); Navigation.test.tsx already
// overrides this with its own narrow/wide toggle in its own beforeEach,
// which runs after this one and wins.
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})
