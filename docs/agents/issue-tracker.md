# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `Randallsm83/easterseals-v2`.
Use `gh` with explicit repository selection: this checkout also has GitLab remotes.

## Operations

```bash
gh issue create --repo Randallsm83/easterseals-v2 --title "..." --body-file <file>
gh issue view <number> --repo Randallsm83/easterseals-v2 --comments
gh issue list --repo Randallsm83/easterseals-v2 --state open --json number,title,body,labels,comments
gh issue comment <number> --repo Randallsm83/easterseals-v2 --body-file <file>
gh issue edit <number> --repo Randallsm83/easterseals-v2 --add-label "<label>"
gh issue edit <number> --repo Randallsm83/easterseals-v2 --remove-label "<label>"
gh issue close <number> --repo Randallsm83/easterseals-v2 --comment "..."
```

Filter issue lists by label and state as needed. Read bodies, labels, and comments before acting.
“Publish to the issue tracker” means create a GitHub issue.
“Fetch the relevant ticket” means read the issue and its comments.

When opening a pull request, include `--repo Randallsm83/easterseals-v2 --assignee @me`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares issue and PR numbers. Resolve an ambiguous number with
`gh pr view <number> --repo Randallsm83/easterseals-v2`; fall back to `gh issue view`.

## Wayfinding and blocking

- Map: one issue labelled `wayfinder:map`, holding Notes, Decisions-so-far, and Fog.
- Children: link tickets as GitHub sub-issues. If unavailable, use a task list in the map and a `Part of #<map>` line in each child.
- Types: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Blocking: use native GitHub issue dependencies. Add an edge with
  `gh api --method POST repos/Randallsm83/easterseals-v2/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-database-id>`.
  Obtain the database ID with
  `gh api repos/Randallsm83/easterseals-v2/issues/<blocker> --jq .id`.
- If native dependencies are unavailable, record `Blocked by: #<number>` in the child.
- Frontier: select the first open, unassigned child in map order with no open blockers.
  Native `issue_dependencies_summary.blocked_by` counts open blockers; for fallback links, read blocker states.
- Claim: `gh issue edit <number> --repo Randallsm83/easterseals-v2 --add-assignee @me`.
- Resolve: comment with the answer, close the child, and append a gist plus source link to the map’s Decisions-so-far.
