import { StaticPage } from './StaticPage'

export function PrivacyPage() {
  return (
    <StaticPage title="Privacy">
      <p>
        MaSign is an educational project without user accounts, so there is no sign-in, no password, and nothing tying an upload to a
        person's identity beyond whatever the browser session already knows.
      </p>
      <h2>What is stored</h2>
      <p>
        An uploaded contract's text is split into passages and stored, together with the questions asked about it and the answers
        MaSign gave, in the database of whichever instance you are using. There is no analytics or tracking script on this site, and
        nothing is stored in cookies or browser storage beyond what the browser itself keeps for the page to work.
      </p>
      <h2>What leaves the server</h2>
      <p>
        To answer a question or run a risk review, the relevant contract passages are sent to the configured AI provider (Anthropic or
        OpenAI, depending on deployment) to generate the response. A guardrail checks each passage for instructions aimed at the AI
        itself before it is sent, and withholds or redacts anything that looks like an attempt to hijack the answer.
      </p>
      <h2>What this is not</h2>
      <p>
        This is not a production service with a data-protection team behind it, and it should not be used for contracts containing
        information you would not want stored in a plain database on a course project's server. Do not upload anything you are not
        comfortable being read by whoever operates the instance you are using.
      </p>
    </StaticPage>
  )
}
