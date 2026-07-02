import test from "node:test";
import assert from "node:assert/strict";
import {
  HISTORICAL_BASELINE,
  computeOutcomeAnalytics,
  normalizeOutcomeSignals,
  reconcileOutcomeSignals
} from "../lib/outcome-monitor.mjs";

function application(overrides = {}) {
  return {
    id: "app-1",
    company: "Example",
    role: "Software Engineer",
    masterResume: "swe",
    stage: "submitted",
    submittedAt: "2026-05-01T12:00:00Z",
    updatedAt: "2026-05-01T12:00:00Z",
    ...overrides
  };
}

test("normalizes aliases and deduplicates imported outcome signals", () => {
  const signal = {
    applicationId: "app-1",
    source: "portal",
    stage: "online assessment",
    observedAt: "2026-05-03T12:00:00Z",
    evidence: "Assessment portal opened"
  };
  const result = normalizeOutcomeSignals([signal, signal, { stage: "offer" }]);
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].stage, "assessment");
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.invalid.length, 1);
});

test("applies forward transitions while ignoring regressions and duplicate signals", () => {
  const signals = [
    {
      id: "assessment",
      applicationId: "app-1",
      source: "email_aggregate",
      stage: "assessment",
      observedAt: "2026-05-03T12:00:00Z"
    },
    {
      id: "old-submit",
      applicationId: "app-1",
      source: "portal",
      stage: "submitted",
      observedAt: "2026-05-04T12:00:00Z"
    },
    {
      id: "assessment",
      applicationId: "app-1",
      source: "email_aggregate",
      stage: "assessment",
      observedAt: "2026-05-03T12:00:00Z"
    }
  ];
  const result = reconcileOutcomeSignals([application()], signals);
  assert.equal(result.applications["app-1"].stage, "assessment");
  assert.equal(result.applied.length, 1);
  assert.equal(result.duplicates.length, 1);
  assert.ok(result.ignored.some((item) => item.reason === "stage regression ignored"));
});

test("does not overwrite terminal outcomes when later sources conflict", () => {
  const result = reconcileOutcomeSignals(
    [application({ stage: "rejected" })],
    [{
      id: "portal-offer",
      applicationId: "app-1",
      source: "portal",
      stage: "offer",
      observedAt: "2026-06-01T12:00:00Z"
    }]
  );
  assert.equal(result.applications["app-1"].stage, "rejected");
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0].reason, /terminal stage/);
});

test("labels inactivity conservatively without converting silence to rejection", () => {
  const result = reconcileOutcomeSignals(
    [
      application({ id: "stale", updatedAt: "2026-05-10T00:00:00Z" }),
      application({
        id: "ghosted",
        submittedAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z"
      }),
      application({
        id: "closed",
        stage: "rejected",
        submittedAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z"
      })
    ],
    [],
    { now: "2026-06-22T00:00:00Z", staleAfterDays: 30, ghostedAfterDays: 60 }
  );
  assert.equal(result.applications.stale.monitoring.state, "stale");
  assert.equal(result.applications.ghosted.monitoring.state, "ghosted");
  assert.match(result.applications.ghosted.monitoring.note, /not a confirmed rejection/);
  assert.equal(result.applications.closed.monitoring.state, "current");
});

test("only direct recruiter evidence produces a confirmed rejection reason", () => {
  const result = reconcileOutcomeSignals(
    [
      application({ id: "direct" }),
      application({ id: "inferred" })
    ],
    [
      {
        applicationId: "direct",
        stage: "rejected",
        source: "manual",
        observedAt: "2026-05-10T00:00:00Z",
        reason: "Required five years of production experience",
        evidenceType: "recruiter_feedback"
      },
      {
        applicationId: "inferred",
        stage: "rejected",
        source: "email_aggregate",
        observedAt: "2026-05-10T00:00:00Z",
        reason: "Likely failed ATS keyword screen"
      }
    ]
  );
  assert.equal(result.applications.direct.outcomeReasons[0].label, "confirmed");
  assert.equal(result.applications.inferred.outcomeReasons[0].label, "hypothesis_input");
  assert.match(result.applications.inferred.outcomeReasons[0].note, /not treated as confirmed/);
});

test("computes baseline lift from highest stage reached after later rejection", () => {
  const records = [
    application({
      id: "swe-oa-rejected",
      stage: "rejected",
      outcomeSignals: [{
        id: "oa-1",
        applicationId: "swe-oa-rejected",
        source: "portal",
        stage: "assessment",
        observedAt: "2026-05-05T00:00:00Z"
      }]
    }),
    application({
      id: "ai-interview",
      masterResume: "ai",
      stage: "interview",
      submittedAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-15T00:00:00Z"
    }),
    application({
      id: "swe-pending",
      submittedAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z"
    })
  ];
  const analytics = computeOutcomeAnalytics(records, {
    now: "2026-06-22T00:00:00Z",
    minimumSampleSize: 20
  });
  assert.equal(analytics.overall.submitted, 3);
  assert.equal(analytics.overall.oa.count, 2);
  assert.equal(analytics.overall.interview.count, 1);
  assert.equal(
    analytics.overall.oa.percentagePointLift,
    (2 / 3 - HISTORICAL_BASELINE.oaRate) * 100
  );
  assert.equal(analytics.cohorts.byMasterResume.length, 2);
  assert.equal(analytics.cohorts.bySubmissionMonth.length, 2);
  assert.match(analytics.overall.sampleWarning, /Directional only/);
  assert.match(analytics.hypotheses.warning, /minimum sample/);
});

test("partitions cohorts by resume and submission date filters", () => {
  const records = [
    application({ id: "may-swe", submittedAt: "2026-05-10T00:00:00Z" }),
    application({
      id: "june-ai",
      masterResume: "AI Engineer Master",
      stage: "offer",
      submittedAt: "2026-06-10T00:00:00Z",
      updatedAt: "2026-06-20T00:00:00Z"
    })
  ];
  const analytics = computeOutcomeAnalytics(records, {
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    now: "2026-06-30T00:00:00Z",
    minimumSampleSize: 1
  });
  assert.equal(analytics.overall.submitted, 1);
  assert.equal(analytics.overall.offer.count, 1);
  assert.equal(analytics.cohorts.byMasterResume[0].key, "ai");
  assert.equal(analytics.cohorts.byResumeAndMonth[0].key, "ai|2026-06");
  assert.equal(analytics.overall.sampleWarning, "");
});

test("reports confirmed reasons separately from hypotheses and confounders", () => {
  const reconciled = reconcileOutcomeSignals(
    [application()],
    [{
      applicationId: "app-1",
      source: "manual",
      stage: "rejected",
      observedAt: "2026-05-08T00:00:00Z",
      reason: "Role required an active clearance",
      evidenceType: "hiring_team_feedback"
    }]
  );
  const analytics = computeOutcomeAnalytics(reconciled.applications, {
    now: "2026-06-22T00:00:00Z"
  });
  assert.deepEqual(analytics.overall.confirmedReasons, [
    { reason: "Role required an active clearance", count: 1 }
  ]);
  assert.equal(analytics.hypotheses.confirmedReasons[0].label, "confirmed");
  assert.ok(analytics.hypotheses.confounders.some((item) => item.includes("observational")));
  assert.ok(analytics.hypotheses.hypotheses.every((item) => item.label !== "confirmed"));
});
