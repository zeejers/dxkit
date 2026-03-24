# dxkit

Your docs are lying to you. Your code has clones it won't admit to 😬. 

Your git history is a crime scene nobody's investigated. `dxkit` fixes all of that.

Static analysis by default and AI when you want it.

```
npm install -g dxkit
```

That gives you `dx` (and `dxkit` if you like typing).

## The tools

### `dx drift` — find docs that lie

Scans your markdown docs and cross-references them against your actual code. Finds function names that don't exist anymore, file paths that lead nowhere, and code examples that stopped working three sprints ago.

```bash
dx drift .
dx drift . --docs docs --src libs,apps/api/src
dx drift . --fix               # show what it would change
dx drift . --fix --apply       # actually change it
```

Add `--ai` and it gets scary good. Instead of just matching strings, it understands that your docs say "timeout defaults to 30s" but the code says 60. Requires an API key (see [AI setup](#ai-setup)).

```bash
dx drift . --ai
dx drift . --ai --ai-model opus
dx drift . --ai --ai-model opus --ai-key sk-ant-your-key-here
dx drift . --docs ~/work/docs-portal/content --src ~/work/api/src,~/work/sdk/src --ai
```

That last one is the power move: docs from your docs repo, source from three other repos.

#### Dev docs vs. product docs

By default, drift assumes developer-facing docs — READMEs, API references, inline markdown that references function names and file paths. If you're scanning customer-facing product docs (Astro Starlight, Docusaurus, GitBook, etc.), use `--mode product`:

```bash
# Product docs: skip static symbol matching, tell the AI to look for
# wrong defaults, missing features, stale config options
dx drift . --docs apps/docs/content --src libs,apps/api --mode product --ai

# Dev docs (default): cross-reference backticked symbols against exports
dx drift . --docs docs --src src
```

In product mode, the static pass is skipped entirely (it would just produce noise — product docs don't reference `connectDB()` or `src/auth.ts`). The AI gets a different briefing that tells it to focus on:

- Default values and limits that don't match source constants
- Described features or config options the code doesn't implement
- Template variables or filter names that aren't registered in source
- UI behavior descriptions that contradict the actual implementation

### `dx ctx` — context before you start

Run this before you touch anything. Give it a plain English description of what you're about to do, and it builds a briefing: which files to start with, recent git history, related tests, and every TODO/FIXME lurking in the area.

```bash
dx ctx "fix the auth bug"
dx ctx "add pagination to the API" --output briefing.md
dx ctx "refactor database layer" --clipboard
```

### `dx rev` — code review on autopilot

Five-pass analysis on your branch: security, performance, quality, tests, style. Gives you a letter grade and a hit list.

```bash
dx rev                          # reviews main..HEAD
dx rev HEAD~5..HEAD             # last 5 commits
dx rev main..feature --strict   # exit 1 on warnings (for CI)
dx rev --pass security,test     # just the passes you care about
```

### `dx flux` — git archaeology

Answers "why does this code look like this?" Shows the full timeline of any file: who changed it, when, why, and whether it's a bug magnet.

```bash
dx flux src/auth.ts
dx flux src/auth.ts --since 2024-01-01
dx flux top                     # most churned files in the repo
dx flux top -n 20
```

### `dx harvest` — find the copypasta

Scans for duplicate code, near-duplicates, inconsistent patterns, and unused exports. Generates a refactoring plan sorted by impact.

```bash
dx harvest .
dx harvest libs --min-similarity 85
dx harvest . --report tech-debt.md
```

## AI setup

AI features are opt-in. Without a key, everything works via static analysis. To enable `--ai`:

Set one of these (checked in this order):

```bash
# 1. dxkit-specific (won't conflict with your other tools)
export DXKIT_API_KEY=sk-ant-...

# 2. Standard env vars
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

Or pass it directly:

```bash
dx drift . --ai --ai-key sk-ant-your-key-here
```

Pick your model:

```bash
dx drift . --ai --ai-model sonnet    # default, good balance
dx drift . --ai --ai-model opus      # best results, slower
dx drift . --ai --ai-model haiku     # fastest, cheapest
dx drift . --ai --ai-model gpt-4o    # if you're an OpenAI person
```

### Custom prompts

The default AI prompt works well for most codebases, but if your project has quirks (Liquid templates, unusual naming conventions, domain-specific jargon), you can customize it:

```bash
dx drift --ai-init    # dumps .dxkit-prompt.md in your project root
```

Edit that file however you want. It supports three template variables: `{{docPath}}`, `{{doc}}`, and `{{source}}`. dxkit auto-detects `.dxkit-prompt.md` in your working directory on every run.

You can also point to any file:

```bash
dx drift . --ai --ai-prompt ~/prompts/strict-mode.md
```

## CI / scripts

Every command supports `--json` for machine-readable output and `--strict` for non-zero exit codes:

```bash
# In your CI pipeline
dx drift . --strict              # fails if docs are broken
dx rev main..HEAD --strict       # fails if code review finds warnings
dx harvest . --json | jq '.duplicates | length'
```

## Install from source

If you're hacking on it or don't want to install globally:

```bash
git clone <repo>
cd dxkit
npm install
npx tsx src/cli.ts drift .
```

## License

MIT
