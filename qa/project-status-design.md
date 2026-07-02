# Project status registry

This subsystem is a local, dependency-free checkpoint registry for a future
project-progress UI. It deliberately does not claim live access to agents,
processes, or orchestration state.

## Data contract

Each workstream contains tasks with an owner, one of four statuses
(`queued`, `running`, `completed`, or `blocked`), progress from 0 through 100,
the current step, last-update timestamp, verification summary, blocker, and
completed deliverables.

`normalizeProjectStatus` creates a stable UI-facing shape.
`updateProjectTask` validates lifecycle transitions and timestamps a checkpoint.
`summarizeProjectStatus` derives counts, stale tasks, blockers, deliverables,
workstream progress, and overall progress.
`deriveOverallProgress` uses an equal-weight average across tasks. This avoids
inventing effort estimates; a future caller can split unusually large tasks
into smaller explicit checkpoints.

Completed tasks are immutable by default. A deliberate caller can pass
`allowReopen: true` when a completed checkpoint genuinely needs to be reopened.
Tasks are stale only when they are incomplete and their last update is older
than the configured threshold.

## Persistence boundary

The module performs no file I/O. The server or automation integrating it should
persist a private registry outside the static web root, write atomically, and
call these pure functions before saving. `data/project-status.template.json`
is schema documentation and onboarding data, not a source of live truth.
