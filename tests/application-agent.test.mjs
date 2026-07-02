import test from "node:test";
import assert from "node:assert/strict";
import {
  agentMetrics,
  emptyAgentState,
  prepareApplication,
  recordOutcome,
  reviewApplication,
  updateCandidateProfile
} from "../lib/application-agent.mjs";
import { computeOutcomeAnalytics } from "../lib/outcome-monitor.mjs";

test("selects AI master and evidence-backed claims for ML roles", () => {
  const result = prepareApplication(
    {
      id: "role-ai",
      company: "Example",
      role: "Machine Learning Engineer",
      location: "New York, NY",
      url: "https://job-boards.greenhouse.io/example/jobs/1",
      description: "Build PyTorch models, evaluation systems, embeddings, and production APIs."
    },
    emptyAgentState()
  );
  assert.equal(result.application.masterResume, "ai");
  assert.equal(result.application.stage, "ready_for_review");
  assert.ok(result.application.analysis.matchedClaims.length > 0);
  assert.equal(result.application.review.required, true);
});

test("selects SWE master and detects eligibility blockers", () => {
  const result = prepareApplication(
    {
      id: "role-swe",
      company: "Example",
      role: "Backend Software Engineer",
      location: "Remote",
      url: "https://jobs.lever.co/example/1",
      description: "Build distributed Node APIs. Requires 5+ years and active Top Secret clearance."
    },
    emptyAgentState()
  );
  assert.equal(result.application.masterResume, "swe");
  assert.ok(result.application.analysis.blockers.some((item) => item.includes("clearance")));
  assert.ok(result.application.analysis.blockers.some((item) => item.includes("Experience")));
});

test("records outcomes without claiming a proven rejection cause", () => {
  const prepared = prepareApplication(
    {
      id: "role",
      company: "Example",
      role: "Software Engineer",
      url: "https://example.com/job"
    },
    emptyAgentState()
  );
  const result = recordOutcome(
    prepared.state,
    prepared.application.id,
    { stage: "rejected", reason: "Automated rejection email" }
  );
  assert.equal(result.application.stage, "rejected");
  assert.ok(result.application.outcome.hypotheses.some((item) =>
    item.includes("cannot be proven")
  ));
});

test("calculates funnel metrics and stale submissions", () => {
  let state = emptyAgentState();
  const first = prepareApplication(
    { id: "one", company: "One", role: "SWE", url: "https://one.example/job" },
    state
  );
  state = reviewApplication(first.state, first.application.id, {
    approved: true,
    resumeReviewed: true,
    claimsReviewed: true,
    eligibilityReviewed: true,
    locationReviewed: true
  }).state;
  state = recordOutcome(state, first.application.id, {
    stage: "submitted",
    observedAt: "2026-01-01T00:00:00Z"
  }).state;
  state.applications[first.application.id].updatedAt = "2026-01-01T00:00:00Z";
  const second = prepareApplication(
    { id: "two", company: "Two", role: "ML Engineer", url: "https://two.example/job" },
    state
  );
  state = reviewApplication(second.state, second.application.id, {
    approved: true,
    resumeReviewed: true,
    claimsReviewed: true,
    eligibilityReviewed: true,
    locationReviewed: true
  }).state;
  state = recordOutcome(state, second.application.id, {
    stage: "interview"
  }).state;
  const metrics = agentMetrics(state, new Date("2026-06-22T00:00:00Z"));
  assert.equal(metrics.prepared, 2);
  assert.equal(metrics.submitted, 2);
  assert.equal(metrics.interviewRate, 0.5);
  assert.equal(metrics.stale, 1);
});

test("rejects aggregator URLs for preparation", () => {
  assert.throws(
    () => prepareApplication(
      {
        id: "aggregator",
        company: "Example",
        role: "Software Engineer",
        url: "https://jobright.ai/jobs/info/123"
      },
      emptyAgentState()
    ),
    (error) => error.code === "DIRECT_URL_REQUIRED"
  );
});

test("retains prior advancement after a later rejection", () => {
  const prepared = prepareApplication(
    {
      id: "history",
      company: "Example",
      role: "Software Engineer",
      url: "https://jobs.example.com/role"
    },
    emptyAgentState()
  );
  prepared.state.applications[prepared.application.id].createdAt = "2026-05-01T00:00:00Z";
  prepared.state.applications[prepared.application.id].updatedAt = "2026-05-01T00:00:00Z";
  const approved = reviewApplication(prepared.state, prepared.application.id, {
    approved: true,
    resumeReviewed: true,
    claimsReviewed: true,
    eligibilityReviewed: true,
    locationReviewed: true
  });
  const submitted = recordOutcome(approved.state, prepared.application.id, {
    stage: "submitted",
    observedAt: "2026-06-01T00:00:00Z"
  });
  const assessment = recordOutcome(submitted.state, prepared.application.id, {
    stage: "assessment",
    observedAt: "2026-06-05T00:00:00Z"
  });
  const rejected = recordOutcome(assessment.state, prepared.application.id, {
    stage: "rejected",
    observedAt: "2026-06-10T00:00:00Z"
  });
  const analytics = computeOutcomeAnalytics(rejected.state.applications);
  assert.equal(analytics.overall.submitted, 1);
  assert.equal(analytics.overall.oa.count, 1);
  assert.equal(analytics.overall.rejected, 1);
});

test("does not allow submission stages to bypass human review", () => {
  const prepared = prepareApplication(
    { id: "gate", company: "Example", role: "SWE", url: "https://example.com/job" },
    emptyAgentState()
  );
  assert.throws(
    () => recordOutcome(prepared.state, prepared.application.id, { stage: "submitted" }),
    (error) => error.code === "REVIEW_REQUIRED"
  );
});

test("requires every human review check before manual-submit approval", () => {
  const prepared = prepareApplication(
    { id: "review", company: "Example", role: "SWE", url: "https://example.com/job" },
    emptyAgentState()
  );
  assert.throws(
    () => reviewApplication(prepared.state, prepared.application.id, {
      approved: true,
      resumeReviewed: true
    }),
    (error) => error.code === "REVIEW_INCOMPLETE"
  );
  const reviewed = reviewApplication(prepared.state, prepared.application.id, {
    approved: true,
    resumeReviewed: true,
    claimsReviewed: true,
    eligibilityReviewed: true,
    locationReviewed: true
  });
  assert.equal(reviewed.application.stage, "approved_for_manual_submit");
  assert.ok(reviewed.application.review.approvedAt);
  assert.equal(reviewed.application.events.at(-1).type, "review_approved");
});

test("candidate profile updates keep only the safe local autofill allowlist", () => {
  const state = updateCandidateProfile(emptyAgentState(), {
    fullName: "Nicholas Tayag",
    email: "nicholas@example.com",
    phone: "5551234567",
    linkedin: "https://linkedin.com/in/nicholas",
    github: "https://github.com/nicholas",
    location: "New York, NY",
    workAuthorization: "Yes",
    salary: "200000",
    secret: "do not retain"
  });
  assert.equal(state.profile.fullName, "Nicholas Tayag");
  assert.equal(state.profile.workAuthorization, "Verify before submission");
  assert.equal(state.profile.sponsorshipRequired, "Verify before submission");
  assert.equal("salary" in state.profile, false);
  assert.equal("secret" in state.profile, false);
});
