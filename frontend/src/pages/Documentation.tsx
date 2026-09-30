import { PublicPage, PublicPageIcon } from '../components/PublicPage'

const GITHUB = 'https://github.com/moshayeb/MaSign'

const RESOURCES = [
  {
    title: 'Using MaSign',
    text: 'The short version of how MaSign works, for anyone using the app rather than building it.',
    href: '/how-it-works',
    linkLabel: 'How it works',
    external: false,
    icon: <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" />,
  },
  {
    title: 'Understanding results',
    text: 'See the seven risk categories, ten key terms and what each result means.',
    href: '/what-masign-checks',
    linkLabel: 'What MaSign checks',
    external: false,
    icon: <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  },
  {
    title: 'Technical documentation',
    text: 'Find local setup, the API, the risk rubric, architecture notes and frontend conventions in the repository.',
    href: `${GITHUB}#readme`,
    linkLabel: 'README on GitHub',
    external: true,
    icon: <path d="m10 13 6-6M8 11 3 16l5 5 5-5M16 8l5-5-5-5-5 5" />,
  },
]

// MAS-142: replaces the single prose card with the shared public-page
// layout and three resource cards, one per audience — everyday use,
// interpreting results, and the technical docs that live in the repo. The
// real GitHub / docs links from the previous version are unchanged.
export function DocumentationPage() {
  return (
    <PublicPage
      eyebrow="Documentation"
      title="Find the right guide"
      subtitle="Start with a quick explanation of the product, learn how to read a result, or open the technical documentation in GitHub."
    >
      <section className="pubpage-section" aria-labelledby="documentation-resources-title">
        <div className="pubpage-section-heading">
          <span className="pubpage-section-number">01 / 02</span>
          <div>
            <h2 id="documentation-resources-title">Choose a starting point</h2>
            <p>Three short routes for using MaSign or understanding how it works.</p>
          </div>
        </div>
        <div className="pubpage-grid pubpage-grid-3" aria-label="Documentation resources">
          {RESOURCES.map((resource) => (
            <article key={resource.title} className="card pubpage-card pubpage-resource-card">
              <PublicPageIcon>{resource.icon}</PublicPageIcon>
              <h3>{resource.title}</h3>
              <p>{resource.text}</p>
              <a className="link" href={resource.href} target={resource.external ? '_blank' : undefined} rel={resource.external ? 'noreferrer noopener' : undefined}>
                {resource.linkLabel} <span aria-hidden="true">→</span>
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="pubpage-callout" aria-label="More in the repository">
        <h2>More in the repository</h2>
        <p>
          The{' '}
          <a href={`${GITHUB}/tree/main/docs`} target="_blank" rel="noreferrer noopener">
            docs/
          </a>{' '}
          folder covers the risk rubric, architecture and frontend conventions in more depth than fits here.
        </p>
      </section>
    </PublicPage>
  )
}
