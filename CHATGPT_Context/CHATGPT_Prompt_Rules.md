# CHATGPT Prompt Rules for Codex Tasks

## Required Prompt Header Format
Every prompt must start with this exact format:

`{Model} - {Mode}`

Allowed `Model` values:
- `Codex 5.3`
- `GPT 5.5`

Allowed `Mode` values:
- `Low`
- `Medium`
- `High`
- `Very High`

## Model Selection Rules
- Use `Codex 5.3` for:
  - Code edits
  - Repo inspection
  - Running tests/commands
  - Debugging implementation
  - Refactors
  - Creating/updating files
- Use `GPT 5.5` for:
  - Planning and architecture reasoning
  - Explaining tradeoffs
  - Writing docs/briefs
  - Strategy review
  - High-level debugging analysis before implementation

## Mode Selection Rules
- `Low`:
  - Tiny edits
  - Typo fixes
  - One-file obvious changes
- `Medium`:
  - Small-to-moderate implementation
  - Limited file scope
- `High`:
  - Multi-file changes
  - Debugging with repo context
  - Security/deployment/test-sensitive tasks
- `Very High`:
  - Complex architecture work
  - Difficult bugs
  - Migrations
  - Major refactors
  - Risky or high-impact changes

## Token-Heavy Tool Restrictions
- Default to repo-file and log-driven workflows.
- Avoid token-heavy tools unless the user explicitly requests them or they are genuinely required to solve the task.
- Avoid by default:
  - screen capture
  - screenshots
  - browser/web access
  - UI inspection tools
  - computer-use/desktop automation tools
  - auto-scripted broad repo scans
- Workflow default:
  - inspect targeted files first
  - use repo text search only when needed
  - prefer exact file paths from user/context
  - use minimal commands
  - avoid broad recursive scans unless truly required

## Prompt Types

### 1. Starting Prompt
Use when starting a new task or when Codex lacks context.

Rules:
- Can be longer and precise.
- Include goal, target files/folders, relevant context, constraints, acceptance criteria.
- Tell Codex exactly which files/folders to inspect first.
- Include what not to touch.
- Include validation commands.
- Include expected output summary.
- Avoid token-heavy tools by default (screen capture/screenshots, browser/web, UI inspection, computer-use/desktop automation, broad auto-scripting) unless explicitly requested or required.

Template:

```text
Codex 5.3 - High

Goal:
[clear task]

Context:
[only relevant repo-grounded context]

Inspect first:
- [exact file/folder path]
- [exact file/folder path]

Rules:
- Do not modify unrelated files.
- Do not change secrets or env values.
- Keep existing style/patterns unless there is a clear reason to change.
- Use targeted file/path inspection first; avoid token-heavy tools unless explicitly requested or required.
- [project-specific rule]

Acceptance criteria:
- [specific result]
- [specific result]

Validation:
- [command]
- [command]

Output:
- Summarize changed files.
- Mention tests/checks run.
- Mention anything not completed.
```

### 2. Follow-up Prompt to a Previous Task
Use when continuing from Codex output.

Rules:
- Be shorter.
- Do not repeat unnecessary repo context.
- Refer to the previous result.
- State only what must change next.
- Include files from prior result if relevant.
- Include validation commands only if needed.
- Ask for concise changed-file summary.
- Keep tool use minimal; avoid screen capture/screenshots, browser/UI inspection, computer-use automation, and broad auto-scans unless explicitly requested or required.

Template:

```text
Codex 5.3 - Medium

Continue from your previous result.

Next change:
[single next objective]

Touch only:
- [file path]
- [file path]

Constraints:
- Keep previous behavior intact except for the requested change.
- Do not edit unrelated files.
- Prefer exact file paths and minimal commands; avoid token-heavy tools unless explicitly requested or required.

Validation (if needed):
- [command]

Output:
- Short summary of changed files.
- What you validated.
```

### 3. Minor Fix Prompt
Use for tiny direct changes.

Rules:
- Very simple and direct.
- One goal only.
- Mention exact file/component when known.
- Avoid long explanations.
- Avoid repeating repo context.
- Include minimum validation only.
- Avoid token-heavy tools by default (screenshots/screen capture, browser/UI inspection, computer-use automation, broad auto-scans) unless explicitly requested or required.

Template:

```text
Codex 5.3 - Low

Goal:
[small direct fix]

File:
- [exact file path]

Rules:
- Only make this change.
- Do not touch unrelated files.
- Use targeted file edits and minimal commands; avoid token-heavy tools unless explicitly requested or required.

Validation:
- [single quick check]

Output:
- Confirm file changed and result.
```

## Example Prompt Style

```text
Codex 5.3 - High

Goal: [clear task]

Context:
[only relevant context]

Inspect first:
- [file/folder]
- [file/folder]

Rules:
- Do not modify unrelated files.
- Do not change secrets or env values.
- Keep the existing style unless there is a clear reason.

Acceptance criteria:
- [specific result]
- [specific result]

Validation:
- [command]
- [command]

Output:
- Summarize changed files.
- Mention tests/checks run.
- Mention anything not completed.
```

## Important Writing Rules for ChatGPT Prompts
- Be specific about absolute or repo-rooted paths.
- Prefer repo-grounded instructions over vague design wishes.
- Ask Codex to inspect before editing.
- Explicitly state what not to touch.
- Keep follow-ups short and delta-focused.
- For UI changes: describe visual goal + affected component, avoid browser/screenshot requirements unless necessary.
- Default to file/path-targeted prompts and minimal commands; avoid broad recursive scans unless task-critical.
- For bug prompts: include observed behavior, expected behavior, logs/errors, and likely files.
- For deployment prompts: include exact commands and actual output when available.
- For security/database prompts: default to `High` or `Very High` and require validation.

## Quick Defaults for This Repo
- Backend/API implementation task: `Codex 5.3 - High`
- Frontend small change (1-2 files): `Codex 5.3 - Medium`
- Tiny one-file fix: `Codex 5.3 - Low`
- Planning only before coding: `GPT 5.5 - High`
- Migration/refactor with risk: `Codex 5.3 - Very High`
