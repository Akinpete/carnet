# Carnet

Learn French from the French you actually encounter. Collect it, drill it, speak it back.

> **Status: pre-alpha.** The foundations (M0) are in place: sign-up, sign-in and an empty app shell. There are no learning features yet. See [Status](#status).

<!-- Screenshot goes here once a real screen exists: the ruled journal, or a speaking card mid-session. -->

## Why it exists

Most language apps test recognition: pick the right translation out of four. Being able to recognise a word is not the same as being able to say it, and that gap only closes by practising production. The vocabulary should also be yours: the words you met this morning in an article, a screenshot or a café, not a syllabus someone else chose.

## How it will work

- **Collect.** Paste a screenshot, share a link or type a word you overheard. Carnet pulls out the French and lets you tick the words worth keeping.
- **Climb the ladder.** Every word sits on one of five rungs: recognition, recall, comprehension, production and inflection. Pass and the word climbs; miss and it drops back to a question you can answer. Spaced repetition decides *when* a word comes back, and the ladder decides *what* it asks.
- **Speak it back.** Once a word is familiar, cards stop asking what it means and ask you to use it out loud, in a sentence you make up. Answers are graded on meaning, not string matching. "Type it instead" is always available.
- **Corrections that diagnose.** A miss tells you *why* you got it wrong (a false friend, a confused pair, a tense you haven't met yet), not just what the right answer was.
- **A ruled journal.** Write a line in English and its French goes directly beneath. Attempt the French yourself, ask for a hint, or be shown. Words you reach for and miss become tomorrow's cards.
- **A grammar spine.** Seven stages, from the present tense to the conditional, taught with verbs from your own collection. You advance by producing the grammar correctly, not by putting in time.

Carnet has no streaks, no leagues, no placement test and no screen monitoring. You decide what is worth keeping.

## Status

The app shell and accounts exist. Nothing that teaches French does yet.

| | Milestone | State |
| --- | --- | --- |
| M0 | Foundations: repo, auth, PWA shell, CI | Done |
| M1 | The loop: typed capture, SM-2 scheduling, recognition and recall cards | **Next** |
| M2 | Real capture: paste, screenshots, links, voice notes, share target | Not started |
| M3 | Voice and production: audio, speech input, open-form grading, diagnosis | Not started |
| M4 | The journal | Not started |
| M5 | Grammar | Not started |
| M6 | Public release: self-hosting guide, contributor path | Not started |

Each milestone has a gate to meet before the next one starts. M1's gate is fourteen days of real personal use. Its point is to find out whether reviewing vocabulary you collected yourself is worth building everything else for.

## Planned stack

- **Frontend:** React 19 and TypeScript, Vite, an installable PWA with a share target
- **Backend:** Hono and Drizzle, with one schema compiled to SQLite (Cloudflare D1) or Postgres
- **Hosted:** Cloudflare Workers, D1, R2, KV and AI Gateway
- **Self-hosted:** Node, Postgres and MinIO via `docker compose`, pointed at any OpenAI-compatible model endpoint, with no Cloudflare account needed

## Running it locally

You need Node 22 or newer. No Cloudflare account is needed to run it locally.

```bash
npm install
npm run db:migrate:local
npm run dev        # http://localhost:5173
npm test           # runs inside the Workers runtime, with local D1 and KV
npm run typecheck
```

A self-hosted path (Node, Postgres and MinIO via `docker compose`, pointed at any OpenAI-compatible model endpoint) arrives with the public release.

## Contributing

It's too early for code contributions: the foundations are still settling. A `CONTRIBUTING.md` and a set of `good first issue`s will arrive with the public release (M6).

## Licence

Carnet is released under the [GNU AGPL-3.0](LICENSE).
