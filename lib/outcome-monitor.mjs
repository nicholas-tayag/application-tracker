import { createHash } from "node:crypto";

export const HISTORICAL_BASELINE = Object.freeze({
  sampleSize: 158,
  oaRate: 0.0633,
  interviewRate: 0.0127,
  offerRate: 0.0127,
  frozenAt: "2026-06-22",
  source: "Private Simplify and email cross-reference"
});

const STAGES = new Set([
  "draft", "ready_for_review", "approved_for_manual_submit", "submitted", "assessment", "screen",
  "interview", "offer", "rejected", "withdrawn", "failed"
]);
const STAGE_ALIASES = new Map([
  ["applied", "submitted"],
  ["oa", "assessment"],
  ["online_assessment", "assessment"],
  ["recruiter_screen", "screen"],
  ["phone_screen", "screen"],
  ["interviewing", "interview"],
  ["declined", "rejected"]
]);
const ACTIVE_STAGE_RANK = new Map([
  ["draft", 0],
  ["ready_for_review", 1],
  ["approved_for_manual_submit", 2],
  ["submitted", 3],
  ["assessment", 4],
  ["screen", 5],
  ["interview", 6],
  ["offer", 7]
]);
const TERMINAL_STAGES = new Set(["offer", "rejected", "withdrawn", "failed"]);
const SUBMITTED_STAGES = new Set([
  "submitted", "assessment", "screen", "interview", "offer",
  "rejected", "withdrawn", "failed"
]);
const ASSESSMENT_STAGES = new Set(["assessment", "screen", "interview", "offer"]);
const INTERVIEW_STAGES = new Set(["interview", "offer"]);
const SOURCES = new Set(["manual", "email_aggregate", "portal"]);
const CONFIRMED_REASON_EVIDENCE = new Set([
  "recruiter_feedback", "hiring_team_feedback"
]);
const DAY_MS = 86_400_000;

export function normalizeOutcomeSignals(rawSignals) {
  const accepted = [];
  const invalid = [];
  const duplicates = [];
  const seen = new Set();

  for (const [index, raw] of array(rawSignals).entries()) {
    const signal = normalizeSignal(raw);
    if (!signal.applicationId || !signal.stage || !signal.observedAt) {
      invalid.push({ index, reason: "applicationId, recognized stage, and observedAt are required" });
      continue;
    }
    if (seen.has(signal.id)) {
      duplicates.push(signal.id);
      continue;
    }
    seen.add(signal.id);
    accepted.push(signal);
  }

  accepted.sort((a, b) =>
    Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.id.localeCompare(b.id)
  );
  return { signals: accepted, duplicates, invalid };
}

export function reconcileOutcomeSignals(rawApplications, rawSignals, options = {}) {
  const applications = normalizeApplications(rawApplications);
  const normalized = normalizeOutcomeSignals(rawSignals);
  const duplicates = [...normalized.duplicates];
  const ignored = [...normalized.invalid];
  const conflicts = [];
  const applied = [];

  for (const signal of normalized.signals) {
    const application = applications[signal.applicationId];
    if (!application) {
      ignored.push({ signalId: signal.id, reason: "application not found" });
      continue;
    }
    const existingIds = new Set(application.outcomeSignals.map((item) => item.id));
    if (existingIds.has(signal.id)) {
      duplicates.push(signal.id);
      continue;
    }

    application.outcomeSignals.push(signal);
    application.outcomeSignals.sort((a, b) =>
      Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.id.localeCompare(b.id)
    );

    if (isBeforeSubmission(signal, application)) {
      ignored.push({ signalId: signal.id, reason: "signal predates submission" });
      continue;
    }

    const decision = transitionDecision(application.stage, signal.stage);
    if (!decision.accept) {
      const item = {
        signalId: signal.id,
        applicationId: application.id,
        currentStage: application.stage,
        proposedStage: signal.stage,
        reason: decision.reason
      };
      if (decision.conflict) conflicts.push(item);
      else ignored.push(item);
      continue;
    }

    application.stage = signal.stage;
    application.updatedAt = laterTimestamp(application.updatedAt, signal.observedAt);
    if (!application.submittedAt && SUBMITTED_STAGES.has(signal.stage)) {
      application.submittedAt = signal.observedAt;
    }
    const reason = classifyReason(signal);
    if (reason) application.outcomeReasons.push(reason);
    applied.push({
      signalId: signal.id,
      applicationId: application.id,
      from: decision.from,
      to: signal.stage
    });
  }

  const now = validDate(options.now) || new Date();
  const staleAfterDays = positiveInteger(options.staleAfterDays, 30);
  const ghostedAfterDays = positiveInteger(options.ghostedAfterDays, 60);
  for (const application of Object.values(applications)) {
    application.monitoring = inactivityState(
      application,
      now,
      staleAfterDays,
      Math.max(ghostedAfterDays, staleAfterDays)
    );
  }

  return {
    applications,
    signalsAccepted: normalized.signals.length,
    applied,
    duplicates: [...new Set(duplicates)],
    ignored,
    conflicts,
    policy: {
      staleAfterDays,
      ghostedAfterDays: Math.max(ghostedAfterDays, staleAfterDays),
      note: "Stale and ghosted are follow-up labels, not employer decisions."
    }
  };
}

export function computeOutcomeAnalytics(rawApplications, options = {}) {
  const applications = Object.values(normalizeApplications(rawApplications));
  const now = validDate(options.now) || new Date();
  const minimumSampleSize = positiveInteger(options.minimumSampleSize, 20);
  const baseline = normalizeBaseline(options.baseline);
  const staleAfterDays = positiveInteger(options.staleAfterDays, 30);
  const ghostedAfterDays = Math.max(
    positiveInteger(options.ghostedAfterDays, 60),
    staleAfterDays
  );
  const startDate = dateBoundary(options.startDate, false);
  const endDate = dateBoundary(options.endDate, true);

  const submitted = applications.filter((application) => {
    if (!isSubmitted(application)) return false;
    const submittedAt = Date.parse(application.submittedAt);
    if (startDate && submittedAt < startDate) return false;
    if (endDate && submittedAt > endDate) return false;
    return true;
  });

  const overall = cohortMetrics(
    "all",
    submitted,
    baseline,
    minimumSampleSize,
    now,
    staleAfterDays,
    ghostedAfterDays
  );
  const byMasterResume = groupCohorts(
    submitted,
    (item) => item.masterResume || "unknown",
    baseline,
    minimumSampleSize,
    now,
    staleAfterDays,
    ghostedAfterDays
  );
  const bySubmissionMonth = groupCohorts(
    submitted,
    (item) => item.submittedAt.slice(0, 7),
    baseline,
    minimumSampleSize,
    now,
    staleAfterDays,
    ghostedAfterDays
  );
  const byResumeAndMonth = groupCohorts(
    submitted,
    (item) => `${item.masterResume || "unknown"}|${item.submittedAt.slice(0, 7)}`,
    baseline,
    minimumSampleSize,
    now,
    staleAfterDays,
    ghostedAfterDays
  );

  const analytics = {
    generatedAt: now.toISOString(),
    baseline,
    filters: {
      startDate: startDate ? new Date(startDate).toISOString().slice(0, 10) : "",
      endDate: endDate ? new Date(endDate).toISOString().slice(0, 10) : ""
    },
    overall,
    cohorts: { byMasterResume, bySubmissionMonth, byResumeAndMonth }
  };
  return {
    ...analytics,
    hypotheses: generateImprovementHypotheses(analytics, { minimumSampleSize })
  };
}

export function generateImprovementHypotheses(analytics, options = {}) {
  const cohort = analytics?.overall || {};
  const baseline = analytics?.baseline || HISTORICAL_BASELINE;
  const minimum = positiveInteger(options.minimumSampleSize, 20);
  const hypotheses = [];
  const confounders = [
    "Role mix, employer selectivity, seasonality, geography, eligibility, and applicant volume can change conversion rates.",
    "Email and portal signals may be incomplete; missing outcomes can bias rates downward.",
    "A cohort comparison is observational and does not isolate the resume as the cause."
  ];

  if (!cohort.submitted) {
    return {
      confirmedReasons: [],
      hypotheses: [],
      confounders,
      warning: "No submitted applications are available for this cohort."
    };
  }

  if (cohort.submitted < minimum) {
    hypotheses.push(evidenceLabel(
      "low_sample",
      "Collect more applications before treating rate movement as a durable resume improvement.",
      `Current n=${cohort.submitted}; recommended minimum n=${minimum}.`
    ));
  }

  if (cohort.oa?.rate < baseline.oaRate) {
    hypotheses.push(evidenceLabel(
      "hypothesis",
      "Test tighter role selection and evidence-backed keyword alignment before changing core experience claims.",
      "OA conversion is below the frozen historical baseline; this does not prove a resume-screening cause."
    ));
  } else if (cohort.oa?.rate > baseline.oaRate) {
    hypotheses.push(evidenceLabel(
      "observed_association",
      "Preserve the current targeting and resume variant while gathering a larger comparison cohort.",
      "OA conversion is above baseline, but the resume is only one possible contributor."
    ));
  }

  if (cohort.oa?.count > 0 && cohort.interview?.count / cohort.oa.count < 0.25) {
    hypotheses.push(evidenceLabel(
      "hypothesis",
      "Review assessment preparation and recruiter-screen positioning separately from resume content.",
      "Observed OA-to-interview conversion is below 25%; no causal reason is established."
    ));
  }

  if (cohort.stale + cohort.ghosted > 0) {
    hypotheses.push(evidenceLabel(
      "workflow",
      "Use dated follow-ups and close unresolved records only when a portal, email, or manual signal confirms an outcome.",
      `${cohort.stale} stale and ${cohort.ghosted} ghosted follow-up labels were detected.`
    ));
  }

  const confirmedReasons = array(cohort.confirmedReasons).map((item) => ({
    label: "confirmed",
    reason: item.reason,
    count: item.count,
    evidenceRequirement: "Direct recruiter or hiring-team feedback"
  }));

  return {
    confirmedReasons,
    hypotheses,
    confounders,
    warning: cohort.submitted < minimum
      ? `Directional only: n=${cohort.submitted} is below the minimum sample of ${minimum}.`
      : ""
  };
}

function normalizeApplications(raw) {
  const entries = Array.isArray(raw)
    ? raw.map((item, index) => [String(item?.id || index), item])
    : Object.entries(raw && typeof raw === "object" ? raw : {});
  return Object.fromEntries(entries.map(([id, rawApplication]) => {
    const source = rawApplication && typeof rawApplication === "object" ? rawApplication : {};
    const stage = normalizeStage(source.stage || source.status) || "draft";
    const createdAt = timestamp(source.createdAt);
    const submittedAt = submittedTimestamp(source, stage);
    const outcomeSignals = normalizeOutcomeSignals(source.outcomeSignals).signals
      .filter((signal) => signal.applicationId === String(source.id || id));
    const outcomeReasons = array(source.outcomeReasons)
      .map(normalizeReason)
      .filter(Boolean);
    return [String(source.id || id), {
      ...source,
      id: String(source.id || id),
      masterResume: normalizeResume(source.masterResume || source.resumeVersion),
      stage,
      createdAt,
      submittedAt,
      updatedAt: timestamp(source.updatedAt) || createdAt || submittedAt,
      outcomeSignals,
      outcomeReasons
    }];
  }));
}

function normalizeSignal(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const applicationId = clean(source.applicationId || source.application_id, 200);
  const stage = normalizeStage(source.stage || source.status);
  const observedAt = timestamp(source.observedAt || source.observed_at || source.at);
  const evidence = clean(source.evidence || source.detail, 2000);
  const reason = clean(source.reason, 1000);
  const evidenceType = clean(source.evidenceType || source.evidence_type, 80).toLowerCase();
  const signalSource = SOURCES.has(source.source) ? source.source : "manual";
  const fingerprint = [
    applicationId, signalSource, stage, observedAt, evidenceType, reason, evidence
  ].join("|");
  return {
    id: clean(source.id, 200) ||
      createHash("sha256").update(fingerprint).digest("hex").slice(0, 24),
    applicationId,
    source: signalSource,
    stage,
    observedAt,
    evidenceType,
    reason,
    evidence,
    confidence: normalizeConfidence(source.confidence)
  };
}

function transitionDecision(current, proposed) {
  if (current === proposed) {
    return { accept: false, conflict: false, from: current, reason: "stage already recorded" };
  }
  if (TERMINAL_STAGES.has(current)) {
    return {
      accept: false,
      conflict: TERMINAL_STAGES.has(proposed),
      from: current,
      reason: "terminal stage is not overwritten automatically"
    };
  }
  if (["rejected", "withdrawn", "failed"].includes(proposed)) {
    return { accept: true, conflict: false, from: current };
  }
  const currentRank = ACTIVE_STAGE_RANK.get(current) ?? -1;
  const proposedRank = ACTIVE_STAGE_RANK.get(proposed) ?? -1;
  if (proposedRank <= currentRank) {
    return {
      accept: false,
      conflict: false,
      from: current,
      reason: "stage regression ignored"
    };
  }
  return { accept: true, conflict: false, from: current };
}

function cohortMetrics(
  key,
  applications,
  baseline,
  minimum,
  now,
  staleAfterDays,
  ghostedAfterDays
) {
  const assessments = applications.filter(reachedAssessment);
  const interviews = applications.filter(reachedInterview);
  const offers = applications.filter(reachedOffer);
  const inactivity = applications.map((item) =>
    inactivityState(item, now, staleAfterDays, ghostedAfterDays)
  );
  const confirmedReasonCounts = new Map();
  for (const application of applications) {
    for (const reason of application.outcomeReasons.filter((item) => item.label === "confirmed")) {
      confirmedReasonCounts.set(reason.reason, (confirmedReasonCounts.get(reason.reason) || 0) + 1);
    }
  }
  return {
    key,
    submitted: applications.length,
    oa: rateComparison(assessments.length, applications.length, baseline.oaRate),
    interview: rateComparison(interviews.length, applications.length, baseline.interviewRate),
    offer: rateComparison(offers.length, applications.length, baseline.offerRate),
    rejected: applications.filter((item) => item.stage === "rejected").length,
    stale: inactivity.filter((item) => item.state === "stale").length,
    ghosted: inactivity.filter((item) => item.state === "ghosted").length,
    confirmedReasons: [...confirmedReasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    sampleWarning: applications.length < minimum
      ? `Directional only: n=${applications.length}; minimum recommended n=${minimum}.`
      : ""
  };
}

function groupCohorts(
  applications,
  keyFunction,
  baseline,
  minimum,
  now,
  staleAfterDays,
  ghostedAfterDays
) {
  const groups = new Map();
  for (const application of applications) {
    const key = keyFunction(application);
    groups.set(key, [...(groups.get(key) || []), application]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => cohortMetrics(
      key,
      values,
      baseline,
      minimum,
      now,
      staleAfterDays,
      ghostedAfterDays
    ));
}

function rateComparison(count, total, baselineRate) {
  const rate = total ? count / total : 0;
  const percentagePointLift = (rate - baselineRate) * 100;
  return {
    count,
    rate,
    percent: rate * 100,
    baselineRate,
    baselinePercent: baselineRate * 100,
    percentagePointLift,
    relativeLift: baselineRate ? (rate - baselineRate) / baselineRate : null
  };
}

function reachedAssessment(application) {
  return highestActiveRank(application) >= ACTIVE_STAGE_RANK.get("assessment");
}

function reachedInterview(application) {
  return highestActiveRank(application) >= ACTIVE_STAGE_RANK.get("interview");
}

function reachedOffer(application) {
  return highestActiveRank(application) >= ACTIVE_STAGE_RANK.get("offer");
}

function highestActiveRank(application) {
  const stages = [
    application.stage,
    ...application.outcomeSignals.map((signal) => signal.stage)
  ];
  return Math.max(...stages.map((stage) => ACTIVE_STAGE_RANK.get(stage) ?? -1));
}

function inactivityState(application, now, staleAfterDays, ghostedAfterDays) {
  if (!isSubmitted(application) || TERMINAL_STAGES.has(application.stage)) {
    return { state: "current", daysSinceActivity: null, note: "" };
  }
  const latest = [
    application.updatedAt,
    application.submittedAt,
    ...application.outcomeSignals.map((signal) => signal.observedAt)
  ].map(Date.parse).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (!Number.isFinite(latest)) {
    return { state: "unknown", daysSinceActivity: null, note: "No dated activity available." };
  }
  const days = Math.max(0, Math.floor((now.getTime() - latest) / DAY_MS));
  if (days >= ghostedAfterDays) {
    return {
      state: "ghosted",
      daysSinceActivity: days,
      note: "No response signal; this is not a confirmed rejection."
    };
  }
  if (days >= staleAfterDays) {
    return {
      state: "stale",
      daysSinceActivity: days,
      note: "Follow-up may be due; this is not a confirmed rejection."
    };
  }
  return { state: "current", daysSinceActivity: days, note: "" };
}

function classifyReason(signal) {
  if (!signal.reason) return null;
  const confirmed = CONFIRMED_REASON_EVIDENCE.has(signal.evidenceType);
  return {
    label: confirmed ? "confirmed" : "hypothesis_input",
    reason: signal.reason,
    signalId: signal.id,
    evidenceType: signal.evidenceType || "unspecified",
    note: confirmed
      ? "Reason supported by direct recruiter or hiring-team feedback."
      : "Reason is not treated as confirmed without direct recruiter or hiring-team feedback."
  };
}

function normalizeReason(raw) {
  if (!raw || typeof raw !== "object") return null;
  const reason = clean(raw.reason, 1000);
  if (!reason) return null;
  const evidenceType = clean(raw.evidenceType, 80).toLowerCase();
  const label = CONFIRMED_REASON_EVIDENCE.has(evidenceType) && raw.label === "confirmed"
    ? "confirmed"
    : "hypothesis_input";
  return { ...raw, reason, evidenceType, label };
}

function submittedTimestamp(source, stage) {
  const direct = timestamp(
    source.submittedAt || source.submissionDate || source.applicationDate || source.date
  );
  if (direct) return direct;
  return SUBMITTED_STAGES.has(stage)
    ? timestamp(source.createdAt || source.updatedAt)
    : "";
}

function isBeforeSubmission(signal, application) {
  return application.submittedAt &&
    Date.parse(signal.observedAt) < Date.parse(application.submittedAt);
}

function isSubmitted(application) {
  return Boolean(application.submittedAt) && SUBMITTED_STAGES.has(application.stage);
}

function normalizeStage(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliased = STAGE_ALIASES.get(normalized) || normalized;
  return STAGES.has(aliased) ? aliased : "";
}

function normalizeResume(value) {
  const text = clean(value, 160).toLowerCase();
  if (text === "ai" || text.includes("ai engineer") || text.startsWith("ai-")) return "ai";
  if (text === "swe" || text.includes("general swe") || text.startsWith("swe-")) return "swe";
  return text || "unknown";
}

function normalizeBaseline(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    ...HISTORICAL_BASELINE,
    ...source,
    oaRate: validRate(source.oaRate, HISTORICAL_BASELINE.oaRate),
    interviewRate: validRate(source.interviewRate, HISTORICAL_BASELINE.interviewRate),
    offerRate: validRate(source.offerRate, HISTORICAL_BASELINE.offerRate)
  };
}

function validRate(value, fallback) {
  const number = Number(value);
  return number >= 0 && number <= 1 ? number : fallback;
}

function normalizeConfidence(value) {
  const number = Number(value);
  return number >= 0 && number <= 1 ? number : null;
}

function timestamp(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function laterTimestamp(left, right) {
  return Date.parse(left) > Date.parse(right) ? left : right;
}

function dateBoundary(value, endOfDay) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const time = Date.parse(`${text}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isFinite(time) ? time : null;
}

function validDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time) : null;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function evidenceLabel(label, recommendation, evidence) {
  return { label, recommendation, evidence };
}

function clean(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
