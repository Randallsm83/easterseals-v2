# Domain docs

## Layout and reading rules

Use one shared domain context for this repository’s client and server.

Before exploring a domain:
- Read root `CONTEXT.md` if present.
- Read relevant decisions under root `docs/adr/` if present.

If these documents are absent, proceed silently. Domain modeling creates them
lazily as terms and decisions are resolved; do not create empty placeholders.

## Vocabulary

Use terms defined in `CONTEXT.md` when naming concepts in issues, designs,
hypotheses, and tests. When a needed term is missing, reconsider the wording
or surface the gap for domain modeling.

## Decision conflicts

Explicitly identify any proposal that contradicts an existing ADR,
including the ADR reference and reason for reconsideration.
