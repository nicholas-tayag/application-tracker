# Outcome monitoring design

This module turns imported manual, email-derived aggregate, and portal signals into
conservative application-history and cohort analytics.

## Safety and evidence rules

- Signals are deduplicated by explicit ID or a deterministic content fingerprint.
- Forward stage transitions are accepted. Regressions are retained as evidence but do
  not change the current stage.
- A terminal stage is never overwritten automatically by a conflicting terminal
  signal. The conflict is returned for human review.
- Rejections do not erase a previously reached OA or interview when computing funnel
  conversion.
- Silence is labeled `stale` or `ghosted` only for follow-up. Neither label is treated
  as an employer decision or rejection.
- A rejection reason is `confirmed` only when its evidence type is
  `recruiter_feedback` or `hiring_team_feedback`. All other explanations remain
  hypothesis inputs.

## Comparison baseline

The frozen private baseline is 158 applications with a 6.33% OA rate, 1.27%
interview rate, and 1.27% offer rate. Each cohort reports absolute percentage-point
lift and relative lift from that baseline.

Analytics are partitioned by master resume, submission month, and their combination.
The default minimum sample warning is 20 submissions. Comparisons are observational:
role mix, employer selectivity, timing, geography, eligibility, incomplete outcome
capture, and applicant volume remain confounders.

## Public API

- `normalizeOutcomeSignals(signals)`
- `reconcileOutcomeSignals(applications, signals, options)`
- `computeOutcomeAnalytics(applications, options)`
- `generateImprovementHypotheses(analytics, options)`

All functions return new values and do not mutate caller-owned records.
