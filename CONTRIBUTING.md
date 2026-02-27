# Contributing

Thanks for contributing to `microvm`.

## Before You Start

- Read [docs/architecture.md](docs/architecture.md). It is the project baseline.
- Use small, focused changes with tests.

## Local Setup

```bash
bun install
bun run src/index.ts doctor
```

## Quality Gates

Run before opening a PR:

```bash
bun run check
```

This runs typecheck, lint, and tests.

## Pull Requests

- Describe the behavior change and why it is needed.
- Include tests for new behavior and regressions.
- Keep error handling typed and explicit.
- Keep functional-core / imperative-shell boundaries intact.

## Commit and Review Expectations

- Prefer clear, imperative commit messages.
- Avoid unrelated refactors in the same PR.
- Respond to review with code or technical reasoning.
