# Redesign canvas (MAS-209)

The approved design for the website and the workspace, exported from the
design canvas on 2026-11-02. These files are the reference the redesign
phases implement against; `../feature-inventory.md` is the checklist that
nothing is lost on the way.

Live canvas (owner's account): https://claude.ai/artifact/AiDD5yHfJ1sjTR4PcTMTuK

Each `*.dc.html` file is one artboard. They need the canvas runtime
(`support.js`) to render, so open them on the canvas, not from disk. The
canvas is the source of truth: if it changes, export it here again.

| Artboard | Screen | Phase |
|---|---|---|
| `Main.dc.html` | Home `/` | 2 |
| `WhatMaSignChecks.dc.html` | `/what-masign-checks` | 2 |
| `HowItWorks.dc.html` | `/how-it-works` | 2 |
| `About.dc.html` | `/about` | 2 |
| `Workspace.dc.html` | Workspace · Overview tab | 1 (MAS-209) |
| `Workspace-Ask.dc.html` | Workspace · Ask MaSign tab | 3 |
| `Workspace-Text.dc.html` | Workspace · Sources tab | 3 |
| `Workspace-Reviewing.dc.html` | Workspace · review still running (MAS-207) | 3 |
| `Workspace-Invoices.dc.html` | Workspace · Invoices tab | 3 |
| `Workspace-Compare.dc.html` | Workspace · compare contracts | 3 |
| `Workspace-Empty.dc.html` | Workspace · first visit, no contracts | 3 |
| `Standards.dc.html` | `/standards` comparison rules | 3 |
| `Workspace-Phone.dc.html` | Workspace at 390 px | 3 |
| `Workspace-Phone-Drawer.dc.html` | Workspace at 390 px, contracts drawer open | 3 |

`masign-type.css` is the type scale the artboards use; the same values live
in `frontend/src/index.css` (MAS-209 design-system layer).

Visual rules (MassUX, MAS-136 tokens): Inter; `#0caded` fills; `#087eac` for
readable link text on white; `#0a9fd8` button hover; pill buttons with no
shadow and no movement on hover; focus outline 2px `#0caded`, offset 2px.

Contract names, figures and passages on the artboards are the fictional
Northwind demo data — the real screens show the user's own contracts.
