---
name: research
description: "Use when the user asks to investigate a repository, architecture, bug, feature feasibility, or external technical context before planning or implementation."
---

# Research

Investigate before changing code.

## Workflow

1. Identify the question and the target repository, path, issue, or system.
2. Read primary sources first: code, tests, docs, schemas, configs, and logs.
3. Summarize findings with evidence and file references.
4. Separate facts from inferences.
5. Recommend the smallest next step.

## Guardrails

- Do not mutate files during research unless the user explicitly switches to implementation.
- Do not include secrets or private logs in summaries.
- If external facts may have changed, verify them from primary sources.
