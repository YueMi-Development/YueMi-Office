# Agent Guidelines

## General Principles
- **Don't Overthink**: Keep solutions simple, direct, and pragmatic. Avoid unnecessary abstractions, speculative generality, over-engineering, and scope creep. Solve the problem cleanly with minimal, high-leverage changes.
- **Future-Proofing**: Do not preemptively future-proof unless explicitly requested (YAGNI). When asked to make something future-proof, focus on clean interfaces, modularity, and clear separation of concerns rather than complex speculative architectures or premature abstractions.

## Git Commits
- Follow **Conventional Commits** specification with clear prefixes:
  - `feat`: New features or capabilities
  - `fix`: Bug fixes
  - `chore`: Maintenance, configuration, dependency updates, or agent setup
  - `refactor`: Code changes that neither fix a bug nor add a feature
  - `docs`: Documentation updates
  - `style`: Formatting, missing semi-colons, whitespace fixes (no functional code changes)
  - `test`: Adding or updating tests
  - `perf`: Performance improvements
  - `ci`: CI/CD workflows and automation changes
- **Scopes**: When changes target a specific area, component, or package, include an explicit scope in parentheses: `<type>(<scope>): <description>` (e.g., `chore(agent): update skills`, `feat(renderer): add typst preview`, `fix(ui): fix editor layout`).
- Keep commit messages concise, descriptive, and in the imperative mood (e.g., `feat(export): add document export option`, `chore(deps): update dependencies`).
