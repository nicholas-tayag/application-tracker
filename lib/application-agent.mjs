import { createHash, randomUUID } from "node:crypto";

const STAGES = new Set([
  "draft", "ready_for_review", "approved_for_manual_submit", "submitted", "assessment", "screen",
  "interview", "offer", "rejected", "withdrawn", "failed"
]);

const AI_SIGNALS = [
  "ai", "artificial intelligence", "machine learning", "ml engineer", "llm",
  "pytorch", "model", "inference", "rag", "embedding", "computer vision",
  "data scientist", "eval", "agentic"
];

const SWE_SIGNALS = [
  "software engineer", "backend", "full stack", "platform", "distributed",
  "api", "cloud", "infrastructure", "database", "typescript", "javascript",
  "c#", ".net", "java", "node"
];

const KNOWN_SKILLS = [
  "Python", "TypeScript", "JavaScript", "C#", ".NET", "ASP.NET Core", "Java",
  "SQL", "React", "Angular", "Node.js", "AWS", "Lambda", "EC2", "S3", "IAM",
  "Docker", "CI/CD", "GitHub Actions", "OpenTelemetry", "PyTorch", "ResNet-18",
  "Gemini", "RAG", "embeddings", "Pinecone", "MongoDB", "Redis", "GraphQL",
  "REST APIs", "Playwright", "PyTest"
];

const CLAIMS = [
  {
    id: "nyl-evals",
    text: "Built reusable privacy-safe agent evaluation infrastructure across 8 specs and 15 synthetic cases.",
    keywords: ["agent", "evaluation", "ai", "llm", "test", "privacy", "governance"]
  },
  {
    id: "nyl-governance",
    text: "Identified 10 enforcement gaps across 35 sandboxing, security, and approval controls.",
    keywords: ["security", "governance", "sandbox", "approval", "risk", "ai"]
  },
  {
    id: "rtx-platform",
    text: "Co-developed an enterprise certification platform spanning 27 APIs, 8 Angular pages, and 5 SQL entities.",
    keywords: ["api", "angular", "sql", "full stack", "enterprise", ".net", "backend"]
  },
  {
    id: "rtx-reliability",
    text: "Validated 87 unit tests, 4 end-to-end scenarios, and 7 CI workflows for air-gapped deployment.",
    keywords: ["testing", "ci", "deployment", "reliability", "e2e", "platform"]
  },
  {
    id: "wk-scale",
    text: "Automated identity analysis across 19,000+ accounts using Microsoft Graph, Entra ID, and AWS.",
    keywords: ["aws", "identity", "graph", "data", "automation", "cloud", "scale"]
  },
  {
    id: "wk-hours",
    text: "Eliminated an estimated 10+ reporting hours per week through AWS-based processing automation.",
    keywords: ["automation", "aws", "lambda", "s3", "efficiency", "cloud"]
  },
  {
    id: "agenvantage",
    text: "Reduced candidate repository context by 94% across 3 codebases while retaining 25 of 28 task concepts.",
    keywords: ["llm", "agent", "retrieval", "ranking", "token", "git", "observability"]
  },
  {
    id: "application-tracker",
    text: "Built a revisioned application workspace across 100 verified direct-link roles with atomic persistence and funnel analytics.",
    keywords: ["javascript", "node", "api", "analytics", "persistence", "frontend", "backend"]
  },
  {
    id: "vision",
    text: "Achieved 0.75 macro F1 and 0.92 Hamming accuracy across 12 labels with ResNet-18 transfer learning.",
    keywords: ["pytorch", "machine learning", "computer vision", "model", "classification", "python"]
  },
  {
    id: "mesh",
    text: "Structured 400 explicitly labeled workflow items across 100 synthetic transcripts.",
    keywords: ["gemini", "pinecone", "rag", "llm", "extraction", "javascript"]
  }
];

export function emptyAgentState() {
  return {
    revision: 0,
    profile: {
      fullName: "",
      email: "",
      phone: "",
      linkedin: "",
      github: "",
      location: "",
      workAuthorization: "Verify before submission",
      sponsorshipRequired: "Verify before submission"
    },
    settings: {
      requireFinalReview: true,
      staleAfterDays: 45,
      autoSubmit: false
    },
    applications: {},
    updatedAt: ""
  };
}

export function normalizeAgentState(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const fallback = emptyAgentState();
  const applications = {};
  for (const [id, value] of Object.entries(source.applications || {})) {
    if (!id || id.length > 160) continue;
    applications[id] = normalizeApplication(value, id);
  }
  return {
    revision: Number(source.revision || 0),
    profile: normalizeCandidateProfile(source.profile, fallback.profile),
    settings: {
      ...fallback.settings,
      ...(source.settings || {}),
      requireFinalReview: true,
      autoSubmit: false
    },
    applications,
    updatedAt: validTimestamp(source.updatedAt)
  };
}

export function updateCandidateProfile(currentState, profile = {}) {
  const state = normalizeAgentState(currentState);
  state.profile = normalizeCandidateProfile(profile, state.profile);
  return state;
}

export function prepareApplication(role, currentState, options = {}) {
  if (!isDirectApplicationUrl(role?.url)) {
    const error = new Error("a direct employer or ATS application URL is required");
    error.code = "DIRECT_URL_REQUIRED";
    throw error;
  }
  const state = normalizeAgentState(currentState);
  const description = clean([
    role.description, role.qualifications, role.why, role.fitTrack, role.role
  ].filter(Boolean).join("\n"), 30000);
  const masterResume = selectMasterResume(role, description, options.masterResume);
  const analysis = analyzeJob(role, description, masterResume);
  const now = new Date().toISOString();
  const key = applicationKey(role);
  const existing = state.applications[key];
  const application = normalizeApplication({
    ...existing,
    id: key,
    roleId: clean(role.id, 240),
    company: clean(role.company, 200),
    role: clean(role.role, 300),
    location: clean(role.location, 300),
    jobUrl: safeUrl(role.url),
    sourceUrl: safeUrl(role.sourceUrl || role.url),
    masterResume,
    stage: existing?.stage === "submitted" ? "submitted" : "ready_for_review",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    analysis,
    packageId: existing?.packageId || randomUUID(),
    review: {
      required: true,
      approvedAt: "",
      blockers: analysis.blockers,
      unansweredQuestions: analysis.unansweredQuestions
    },
    events: [
      ...(existing?.events || []),
      event("package_prepared", now, `Prepared ${masterResume} package`)
    ]
  }, key);
  state.applications[key] = application;
  return { state, application };
}

export function recordOutcome(currentState, applicationId, outcome) {
  const state = normalizeAgentState(currentState);
  const application = state.applications[applicationId];
  if (!application) throw new Error("application not found");
  const now = new Date().toISOString();
  const stage = STAGES.has(outcome.stage) ? outcome.stage : application.stage;
  const submissionStages = new Set(["submitted", "assessment", "screen", "interview", "offer"]);
  if (
    submissionStages.has(stage) &&
    ["draft", "ready_for_review"].includes(application.stage)
  ) {
    const error = new Error("application review approval is required before submission");
    error.code = "REVIEW_REQUIRED";
    throw error;
  }
  const reason = clean(outcome.reason, 1000);
  const evidence = clean(outcome.evidence, 2000);
  const updated = normalizeApplication({
    ...application,
    stage,
    updatedAt: now,
    outcome: {
      reason,
      evidence,
      observedAt: validTimestamp(outcome.observedAt) || now,
      hypotheses: stage === "rejected" || stage === "failed"
        ? screeningHypotheses(application, reason)
        : []
    },
    outcomeSignals: [
      ...(application.outcomeSignals || []),
      {
        id: `manual-${applicationId}-${stage}-${validTimestamp(outcome.observedAt) || now}`,
        applicationId,
        stage,
        source: "manual",
        observedAt: validTimestamp(outcome.observedAt) || now,
        evidenceType: evidence ? "manual_note" : "",
        evidence,
        reason
      }
    ],
    events: [
      ...application.events,
      event(`stage_${stage}`, now, reason || evidence || `Moved to ${stage}`)
    ]
  }, applicationId);
  state.applications[applicationId] = updated;
  return { state, application: updated };
}

export function reviewApplication(currentState, applicationId, review = {}) {
  const state = normalizeAgentState(currentState);
  const application = state.applications[applicationId];
  if (!application) throw new Error("application not found");
  const now = new Date().toISOString();
  const approved = review.approved === true;
  const requiredChecks = {
    resumeReviewed: review.resumeReviewed === true,
    claimsReviewed: review.claimsReviewed === true,
    eligibilityReviewed: review.eligibilityReviewed === true,
    locationReviewed: review.locationReviewed === true
  };
  if (approved && Object.values(requiredChecks).some((value) => !value)) {
    const error = new Error("all review checks are required before approval");
    error.code = "REVIEW_INCOMPLETE";
    throw error;
  }
  const updated = normalizeApplication({
    ...application,
    stage: approved ? "approved_for_manual_submit" : "ready_for_review",
    updatedAt: now,
    review: {
      required: true,
      approvedAt: approved ? now : "",
      ...requiredChecks,
      blockers: application.analysis?.blockers || [],
      unansweredQuestions: application.analysis?.unansweredQuestions || []
    },
    events: [
      ...application.events,
      event(
        approved ? "review_approved" : "review_reopened",
        now,
        approved
          ? "Human review completed; final submission remains manual"
          : "Application returned to review"
      )
    ]
  }, applicationId);
  state.applications[applicationId] = updated;
  return { state, application: updated };
}

export function agentMetrics(currentState, now = new Date()) {
  const state = normalizeAgentState(currentState);
  const applications = Object.values(state.applications);
  const submitted = applications.filter((item) =>
    ["submitted", "assessment", "screen", "interview", "offer", "rejected"].includes(item.stage)
  );
  const assessments = submitted.filter((item) =>
    ["assessment", "screen", "interview", "offer"].includes(item.stage)
  );
  const interviews = submitted.filter((item) =>
    ["interview", "offer"].includes(item.stage)
  );
  const offers = submitted.filter((item) => item.stage === "offer");
  const stale = submitted.filter((item) => {
    if (["offer", "rejected", "withdrawn"].includes(item.stage)) return false;
    const time = Date.parse(item.updatedAt || item.createdAt);
    return Number.isFinite(time) &&
      now.getTime() - time >= state.settings.staleAfterDays * 86400000;
  });
  return {
    prepared: applications.length,
    readyForReview: applications.filter((item) => item.stage === "ready_for_review").length,
    approvedForManualSubmit: applications.filter((item) =>
      item.stage === "approved_for_manual_submit"
    ).length,
    submitted: submitted.length,
    assessmentRate: ratio(assessments.length, submitted.length),
    interviewRate: ratio(interviews.length, submitted.length),
    offerRate: ratio(offers.length, submitted.length),
    rejected: submitted.filter((item) => item.stage === "rejected").length,
    stale: stale.length
  };
}

export function applicationKey(role) {
  const canonical = [role.company, role.role, role.location, role.url]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

export function isDirectApplicationUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    const blocked = [
      "jobright.ai", "linkedin.com", "indeed.com", "ziprecruiter.com",
      "glassdoor.com", "monster.com", "theladders.com", "lensa.com"
    ];
    return !blocked.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function analyzeJob(role, description, masterResume) {
  const text = `${role.role} ${role.fitTrack || ""} ${description}`.toLowerCase();
  const requiredSkills = KNOWN_SKILLS.filter((skill) =>
    text.includes(skill.toLowerCase())
  );
  const matchedClaims = CLAIMS
    .map((claim) => ({
      ...claim,
      score: claim.keywords.filter((keyword) => text.includes(keyword)).length
    }))
    .filter((claim) => claim.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 6)
    .map(({ id, text: claimText, score }) => ({ id, text: claimText, score }));
  const blockers = [];
  if (/security clearance|top secret|ts\/sci|secret clearance/i.test(text)) {
    blockers.push("Security-clearance requirement must be verified manually.");
  }
  if (/\bphd\b|doctoral/i.test(text)) blockers.push("Role appears to require or prefer a Ph.D.");
  if (/\b([3-9]|1[0-9])\+?\s+years/i.test(text)) {
    blockers.push("Experience requirement may exceed new-grad experience.");
  }
  if (/must be.*veteran|military veterans/i.test(text)) {
    blockers.push("Military-service eligibility must be verified.");
  }
  const unansweredQuestions = [
    "Confirm work authorization and sponsorship answer.",
    "Confirm relocation and onsite availability for this location.",
    "Review any voluntary demographic questions before submission."
  ];
  return {
    masterResume,
    requiredSkills,
    matchedClaims,
    blockers,
    unansweredQuestions,
    keywords: topKeywords(text),
    rationale: masterResume === "ai"
      ? "Selected AI master because the role emphasizes ML/AI/model or data-science signals."
      : "Selected General SWE master because the role emphasizes software, platform, backend, cloud, or systems signals.",
    integrityNote: "Only evidence-backed claims from the resume claim inventory are recommended.",
    screeningNote:
      "A later rejection cannot reveal the actual employer decision reason. Any diagnosis is a hypothesis unless recruiter evidence is available."
  };
}

function selectMasterResume(role, description, override) {
  if (override === "ai" || override === "swe") return override;
  const text = `${role.role} ${role.fitTrack || ""} ${description}`.toLowerCase();
  const aiScore = AI_SIGNALS.filter((signal) => text.includes(signal)).length;
  const sweScore = SWE_SIGNALS.filter((signal) => text.includes(signal)).length;
  return aiScore >= 2 && aiScore >= sweScore ? "ai" : "swe";
}

function screeningHypotheses(application, reason) {
  const hypotheses = [];
  const lower = reason.toLowerCase();
  if (lower.includes("experience")) hypotheses.push("Experience-level mismatch.");
  if (lower.includes("authorization") || lower.includes("sponsor")) {
    hypotheses.push("Work-authorization or sponsorship mismatch.");
  }
  if (lower.includes("location")) hypotheses.push("Location or onsite-availability mismatch.");
  if (application.analysis.blockers.length) {
    hypotheses.push(...application.analysis.blockers.map((item) => `Eligibility risk: ${item}`));
  }
  hypotheses.push(
    "Keyword or role-fit mismatch is possible, but cannot be proven without employer feedback.",
    "Timing, applicant volume, internal candidates, or role closure may have influenced the outcome."
  );
  return [...new Set(hypotheses)].slice(0, 6);
}

function normalizeApplication(value, id) {
  const source = value && typeof value === "object" ? value : {};
  const stage = STAGES.has(source.stage) ? source.stage : "draft";
  return {
    id,
    roleId: clean(source.roleId, 240),
    company: clean(source.company, 200),
    role: clean(source.role, 300),
    location: clean(source.location, 300),
    jobUrl: safeUrl(source.jobUrl),
    sourceUrl: safeUrl(source.sourceUrl),
    masterResume: source.masterResume === "ai" ? "ai" : "swe",
    stage,
    createdAt: validTimestamp(source.createdAt),
    updatedAt: validTimestamp(source.updatedAt),
    packageId: clean(source.packageId, 100),
    artifactPath: clean(source.artifactPath, 1000),
    artifactUrl: safeLocalArtifactUrl(source.artifactUrl),
    analysis: source.analysis && typeof source.analysis === "object" ? source.analysis : {},
    review: source.review && typeof source.review === "object" ? source.review : {},
    outcome: source.outcome && typeof source.outcome === "object" ? source.outcome : {},
    outcomeSignals: Array.isArray(source.outcomeSignals)
      ? source.outcomeSignals.slice(-200)
      : [],
    events: Array.isArray(source.events)
      ? source.events.slice(-100).map((item) => ({
        type: clean(item.type, 100),
        at: validTimestamp(item.at),
        detail: clean(item.detail, 2000)
      }))
      : []
  };
}

function event(type, at, detail) {
  return { type, at, detail: clean(detail, 2000) };
}

function topKeywords(text) {
  const stop = new Set([
    "and", "the", "with", "for", "you", "our", "this", "that", "from", "are",
    "will", "your", "have", "years", "experience", "work", "team", "role"
  ]);
  const counts = new Map();
  for (const word of text.match(/[a-z][a-z0-9+#.-]{2,}/g) || []) {
    if (stop.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([word]) => word);
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function safeUrl(value) {
  const text = clean(value, 2000);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function safeLocalArtifactUrl(value) {
  const text = clean(value, 1000);
  return /^\/api\/application-agent\/package\/[a-z0-9-]+\.md$/.test(text) ? text : "";
}

function normalizeCandidateProfile(value, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    fullName: clean(source.fullName ?? fallback.fullName, 300),
    email: clean(source.email ?? fallback.email, 320),
    phone: clean(source.phone ?? fallback.phone, 80),
    linkedin: safeProfileUrl(source.linkedin ?? fallback.linkedin, "linkedin.com"),
    github: safeProfileUrl(source.github ?? fallback.github, "github.com"),
    location: clean(source.location ?? fallback.location, 300),
    workAuthorization: "Verify before submission",
    sponsorshipRequired: "Verify before submission"
  };
}

function safeProfileUrl(value, host) {
  const text = clean(value, 1000);
  if (!text) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    const normalizedHost = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || normalizedHost !== host) return "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function validTimestamp(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function clean(value, maximum = 1000) {
  return String(value || "").trim().slice(0, maximum);
}
