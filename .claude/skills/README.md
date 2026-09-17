# Agent Skills — Homework 03

Ett litet, cherry-pickat urval av Skills för att stödja ett bra agent-workflow i våra projekt (t.ex. ARC-Assistant, MassQL), snarare än att implementera hela listan från uppgiften.

## Urval och motivering

| Skill | Från uppgiftens lista | Varför just denna |
|---|---|---|
| `spec-from-brainstorm` | Brainstorming → samsyn → spec ("grill-me") | Störst hävstång tidigt i flödet: billigast att fixa missförstånd innan kod skrivits. |
| `ticket-git-workflow` | Tickets ↔ git/Jira, tydliga testbara mål | Vi har redan ett riktigt Jira-projekt (AA) och git-workflow med Konrad — direkt applicerbart, inte hypotetiskt. |
| `definition-of-done` | Agentbeteende vid "klar" (review, test, coverage, PR, ticket-uppdatering) | Gör "jag tror det är klart" till en verifierbar checklista istället för en gissning. |
| `dual-pass-thinking` | Skills för tankesätt (confirmational→adversarial→concluding) | Billig att använda selektivt på dyra/svårreverserade beslut, t.ex. schema-design. |
| `session-handoff` | Handover/compaction + strukturerad trädsammanfattning | Kombinerar två relaterade punkter i listan till en skill; särskilt relevant givet vårt fokus på context engineering. |

## Medvetet bortvalt (cherry-picking)

- **Kommunikation mellan parallella agenter** — märkt som överkurs i uppgiften; vårt setup är ännu inte tillräckligt parallellt för att motivera komplexiteten just nu.
- **Skills för specialområden (GUI-design etc.)** och **infrastruktur-skills (test-miljöer, k8s etc.)** — för projektspecifika för att vara en generell, återanvändbar del av ett "litet" urval; bättre som separata skills per projekt om/när behovet uppstår.
- **Lokal knowledge-base-skill** — viktig på sikt (att äga sin domänkunskap även i agent-skriven form), men kräver en beslutad struktur för kunskapsbasen först; naturlig uppföljare till `session-handoff`.

## Hur de hänger ihop

`spec-from-brainstorm` → skriver ticket enligt `ticket-git-workflow` → arbete verifieras mot `definition-of-done` → beslut som är dyra att ändra körs genom `dual-pass-thinking` → sessionen avslutas med `session-handoff`, som nästa session läser innan den gör något annat.
