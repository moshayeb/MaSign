import { StaticPage } from './StaticPage'

const GITHUB = 'https://github.com/moshayeb/MaSign'

export function DocumentationPage() {
  return (
    <StaticPage title="Documentation">
      <p>
        MaSign's technical documentation lives with its source code, so it never drifts from what is actually running. The{' '}
        <a href={`${GITHUB}#readme`} target="_blank" rel="noreferrer noopener">
          README
        </a>{' '}
        covers local setup and the API; the repository's <code>docs/</code> folder covers the risk rubric, architecture and frontend
        conventions in more depth.
      </p>
      <ul>
        <li>
          <a href={`${GITHUB}#readme`} target="_blank" rel="noreferrer noopener">
            Project README
          </a>{' '}
          — what MaSign does, local setup, the API endpoints.
        </li>
        <li>
          <a href={`${GITHUB}/tree/main/docs`} target="_blank" rel="noreferrer noopener">
            docs/
          </a>{' '}
          — the risk rubric, architecture notes and frontend conventions.
        </li>
        <li>
          <a href="/how-it-works">How it works</a> — the short version, for anyone using the app rather than building it.
        </li>
      </ul>
    </StaticPage>
  )
}
