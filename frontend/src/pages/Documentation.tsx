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
    text: 'What the seven risk categories and nine key terms mean, and how to read High, Medium, Low and Not checked.',
    href: '/what-masign-checks',
    linkLabel: 'What MaSign checks',
    external: false,
    icon: <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  },
  {
    title: 'Technical documentation',
    text: 'Local setup, the API, the risk rubric, architecture notes and frontend conventions — kept with the source so it never drifts from what is running.',
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
      title="Docs that live with the code"
      subtitle="MaSign's technical documentation lives with its source, so it never drifts from what is actually running."
    >
      <section className="pubpage-grid pubpage-grid-3" aria-label="Documentation resources">
        {RESOURCES.map((resource) => (
          <article key={resource.title} className="card pubpage-card">
            <PublicPageIcon>{resource.icon}</PublicPageIcon>
            <h2>{resource.title}</h2>
            <p>{resource.text}</p>
            <a className="link" href={resource.href} target={resource.external ? '_blank' : undefined} rel={resource.external ? 'noreferrer noopener' : undefined}>
              {resource.linkLabel}
            </a>
          </article>
        ))}
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
