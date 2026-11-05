# Xirang (息壤)

**Bring different AI models and developers together to work on the same project.**

Xirang is an engineering collaboration template for AI-assisted development. Shared project rules connect different models, isolated Git worktrees separate parallel tasks, and tests and QA gates guide changes into the main branch.

**Handoffs between models · Teamwork across computers · Parallel tasks on one machine · Resumable work · Verifiable delivery**

[Common commands (Chinese)](docs/guides/commands.md) · [Quickstart (Chinese)](docs/guides/quickstart.md) · [Plugin setup (Chinese)](docs/guides/plugin-quickstart.md) · [Parallel workflow (Chinese)](docs/guides/parallel-collaboration.md) · [Full reference (Chinese)](docs/guides/template-reference.md) · [中文](README.md)

## One project, three ways to collaborate

| Collaboration scenario | How Xirang supports it |
| --- | --- |
| **Different models working on the same project** | Tools such as Claude Code, Codex, and Gemini CLI follow the same project rules, acceptance criteria, and delivery workflow. When switching tools, continue from recorded task state, evidence, and context capsules. |
| **People developing in parallel across computers** | Each task has its own branch and worktree for development, verification, and a PR. Recheck the base and proposed commits before merging so outdated verification cannot overwrite someone else's delivery. |
| **Multiple tasks running on one machine** | Open several AI sessions, each in its own worktree, with separate dependency installations, edits, and tests. Reduce accidental overwrites and interference between dependency directories. |

These approaches can be combined: team members can use different AI tools, while each person runs several independent tasks on their own computer.

Worktrees isolate files and dependency directories. Shared services, ports, databases, and business interfaces still require coordination. Parallel development does not mean zero conflicts: tasks that touch the same interface or file, or depend on one another, need agreed boundaries followed by merge resolution and verification.

## One workflow from task to delivery

- **Shared rules:** Project conventions live in the repository and remain consistent when you switch chats or models.
- **Independent tasks:** Each change has a task ID, explicit acceptance criteria, and a dedicated workspace to reduce overwrites.
- **Resumable work:** Task state, execution evidence, and context capsules record progress for the next session. Merging on another computer requires running QA again on that computer.
- **Verifiable delivery:** Changes go through targeted checks, a PR, and QA. Recheck commit SHAs before merging; stop on drift or conflicts, then sync and validate again.
- **Controlled upgrades:** Ownership rules separate template files from project files. Version baselines and three-way updates preserve customization and report conflicts explicitly.

Routine fixes, refactoring, and documentation use a lightweight workflow. Changes to requirements, architecture, or external contracts follow PRD → ARCH → TASK → TDD → QA, with OPS added for environment and release work. Rules, commands, and evidence define completion beyond a claim that the code is finished.

## Who is it for?

- Developers who want to choose different AI tools for different tasks while keeping project rules and delivery standards consistent.
- Individual developers who want multiple AI sessions to advance independent tasks on one machine.
- Teams developing in parallel across computers with shared acceptance and merge conventions.
- Maintainers who want to adopt the collaboration workflow in an existing codebase, then add architecture modules as needed.

For a one-off script or a small experiment without collaboration needs, weigh the cost of task and QA procedures first. Xirang requires Git, Node.js, pnpm, and people following the conventions. It is not an automatic task scheduler that you enable with one click.

## Start with one successful installation

Adopt the **workflow package** first. It provides the protocol, task tracking, worktree management, and delivery tools without requiring a new application stack.

In an AI session opened in the Xirang source project, ask to “initialize a project at `<absolute-target-path>`” to check the target, preview changes, install files, and verify the result without changing the target's Git metadata. The default installs only the workflow package. Existing Git repositories can also be initialized directly from the source and target main directories; installation does not require creating a worktree. For later updates, open the actual project and ask to “update the Xirang template” to fetch the latest official `main` from GitHub. See [common commands (Chinese)](docs/guides/commands.md).

Run the following from an existing Xirang source checkout. The target directory must exist; initialization supports existing Git repositories and preserves their Git metadata:

```bash
pnpm agent -- template update "<target-directory>" --scope agent --initialize --dry-run
pnpm agent -- template update "<target-directory>" --scope agent --initialize
```

Follow the [quickstart (Chinese)](docs/guides/quickstart.md) for obtaining the source, preparing the environment, and checking the generated files. Successful installation produces the protocol and baseline files, with no pending changes on a repeated dry run. Passing application tests is a separate project acceptance step.

## Start developing in parallel

1. Agree on task boundaries, shared contracts, and acceptance criteria.
2. Give each person or AI session a separate task ID and linked worktree.
3. Implement and run the smallest sufficient verification in that worktree.
4. Push a PR, verify QA against fixed commits, and recheck before merging.
5. Reconcile the main branch and remote, then close the task through lifecycle gates.

The [two-task exercise (Chinese)](docs/guides/parallel-collaboration.md) provides task instructions, key commands, and conflict handling you can follow.

For example, one session can develop an independent module while another adds tests or documentation for a different module. Assign files and interfaces before distributing tasks to models or teammates. Agree on ownership and merge order for shared interfaces and dependency lockfiles.

Local locks coordinate lifecycle operations only on the current computer. Across computers, remote SHA checks and non-fast-forward rejection of ordinary, non-forced pushes protect the main branch. When the base changes, follow the gates' instructions to sync and validate again.

## Working with AI coding tools

Xirang uses repository files and CLI commands as the collaboration interface and does not depend on one model. The repository provides these entry points:

| Repository entry | Purpose |
| --- | --- |
| `AGENTS.md` | Shared rules, phase routing, and delivery conventions |
| `CLAUDE.md`, `.claude/` | Rule entry point and configuration materials for Claude Code |
| `.codex/` | Configuration materials for Codex; shared rules enter through `AGENTS.md` |
| `GEMINI.md`, `.gemini/` | Rule entry point and configuration materials for Gemini CLI |

Other AI coding tools can adopt the same protocol if they can read project rules, operate on files, and run the required commands. Compatibility depends on client capabilities and permissions; an entry point does not mean every client version has been tested. Use the [tool integration checks (Chinese)](docs/guides/quickstart.md#工具接入检查) to confirm that rules are loaded and commands work.

A lightweight `0.1.0` plugin provides four skills: adoption, task startup, recovery, and delivery checks. Claude Code and OpenAI local marketplace manifests point to the same source package. See [plugin setup and tested scope (Chinese)](docs/guides/plugin-quickstart.md). It has not been submitted to public marketplaces, and installing the plugin does not install the template into a target project.

## Adopt architecture capabilities as needed

The collaboration workflow and application architecture can be adopted independently. Add `--include architecture` when you need the architecture planning entry point, then select modules for your project with `architecture plan/init/check`. Do not combine it with `--scope agent`.

The architecture package provides multi-platform monorepo blueprints and materials for selecting and generating UI components, storage, and open-source modules. See the [architecture package](architecture/README.md) and [catalog](architecture/open-source-catalog.json) for available options, adoption conditions, and boundaries. It is not a universal generator for every technology stack.

## Further reading and contribution

- [Full reference (Chinese)](docs/guides/template-reference.md): Installation, routine updates, legacy adoption, architecture selection, upgrades, and recovery.
- [Workflow package](agent/README.md) / [Architecture package](architecture/README.md): Detailed entry points for the two packages.
- [Engineering conventions](docs/CONVENTIONS.md) / [Execution rules](AGENTS.md): Sources of truth for rules and commands.
- [Contributing](CONTRIBUTING.md): Report issues, share adoption experiences, and propose improvements.
- [Changelog](CHANGELOG.md): Template releases and changes.

Report issues through [GitHub Issues](https://github.com/hollisyao2024/PromptsEngineering/issues) with sanitized reproduction steps. Adoption experiences and failure cases are welcome. If the project helps you, a star makes it easier to find again.

License status: `package.json` declares MIT, but the repository currently lacks a root license text. Third-party components retain their own licenses; check the applicable terms first. See the [promotion plan (Chinese)](docs/promotion/README.md) for promotion and contribution readiness.
