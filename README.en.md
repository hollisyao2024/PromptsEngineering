# Xirang (息壤)

**An engineering workflow template for parallel development with people and AI coding sessions.**

Connect vibe coding to explicit acceptance criteria, isolated Git worktrees, tests, QA, and verified merges. Keep task state and evidence so interrupted work has a recovery path.

[中文](README.md) · [Quickstart (Chinese)](docs/guides/quickstart.md) · [Parallel workflow (Chinese)](docs/guides/parallel-collaboration.md) · [Technical reference (Chinese)](docs/guides/template-reference.md)

## Why use it?

| Problem | Mechanism |
| --- | --- |
| Sessions overwrite each other's working files | A dedicated linked worktree for each change, with independent dependencies |
| “Done” means different things to each agent | Observable acceptance criteria and delivery gates |
| An interrupted task loses its context | Task state, evidence, and bounded context capsules |
| The commit changes after QA | Base/head SHA checks before merging |
| Template upgrades overwrite project decisions | Ownership rules, version baselines, and explicit conflict handling |

These mechanisms help manage risk. They do not guarantee correct AI output or eliminate semantic conflicts between tasks.

## Start with the workflow package

Prerequisites: Git, Node.js, and pnpm. Use the pnpm version declared in the source repository's `package.json`. The following commands use a POSIX shell. Choose a parent directory where neither example directory already exists.

```bash
git clone https://github.com/hollisyao2024/PromptsEngineering.git xirang-source
mkdir xirang-demo
cd xirang-source
pnpm agent -- template update ../xirang-demo --scope agent --dry-run
pnpm agent -- template update ../xirang-demo --scope agent
pnpm agent -- template update ../xirang-demo --scope agent --dry-run
```

Stop on conflicts or a blocked status. Successful adoption means the target contains the rule files, project configuration, `xirang.lock.json`, and `.xirang/baselines/`, and the repeated dry run has no pending changes. This checks template installation; it does not validate an application.

For an existing Git project, prepare a clean dedicated linked worktree using that project's lifecycle, and use its path as the target. Do not apply directly over a busy working directory.

Open the target project in your coding tool. Before any further project changes, have it fully read `AGENTS.md`, `docs/CONVENTIONS.md`, and `RULES.md`. Keep the lock and baselines in version control. Configure your own project remote, ignored `.env.local` with `GH_TOKEN`, and real verification commands before attempting remote task delivery. See the [setup guide](docs/guides/quickstart.md).

## Parallel development

1. Agree on task boundaries, shared contracts, and acceptance criteria.
2. Give each person or AI session a separate task ID and linked worktree.
3. Implement and run the smallest sufficient verification in that worktree.
4. Push a PR, verify QA against fixed commits, and recheck before merging.
5. Reconcile the main branch and remote, then close the task through lifecycle gates.

The delivery sequence is `tdd sync → tdd push → qa plan → qa verify → qa merge` through `pnpm agent --`. These commands are part of the task lifecycle, not a replacement for task registration and evidence.

If another task merges first, sync and validate against the updated base as required by the tools. Local locks do not coordinate separate computers; remote SHA checks and non-forced pushes protect integration. See the [two-task exercise](docs/guides/parallel-collaboration.md).

## Coding tools and optional architecture

The repository provides `AGENTS.md`, Claude Code entry files, Codex configuration materials, and Gemini CLI entry files. A separate `0.1.0` plugin packages four workflows for adoption, isolated tasks, recovery, and delivery checks. Claude Code and OpenAI local catalogs point to the same package. Validate rule loading, permissions, and client behavior in your environment; no public directory submission has been made. See [plugin setup and tested scope (Chinese)](docs/guides/plugin-quickstart.md).

Adopt the workflow without changing your application stack. Add `--include architecture` separately when you want the lightweight architecture entry, then select and initialize the modules your project needs. Do not combine that option with `--scope agent`. See the [architecture package](architecture/README.md) and [catalog](architecture/open-source-catalog.json) for available implementations and boundaries.

## Feedback, contribution, and distribution

- Report reproducible issues through [GitHub Issues](https://github.com/hollisyao2024/PromptsEngineering/issues). Remove tokens, personal data, and raw production logs.
- Share adoption reports with environment, source revision, commands, outcomes, and remaining friction. See [contributing](CONTRIBUTING.md).
- Read the [changelog](CHANGELOG.md) and [upgrade reference](docs/guides/template-reference.md) before updating an existing installation.
- Local plugin distribution files are available; public marketplace publication remains a separate step. See the [distribution assessment](docs/promotion/distribution.md).

License status: `package.json` declares MIT, but the repository currently lacks a root license text. Third-party components retain their own licenses; confirm the applicable terms before redistribution.
