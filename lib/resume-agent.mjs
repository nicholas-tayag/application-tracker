import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const VERSION = 2;
const DEFAULT_LINE_LIMIT = 118;
const DIRECT_STATUSES = new Set(["verified"]);
const REVIEW_STATUSES = new Set(["confirm", "partial"]);
const ALLOWED_STATUSES = new Set([
  ...DIRECT_STATUSES,
  ...REVIEW_STATUSES,
  "internal-only"
]);

const ROLE_FAMILIES = [
  {
    id: "ai_ml",
    label: "AI / Machine Learning",
    signals: ["machine learning", "ml engineer", "ai engineer", "artificial intelligence",
      "pytorch", "tensorflow", "computer vision", "nlp", "llm", "model training",
      "inference", "embeddings", "rag", "data scientist"]
  },
  {
    id: "data",
    label: "Data Engineering",
    signals: ["data engineer", "data pipeline", "etl", "warehouse", "spark", "airflow",
      "analytics engineer", "data platform"]
  },
  {
    id: "frontend",
    label: "Frontend Engineering",
    signals: ["frontend", "front-end", "react", "angular", "vue", "user interface",
      "accessibility", "design system"]
  },
  {
    id: "backend_platform",
    label: "Backend / Platform Engineering",
    signals: ["backend", "back-end", "platform engineer", "distributed systems",
      "microservices", "rest api", "graphql", "database", "cloud infrastructure",
      "site reliability", "devops"]
  },
  {
    id: "security",
    label: "Security Engineering",
    signals: ["security engineer", "application security", "identity", "authentication",
      "authorization", "rbac", "threat", "vulnerability", "governance"]
  },
  {
    id: "general_swe",
    label: "General Software Engineering",
    signals: ["software engineer", "software developer", "full stack", "full-stack",
      "application developer", "computer science"]
  }
];

const KEYWORDS = [
  "Python", "Java", "JavaScript", "TypeScript", "C#", "C++", "Go", "Rust", "SQL",
  "React", "Angular", "Vue", "Node.js", ".NET", "ASP.NET Core", "Spring",
  "PyTorch", "TensorFlow", "scikit-learn", "ResNet", "machine learning",
  "computer vision", "natural language processing", "NLP", "LLM", "RAG",
  "embeddings", "model evaluation", "inference", "OpenTelemetry",
  "REST APIs", "GraphQL", "microservices", "distributed systems", "system design",
  "MongoDB", "PostgreSQL", "SQL Server", "Redis", "Pinecone",
  "AWS", "Azure", "GCP", "Lambda", "EC2", "S3", "IAM", "Docker", "Kubernetes",
  "CI/CD", "GitHub Actions", "unit testing", "end-to-end testing", "Playwright",
  "PyTest", "Git", "Agile", "authentication", "authorization", "RBAC",
  "data pipelines", "ETL", "accessibility", "observability"
];

const WEAK_VERBS = new Set([
  "assisted", "helped", "participated", "responsible", "worked", "utilized",
  "used", "involved", "handled", "supported"
]);

const CAUSAL_VERBS = [
  "accelerated", "boosted", "eliminated", "improved", "increased", "prevented",
  "reduced", "saved", "shortened"
];

const INTERNAL_PATTERNS = [
  /\bpr[\s_-]*review[\s_-]*agent\b/i,
  /\bnyl-oriented architecture exploration\b/i,
  /\binternal architecture prototype\b/i
];

export function analyzeResumeQuality(input = {}) {
  const role = normalizeRole(input.role);
  const jobDescription = clean(input.jobDescription);
  const resumeText = clean(input.resumeText);
  const resumeBullets = normalizeBullets(input.resumeBullets, input.resumeText);
  const resumeCorpus = [resumeText, ...resumeBullets].filter(Boolean).join("\n");
  const claims = normalizeClaims(input.claimRegistry);
  const jobCorpus = [
    role.title, role.company, role.location, role.department, jobDescription
  ].filter(Boolean).join(" ");
  const roleFamily = classifyRoleFamily(jobCorpus);
  const keywordCoverage = analyzeKeywordCoverage(jobCorpus, resumeCorpus);
  const claimAssessment = assessClaims(claims, jobCorpus);
  const findings = analyzeBullets(resumeBullets, input.lineLimit);
  const unsupported = detectUnsupportedAssertions(resumeCorpus, claims);
  const bulletRecommendations = claimAssessment.eligible
    .slice(0, positiveInteger(input.maxRecommendations, 6))
    .map((claim) => recommendBullet(claim, jobCorpus, input.lineLimit));
  const masterResume = normalizeMasterResume(input.masterResume);
  const score = scoreResume({
    keywordCoverage,
    claimAssessment,
    findings,
    unsupported,
    resumeBullets,
    masterResume,
    roleFamily
  });
  const cache = buildCacheMetadata({
    resumeText: resumeText || resumeBullets.join("\n"),
    suppliedHash: input.resumeHash,
    previousHash: input.previousResumeHash
  });
  const missingEvidenceWarnings = buildEvidenceWarnings(
    keywordCoverage,
    claimAssessment,
    claims
  );

  return {
    version: VERSION,
    analysisOnly: true,
    cache,
    masterResume,
    roleFamily,
    keywordCoverage,
    claims: claimAssessment,
    bulletRecommendations,
    missingEvidenceWarnings,
    findings: {
      ...findings,
      unsupportedMetrics: unsupported.metrics,
      unsupportedSkills: unsupported.skills,
      internalContent: unsupported.internalContent
    },
    score,
    recommendations: buildRecommendations({
      masterResume,
      roleFamily,
      keywordCoverage,
      claimAssessment,
      findings,
      unsupported,
      bulletRecommendations
    }),
    guardrails: [
      "This is a transparent writing-and-evidence rubric, not an ATS score or employer probability.",
      "The scanner recommends changes only; it never edits a resume.",
      "Only verified claims are eligible for direct recommendation.",
      "Confirm and partial claims require human evidence review.",
      "Internal-only and PR Review Agent claims are always excluded.",
      "Do not add a metric or skill unless the supplied resume or claim registry supports it."
    ]
  };
}

export function classifyRoleFamily(text) {
  const normalized = canonical(text);
  const ranked = ROLE_FAMILIES.map((family) => {
    const matchedSignals = family.signals.filter((signal) => containsTerm(normalized, signal));
    return {
      id: family.id,
      label: family.label,
      matchedSignals,
      score: matchedSignals.reduce((sum, signal) => sum + signal.split(" ").length, 0)
    };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const winner = ranked[0];
  return {
    id: winner.score ? winner.id : "general_swe",
    label: winner.score ? winner.label : "General Software Engineering",
    confidence: winner.score >= 5 ? "high" : winner.score ? "medium" : "low",
    matchedSignals: winner.matchedSignals,
    alternatives: ranked.slice(1, 3).filter((item) => item.score > 0)
  };
}

export function analyzeKeywordCoverage(jobText, resumeText) {
  const required = unique(KEYWORDS.filter((keyword) => containsTerm(jobText, keyword)));
  const matched = required.filter((keyword) => containsTerm(resumeText, keyword));
  const missing = required.filter((keyword) => !containsTerm(resumeText, keyword));
  return {
    required,
    matched,
    missing,
    covered: matched.length,
    total: required.length,
    ratio: required.length ? round(matched.length / required.length) : null,
    note: required.length
      ? "Coverage includes only explicit cataloged terms in the supplied job description."
      : "No cataloged technical keywords were explicit in the supplied job description."
  };
}

export function analyzeBullets(bullets, lineLimit = DEFAULT_LINE_LIMIT) {
  const normalized = normalizeBullets(bullets);
  const limit = positiveInteger(lineLimit, DEFAULT_LINE_LIMIT);
  const weakVerbs = [];
  const xyz = [];
  const lineEstimates = normalized.map((bullet, index) => {
    const firstWord = canonical(bullet).split(" ")[0];
    if (WEAK_VERBS.has(firstWord)) weakVerbs.push({ index, bullet, verb: firstWord });
    const structure = inspectBulletStructure(bullet);
    xyz.push({ index, ...structure });
    return {
      index,
      bullet,
      characters: bullet.length,
      estimatedLines: Math.max(1, Math.ceil(bullet.length / limit)),
      oneLineLikely: bullet.length <= limit,
      limit
    };
  });
  const redundancy = [];
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      const similarity = jaccard(contentTokens(normalized[left]), contentTokens(normalized[right]));
      if (similarity >= 0.55) redundancy.push({ left, right, similarity: round(similarity) });
    }
  }
  return {
    lineEstimates,
    overLineLimit: lineEstimates.filter((item) => !item.oneLineLikely),
    xyz,
    xyzComplete: xyz.filter((item) => item.complete),
    weakVerbs,
    redundancy
  };
}

export function detectUnsupportedAssertions(resumeText, claimRegistry) {
  const text = clean(resumeText);
  const claims = normalizeClaims(claimRegistry);
  const usableClaims = claims.filter((claim) =>
    !isInternalClaim(claim) && DIRECT_STATUSES.has(claim.status)
  );
  const evidenceCorpus = usableClaims
    .map((claim) => `${claim.resumeClaim} ${claim.measurement}`)
    .join(" ");
  const supportedMetrics = unique(usableClaims.flatMap((claim) =>
    metricTokens(`${claim.resumeClaim} ${claim.measurement}`)
  ));
  const resumeMetrics = metricTokens(text);
  const metrics = resumeMetrics
    .filter((metric) => !supportedMetrics.some((supported) => metricsEquivalent(metric, supported)))
    .map((metric) => ({
      value: metric,
      reason: "Metric does not appear in a verified, non-internal registry claim."
    }));
  const resumeSkills = unique(KEYWORDS.filter((keyword) => containsTerm(text, keyword)));
  const skills = resumeSkills
    .filter((keyword) => !containsTerm(evidenceCorpus, keyword))
    .map((keyword) => ({
      value: keyword,
      reason: "Skill appears in the resume but not in a verified registry claim; verify independently."
    }));
  const internalContent = INTERNAL_PATTERNS
    .filter((pattern) => pattern.test(text))
    .map(() => ({
      value: "PR Review Agent/internal prototype",
      reason: "Internal prototype content is prohibited from personal-project recommendations."
    }));
  return { metrics, skills, internalContent };
}

export function parseClaimRegistryCsv(csvText) {
  if (typeof csvText !== "string" || !csvText.trim()) return [];
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0].map(canonicalHeader);
  return rows.slice(1)
    .filter((row) => row.some((cell) => clean(cell)))
    .map((row) => Object.fromEntries(headers.map((header, index) => [
      header,
      clean(row[index])
    ])));
}

export function validateBulletAgainstClaim(bullet, claim) {
  const normalizedClaim = normalizeClaim(claim);
  const candidate = clean(bullet);
  const errors = [];
  if (!candidate) errors.push("Bullet is empty.");
  if (normalizedClaim.status !== "verified") {
    errors.push(`Claim status "${normalizedClaim.status}" is not directly usable.`);
  }
  if (isInternalClaim(normalizedClaim)) {
    errors.push("Internal-only or PR Review Agent claims are prohibited.");
  }
  const allowedMetrics = metricTokens(
    `${normalizedClaim.resumeClaim} ${normalizedClaim.measurement}`
  );
  const unsupportedMetrics = metricTokens(candidate).filter((candidateMetric) =>
    !allowedMetrics.some((allowedMetric) => metricsEquivalent(candidateMetric, allowedMetric))
  );
  if (unsupportedMetrics.length) {
    errors.push(`Unsupported metric(s): ${unsupportedMetrics.join(", ")}.`);
  }
  const candidateCausal = CAUSAL_VERBS.filter((verb) => containsTerm(candidate, verb));
  const claimCausal = CAUSAL_VERBS.filter((verb) => containsTerm(normalizedClaim.resumeClaim, verb));
  const causalUpgrade = candidateCausal.filter((verb) => !claimCausal.includes(verb));
  if (causalUpgrade.length) {
    errors.push(`Candidate adds unsupported causal outcome(s): ${causalUpgrade.join(", ")}.`);
  }
  return { valid: errors.length === 0, errors, unsupportedMetrics, causalUpgrade };
}

export function hashResumeContent(content) {
  return createHash("sha256")
    .update(normalizeResumeContent(content), "utf8")
    .digest("hex");
}

export async function hashResumeFile(filePath) {
  return hashResumeContent(await readFile(filePath, "utf8"));
}

export function shouldAnalyzeResume(currentHash, previousHash) {
  return !clean(currentHash) || clean(currentHash) !== clean(previousHash);
}

function assessClaims(claims, jobText) {
  const jobTokens = contentTokens(jobText);
  const eligible = [];
  const needsConfirmation = [];
  const excluded = [];
  for (const claim of claims) {
    const matchedTerms = intersection(
      jobTokens,
      contentTokens(`${claim.area} ${claim.resumeClaim} ${claim.measurement}`)
    );
    const assessed = { ...claim, relevance: matchedTerms.length, matchedTerms };
    if (isInternalClaim(claim)) {
      excluded.push({
        ...assessed,
        exclusionReason: "Internal-only and PR Review Agent prototype claims cannot be used."
      });
    } else if (DIRECT_STATUSES.has(claim.status)) {
      eligible.push(assessed);
    } else if (REVIEW_STATUSES.has(claim.status)) {
      needsConfirmation.push(assessed);
    } else {
      excluded.push({
        ...assessed,
        exclusionReason: `Unsupported claim status: ${claim.status || "missing"}.`
      });
    }
  }
  const byRelevance = (left, right) =>
    right.relevance - left.relevance || left.claimId.localeCompare(right.claimId);
  return {
    eligible: eligible.sort(byRelevance),
    needsConfirmation: needsConfirmation.sort(byRelevance),
    excluded: excluded.sort(byRelevance)
  };
}

function recommendBullet(claim, jobText, lineLimit) {
  const validation = validateBulletAgainstClaim(claim.resumeClaim, claim);
  return {
    claimId: claim.claimId,
    status: claim.status,
    bullet: claim.resumeClaim,
    xyz: xyzStructure(claim.resumeClaim, claim.measurement),
    lineEstimate: analyzeBullets([claim.resumeClaim], lineLimit).lineEstimates[0],
    relevanceTerms: intersection(contentTokens(claim.resumeClaim), contentTokens(jobText)),
    caveat: claim.caveat,
    evidenceSource: claim.evidenceSource,
    valid: validation.valid,
    validationErrors: validation.errors
  };
}

function inspectBulletStructure(bullet) {
  const metrics = metricTokens(bullet);
  const methodMatch = findMethodMatch(bullet);
  const firstWord = canonical(bullet).split(" ")[0];
  const accomplishment = Boolean(firstWord) && !WEAK_VERBS.has(firstWord);
  return {
    accomplishment,
    measurement: metrics.length > 0,
    method: Boolean(methodMatch),
    complete: accomplishment && metrics.length > 0 && Boolean(methodMatch),
    ordering: methodMatch
      ? "accomplishment-measurement-method"
      : metrics.length ? "accomplishment-measurement" : "accomplishment-only",
    metrics
  };
}

function xyzStructure(text, measurement) {
  const methodMatch = findMethodMatch(text);
  const method = methodMatch ? methodMatch[1].replace(/[.]$/, "") : "";
  const beforeMethod = methodMatch ? text.slice(0, methodMatch.index).trim() : text;
  const firstMetric = metricTokens(beforeMethod)[0];
  let accomplishment = beforeMethod.replace(/[.]$/, "");
  if (firstMetric) {
    const index = accomplishment.toLowerCase().indexOf(firstMetric.toLowerCase());
    if (index > 0) accomplishment = accomplishment.slice(0, index).trim();
  }
  return {
    accomplishment,
    measurement: clean(measurement),
    method,
    ordering: methodMatch
      ? "accomplishment-measurement-method"
      : "accomplishment-measurement",
    complete: Boolean(accomplishment && clean(measurement) && method)
  };
}

function buildEvidenceWarnings(keywordCoverage, assessment, claims) {
  const warnings = keywordCoverage.missing.map((keyword) => {
    const supported = claims.some((claim) =>
      !isInternalClaim(claim) &&
      DIRECT_STATUSES.has(claim.status) &&
      containsTerm(`${claim.resumeClaim} ${claim.measurement}`, keyword)
    );
    return {
      type: supported ? "unused_supported_keyword" : "missing_evidence",
      keyword,
      message: supported
        ? `${keyword} is supported by a verified claim but absent from the supplied resume.`
        : `Do not add ${keyword}; no verified supporting claim was supplied.`
    };
  });
  for (const claim of assessment.needsConfirmation) {
    warnings.push({
      type: "claim_needs_confirmation",
      claimId: claim.claimId,
      status: claim.status,
      message: `${claim.claimId} requires evidence review before use: ${claim.caveat || "confirm scope."}`
    });
  }
  return warnings;
}

function scoreResume(context) {
  const keywordPoints = context.keywordCoverage.ratio === null
    ? 12.5
    : context.keywordCoverage.ratio * 25;
  const prohibited = context.unsupported.internalContent.length;
  const assertionCount = context.unsupported.metrics.length + context.unsupported.skills.length;
  const evidencePoints = Math.max(0, 30 - prohibited * 30 - Math.min(20, assertionCount * 4));
  const structurePoints = context.resumeBullets.length
    ? context.findings.xyzComplete.length / context.resumeBullets.length * 20
    : 0;
  const concise = context.findings.lineEstimates.filter((item) => item.oneLineLikely).length;
  const linePoints = context.resumeBullets.length
    ? concise / context.resumeBullets.length * 15
    : 0;
  const expectedMaster = context.roleFamily.id === "ai_ml" ? "ai_engineer" : "general_swe";
  const rolePoints = context.masterResume === expectedMaster ? 10 : 4;
  const penalty = Math.min(
    15,
    context.findings.weakVerbs.length * 2 + context.findings.redundancy.length * 3
  );
  const total = clamp(
    keywordPoints + evidencePoints + structurePoints + linePoints + rolePoints - penalty,
    0,
    100
  );
  return {
    total: Math.round(total),
    label: total >= 85 ? "strong" : total >= 70 ? "solid" :
      total >= 50 ? "needs work" : "insufficient evidence",
    isProbability: false,
    interpretation: "Deterministic resume writing/evidence score only.",
    rubric: {
      keywordCoverage: { earned: round(keywordPoints), possible: 25 },
      evidenceIntegrity: { earned: round(evidencePoints), possible: 30 },
      accomplishmentStructure: { earned: round(structurePoints), possible: 20 },
      oneLineDiscipline: { earned: round(linePoints), possible: 15 },
      masterResumeFit: { earned: rolePoints, possible: 10 },
      qualityPenalty: { earned: -penalty, possible: 0 }
    }
  };
}

function buildRecommendations(context) {
  const recommendations = [];
  const expectedMaster = context.roleFamily.id === "ai_ml" ? "ai_engineer" : "general_swe";
  if (context.masterResume !== expectedMaster) {
    recommendations.push({
      priority: 1,
      type: "master_resume",
      action: `Consider analyzing the ${expectedMaster} master resume for this role family.`,
      reason: `Classified as ${context.roleFamily.label}.`
    });
  }
  if (context.unsupported.internalContent.length) {
    recommendations.push({
      priority: 1,
      type: "prohibited_content",
      action: "Remove PR Review Agent/internal prototype content from consideration.",
      reason: "It is not an eligible personal-project claim."
    });
  }
  if (context.unsupported.metrics.length || context.unsupported.skills.length) {
    recommendations.push({
      priority: 2,
      type: "evidence_review",
      action: "Verify unsupported metrics and skills before retaining or emphasizing them.",
      metrics: context.unsupported.metrics.map((item) => item.value),
      skills: context.unsupported.skills.map((item) => item.value)
    });
  }
  const supportedMissing = context.keywordCoverage.missing.filter((keyword) =>
    context.claimAssessment.eligible.some((claim) =>
      containsTerm(`${claim.resumeClaim} ${claim.measurement}`, keyword)
    )
  );
  if (supportedMissing.length) {
    recommendations.push({
      priority: 3,
      type: "keyword_alignment",
      action: "Consider adding these explicit job terms where the verified claim already supports them.",
      terms: supportedMissing
    });
  }
  if (context.bulletRecommendations.length) {
    recommendations.push({
      priority: 4,
      type: "verified_claims",
      action: "Consider the highest-relevance verified claims; preserve their metrics and caveats.",
      claimIds: context.bulletRecommendations.map((item) => item.claimId)
    });
  }
  if (context.findings.weakVerbs.length || context.findings.redundancy.length) {
    recommendations.push({
      priority: 5,
      type: "writing_quality",
      action: "Replace weak lead verbs and redundant bullets with distinct accomplishments.",
      weakBulletIndexes: context.findings.weakVerbs.map((item) => item.index),
      redundantPairs: context.findings.redundancy.map(({ left, right }) => [left, right])
    });
  }
  if (context.findings.overLineLimit.length) {
    recommendations.push({
      priority: 6,
      type: "line_fit",
      action: "Shorten likely wrapping bullets, then verify against the rendered resume.",
      bulletIndexes: context.findings.overLineLimit.map((item) => item.index)
    });
  }
  recommendations.push({
    priority: 7,
    type: "manual_verification",
    action: "Render and inspect the final resume yourself; character estimates cannot prove PDF line fit."
  });
  return recommendations;
}

function buildCacheMetadata({ resumeText, suppliedHash, previousHash }) {
  const contentHash = hashResumeContent(resumeText);
  const currentHash = clean(suppliedHash) || contentHash;
  return {
    algorithm: "sha256",
    contentHash,
    currentHash,
    previousHash: clean(previousHash) || null,
    changed: shouldAnalyzeResume(currentHash, previousHash),
    cacheKey: `resume-agent-v${VERSION}:${currentHash}`
  };
}

function normalizeClaims(input) {
  const rows = typeof input === "string" ? parseClaimRegistryCsv(input) : input;
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeClaim).filter((claim) => claim.claimId && claim.resumeClaim);
}

function normalizeClaim(claim = {}) {
  const status = canonical(claim.status);
  return {
    claimId: clean(claim.claimId ?? claim.claim_id ?? claim.id),
    area: clean(claim.area),
    resumeClaim: clean(claim.resumeClaim ?? claim.resume_claim ?? claim.text),
    measurement: clean(claim.measurement),
    evidenceSource: clean(claim.evidenceSource ?? claim.evidence_source),
    status: ALLOWED_STATUSES.has(status) ? status : status || "unknown",
    caveat: clean(claim.caveat),
    interviewPrompt: clean(claim.interviewPrompt ?? claim.interview_prompt)
  };
}

function normalizeRole(role = {}) {
  return {
    title: clean(role.title ?? role.role),
    company: clean(role.company),
    location: clean(role.location),
    department: clean(role.department ?? role.team)
  };
}

function normalizeMasterResume(value) {
  const normalized = canonical(value).replaceAll(" ", "_");
  return ["ai", "ai_engineer", "resume_ai_engineer"].includes(normalized)
    ? "ai_engineer"
    : "general_swe";
}

function normalizeBullets(bullets, resumeText = "") {
  if (Array.isArray(bullets)) return bullets.map(clean).filter(Boolean);
  if (typeof bullets === "string") {
    return bullets.split(/\r?\n/)
      .map((line) => clean(line.replace(/^[-*•]\s*/, "")))
      .filter(Boolean);
  }
  if (typeof resumeText === "string") {
    const latex = [...resumeText.matchAll(/\\resumeItem\{([^{}]+)\}/g)]
      .map((match) => clean(match[1]))
      .filter(Boolean);
    if (latex.length) return latex;
    return resumeText.split(/\r?\n/)
      .map((line) => clean(line.replace(/^[-*•]\s*/, "")))
      .filter((line) => line.length >= 20);
  }
  return [];
}

function isInternalClaim(claim) {
  return claim.status === "internal-only" ||
    INTERNAL_PATTERNS.some((pattern) =>
      pattern.test(`${claim.claimId} ${claim.area} ${claim.resumeClaim} ${claim.caveat}`)
    );
}

function metricTokens(value) {
  return unique(
    String(value ?? "")
      .match(/(?<![\w.])(?:\$?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|percent|x|×|\+))?(?:\s*\/\s*(?:day|week|month|year))?)/gi) || []
  ).map((token) => canonicalMetric(token));
}

function canonicalMetric(value) {
  return canonical(value)
    .replaceAll(",", "")
    .replace(/\bpercent\b/g, "%")
    .replace(/×/g, "x")
    .replace(/\s+/g, "");
}

function metricsEquivalent(left, right) {
  return canonicalMetric(left) === canonicalMetric(right);
}

function containsTerm(haystack, term) {
  const normalizedHaystack = canonical(haystack);
  const normalizedTerm = canonical(term);
  if (!normalizedTerm) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`, "i")
    .test(normalizedHaystack);
}

function contentTokens(value) {
  const stop = new Set([
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "is", "of",
    "on", "or", "the", "to", "using", "with", "your", "you", "our", "we",
    "will", "be", "this", "that"
  ]);
  return unique(canonical(value)
    .split(/[^a-z0-9+#.]+/)
    .filter((token) => token.length >= 2 && !stop.has(token)));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function intersection(left, right) {
  const rightSet = new Set(right);
  return unique(left.filter((item) => rightSet.has(item)));
}

function jaccard(left, right) {
  const union = new Set([...left, ...right]);
  return union.size ? intersection(left, right).length / union.size : 0;
}

function canonicalHeader(value) {
  return clean(value).replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function canonical(value) {
  return clean(value).toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeResumeContent(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function findMethodMatch(value) {
  return value.match(/\b(?:using|with|through|via)\s+(.+?)[.]?$/i) ||
    value.match(/\bby\s+(.+?)[.]?$/i);
}

function unique(values) {
  return [...new Set(values)];
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
