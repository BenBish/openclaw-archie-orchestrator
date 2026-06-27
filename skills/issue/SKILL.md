---
name: issue
description: "Use when the user wants to create, design, triage, or groom engineering issues before implementation."
---

# Issue

Prepare implementation-ready issues with clear acceptance criteria.

## Workflow

1. Identify whether the user is creating a feature, filing a bug, designing an existing issue, or grooming backlog work.
2. Produce a concise technical design:
   - goal
   - constraints
   - likely implementation areas
   - data/API/interface changes if any
   - risks and tradeoffs
   - acceptance criteria
3. If an issue provider is configured, create or update the issue using that provider.
4. Suggest using the `work` skill only after the issue has enough detail to implement safely.

## Guardrails

- Do not invent missing acceptance criteria; mark unknowns clearly.
- Do not implement while designing an issue.
- Keep provider-specific details configurable.
