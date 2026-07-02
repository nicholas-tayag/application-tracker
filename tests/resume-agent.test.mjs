import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  analyzeBullets,
  analyzeResumeQuality,
  detectUnsupportedAssertions,
  hashResumeContent,
  hashResumeFile,
  parseClaimRegistryCsv,
  shouldAnalyzeResume,
  validateBulletAgainstClaim
} from "../lib/resume-agent.mjs";

const claims = [
  {
    claim_id: "AV-01",
    area: "AgenVantage",
    resume_claim: "Reduced agent context by 94% across 3 codebases using Git-aware ranking.",
    measurement: "94%; 3 codebases",
    evidence_source: "benchmark",
    status: "verified",
    caveat: "Local context reduction, not provider cost reduction."
  },
  {
    claim_id: "VT-01",
    area: "VisionTagger",
    resume_claim: "Achieved 0.75 macro F1 across 12 labels using ResNet-18 transfer learning.",
    measurement: "0.75 macro F1; 12 labels",
    evidence_source: "saved validation run",
    status: "verified",
    caveat: "Private dataset unavailable for retraining."
  },
  {
    claim_id: "WK-02",
    area: "World Kinect",
    resume_claim: "Eliminated 10+ reporting hours per week by automating identity processing with AWS.",
    measurement: "10+ hours/week",
    evidence_source: "personal recollection",
    status: "confirm",
    caveat: "Stakeholder estimate; not instrumented."
  },
  {
    claim_id: "SASE-01",
    area: "SASE",
    resume_claim: "Protected a 250+ member platform by implementing Redis rate limits.",
    measurement: "250+ members",
    evidence_source: "organization scope",
    status: "partial",
    caveat: "Load protection needs benchmark evidence."
  },
  {
    claim_id: "PRA-01",
    area: "PR Review Agent prototype",
    resume_claim: "Built a schema-validated explicit-pattern baseline across 75 fixtures.",
    measurement: "75 fixtures",
    evidence_source: "internal benchmark",
    status: "internal-only",
    caveat: "NYL-oriented architecture exploration."
  }
];

test("rejects fabricated metrics and causal upgrades while normalizing metrics", () => {
  const metric = validateBulletAgainstClaim(
    "Reduced agent context by 99% across 8 codebases using Git-aware ranking.",
    claims[0]
  );
  assert.equal(metric.valid, false);
  assert.deepEqual(metric.unsupportedMetrics, ["99%", "8"]);

  const equivalent = validateBulletAgainstClaim(
    "Reduced agent context by 94 percent across 3 codebases using Git-aware ranking.",
    claims[0]
  );
  assert.equal(equivalent.valid, true);

  const causal = validateBulletAgainstClaim(
    "Improved model quality to 0.75 macro F1 across 12 labels using ResNet-18.",
    claims[1]
  );
  assert.equal(causal.valid, false);
  assert.deepEqual(causal.causalUpgrade, ["improved"]);
});

test("preserves accomplishment-measurement-method XYZ ordering", () => {
  const result = analyzeResumeQuality({
    jobDescription: "Build LLM retrieval and ranking systems in Python.",
    role: { title: "AI Engineer" },
    masterResume: "ai_engineer",
    claimRegistry: claims,
    resumeBullets: [claims[0].resume_claim]
  });
  const recommendation = result.bulletRecommendations.find((item) =>
    item.claimId === "AV-01"
  );
  assert.equal(recommendation.xyz.ordering, "accomplishment-measurement-method");
  assert.match(recommendation.xyz.accomplishment, /^Reduced agent context/);
  assert.match(recommendation.xyz.measurement, /94%/);
  assert.equal(recommendation.xyz.method, "Git-aware ranking");
});

test("returns stable line estimates and XYZ findings", () => {
  const short = "Built 12 APIs using Node.js.";
  const long = "Built a deliberately verbose platform bullet that exceeds the configured visual line budget while retaining enough words to trigger a likely second line.";
  const findings = analyzeBullets([short, long], 60);
  assert.equal(findings.lineEstimates[0].oneLineLikely, true);
  assert.equal(findings.lineEstimates[1].oneLineLikely, false);
  assert.equal(findings.overLineLimit.length, 1);
  assert.equal(findings.xyz[0].complete, true);
  assert.equal(findings.xyzComplete.length, 1);
});

test("reports explicit keyword coverage without inventing skills", () => {
  const result = analyzeResumeQuality({
    jobDescription: "Build Python and PyTorch computer vision models deployed with Kubernetes.",
    role: { title: "Machine Learning Engineer" },
    masterResume: "ai_engineer",
    claimRegistry: claims,
    resumeText: "Python, PyTorch, computer vision, ResNet-18"
  });
  assert.deepEqual(
    result.keywordCoverage.matched.sort(),
    ["Python", "PyTorch", "computer vision"].sort()
  );
  assert.ok(result.keywordCoverage.missing.includes("Kubernetes"));
  assert.ok(result.missingEvidenceWarnings.some((warning) =>
    warning.keyword === "Kubernetes" &&
    warning.type === "missing_evidence" &&
    warning.message.startsWith("Do not add")
  ));
});

test("finds duplicate bullets and weak lead verbs", () => {
  const findings = analyzeBullets([
    "Helped build REST APIs and SQL services for an enterprise platform.",
    "Built REST APIs and SQL services for the enterprise platform.",
    "Achieved 0.75 macro F1 across 12 labels using ResNet-18."
  ]);
  assert.equal(findings.weakVerbs[0].verb, "helped");
  assert.equal(findings.redundancy.length, 1);
  assert.deepEqual(
    [findings.redundancy[0].left, findings.redundancy[0].right],
    [0, 1]
  );
});

test("uses only verified claims and hard-excludes internal prototypes", () => {
  const result = analyzeResumeQuality({
    jobDescription: "Build AI evaluation, AWS, Redis, and model systems.",
    role: { title: "AI Engineer" },
    masterResume: "ai_engineer",
    claimRegistry: claims
  });
  assert.deepEqual(
    result.claims.eligible.map((claim) => claim.claimId).sort(),
    ["AV-01", "VT-01"].sort()
  );
  assert.deepEqual(
    result.claims.needsConfirmation.map((claim) => claim.claimId).sort(),
    ["SASE-01", "WK-02"].sort()
  );
  assert.deepEqual(result.claims.excluded.map((claim) => claim.claimId), ["PRA-01"]);
  assert.ok(result.bulletRecommendations.every((item) => item.status === "verified"));
});

test("rejects PR Review Agent content even if mislabeled verified", () => {
  const result = analyzeResumeQuality({
    jobDescription: "Build PR review tools.",
    role: { title: "Software Engineer" },
    masterResume: "general_swe",
    resumeText: "Built PR Review Agent across 75 fixtures.",
    claimRegistry: [{
      claim_id: "PRA-X",
      area: "PR Review Agent prototype",
      resume_claim: "Built an internal review prototype across 75 fixtures.",
      measurement: "75 fixtures",
      status: "verified"
    }]
  });
  assert.equal(result.claims.eligible.length, 0);
  assert.equal(result.claims.excluded.length, 1);
  assert.equal(result.findings.internalContent.length, 1);
  assert.ok(result.recommendations.some((item) => item.type === "prohibited_content"));
});

test("detects unsupported metrics and skills against verified evidence only", () => {
  const unsupported = detectUnsupportedAssertions(
    "Reduced context by 94% across 3 codebases with Python and Kubernetes; served 500 users.",
    claims
  );
  assert.deepEqual(unsupported.metrics.map((item) => item.value), ["500"]);
  assert.deepEqual(
    unsupported.skills.map((item) => item.value).sort(),
    ["Kubernetes", "Python"].sort()
  );
});

test("parses quoted claim registry CSV deterministically", () => {
  const parsed = parseClaimRegistryCsv([
    "claim_id,area,resume_claim,measurement,status,caveat",
    'AT-01,Application Tracker,"Unified ranking, filtering, and analytics.","294 roles",verified,"Snapshot, not users."'
  ].join("\n"));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].claim_id, "AT-01");
  assert.equal(parsed[0].resume_claim, "Unified ranking, filtering, and analytics.");
});

test("exposes a transparent 100-point rubric rather than a probability", () => {
  const result = analyzeResumeQuality({
    jobDescription: "Build Python machine learning and PyTorch systems.",
    role: { title: "Machine Learning Engineer" },
    masterResume: "ai_engineer",
    claimRegistry: claims,
    resumeText: "Python PyTorch machine learning"
  });
  assert.equal(result.analysisOnly, true);
  assert.equal(result.score.isProbability, false);
  assert.equal(
    Object.values(result.score.rubric)
      .reduce((sum, item) => sum + item.possible, 0),
    100
  );
  assert.ok(result.guardrails.some((item) => item.includes("not an ATS")));
});

test("content and file hashes support deterministic cache skipping", async () => {
  const content = "Built 12 APIs using Node.js.\n";
  const directory = await mkdtemp(join(tmpdir(), "resume-agent-"));
  const path = join(directory, "resume.txt");
  await writeFile(path, content);
  const contentHash = hashResumeContent(content);
  assert.equal(await hashResumeFile(path), contentHash);
  assert.equal(shouldAnalyzeResume(contentHash, contentHash), false);
  assert.equal(shouldAnalyzeResume(hashResumeContent(`${content}changed`), contentHash), true);

  const cached = analyzeResumeQuality({
    resumeText: content,
    previousResumeHash: contentHash
  });
  assert.equal(cached.cache.changed, false);
  assert.match(cached.cache.cacheKey, new RegExp(contentHash));
});
