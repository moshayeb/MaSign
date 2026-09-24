import type { ComponentType } from 'react'
import { AboutPage } from './About'
import { DocumentationPage } from './Documentation'
import { EducationalDisclaimerPage } from './EducationalDisclaimer'
import { HowItWorksPage } from './HowItWorks'
import { PrivacyPage } from './Privacy'
import { WhatMaSignChecksPage } from './WhatMaSignChecks'

// Pathname -> page component (MAS-132). No router dependency: the app has
// exactly this handful of static public pages plus the workspace at "/", so
// a plain lookup is simpler than pulling in a routing library. Server-side,
// FastAPI serves dist/404.html (a copy of index.html made at build time) for
// any unmatched path, so a direct link or a refresh on one of these still
// works — the client then picks the right page from this same table.
export const PAGES: Record<string, ComponentType> = {
  '/about': AboutPage,
  '/privacy': PrivacyPage,
  '/documentation': DocumentationPage,
  '/how-it-works': HowItWorksPage,
  '/what-masign-checks': WhatMaSignChecksPage,
  '/educational-disclaimer': EducationalDisclaimerPage,
}
