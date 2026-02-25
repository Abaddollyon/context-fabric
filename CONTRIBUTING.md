# Contributing to Context Fabric

Thanks for your interest in contributing. Here's how to get started.

## Setup

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
npm install
npm run build
```

Requires **Node.js 22.5+** (for the built-in `node:sqlite` module).

## Running Tests

```bash
npm test                  # all tests
npm run test:unit         # unit tests only
npm run test:integration  # integration tests only
npm run test:e2e          # end-to-end tests only
npm run test:coverage     # with coverage report
npm run test:watch        # watch mode
```

All 253 tests should pass before submitting a PR.

## Code Style

- TypeScript strict mode
- No external date libraries (use built-in `Intl` API)
- No external database dependencies (use `node:sqlite`)
- Keep dependencies minimal -- every new dependency needs a strong justification

## Submitting a PR

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests for any new functionality
4. Run `npm test` and make sure everything passes
5. Open a PR with a clear description of what you changed and why

## Reporting Bugs

Open an issue at [github.com/Abaddollyon/context-fabric/issues](https://github.com/Abaddollyon/context-fabric/issues). Include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Node.js version, CLI tool)

## Questions?

Open a [discussion](https://github.com/Abaddollyon/context-fabric/discussions) or file an issue. No question is too small.
