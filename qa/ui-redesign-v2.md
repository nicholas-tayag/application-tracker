# UI redesign v2

## Why the previous interface felt hard to use

- The first viewport contained ranking, location, status, six tracker metrics, five agent metrics, queue cards, dream roles, source tabs, filters, and the role list at once.
- The permanent sidebar made preferences look like the primary task even though selecting and acting on a role is the daily workflow.
- At tablet widths the sidebar became a tall control preamble and pushed the sticky application header below the fold.
- Most surfaces had equal visual weight, so the eye had no clear starting point.
- Compact typography and dense pills made the role list technically efficient but emotionally noisy.

## V2 direction

The new information architecture follows a Today / Discover / Applications / Analytics mental model. Today is the calm landing context. Search and three summary metrics lead into one primary split workspace: roles on the left and selected-role detail on the right. Ranking, location, status, pay, tags, and other secondary controls live in the existing Filters panel. Review queue, dream roles, and pipeline status follow the primary workspace.

The visual system uses true white, cool neutral separators, a restrained cobalt accent, SF-system typography, 7–14px radii, and almost no elevation. This is informed by Apple’s emphasis on clear hierarchy and platform-consistent navigation, plus the compact command surfaces of Linear and Raycast. No code or assets were copied.

Concept:

`/Users/nicky/.codex/generated_images/019eef98-d382-70f2-ae5c-7edcc4854b6a/ig_097c2bcc5990d034016a393dc9332c81938da766edf4a1d578.png`

## DOM compatibility

All existing element IDs are preserved. No JavaScript dependency or application logic changed. The application-agent containers remain `agentOverview`, `agentMetrics`, and `agentQueue`.
