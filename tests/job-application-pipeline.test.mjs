import test from "node:test";
import assert from "node:assert/strict";
import {
  buildJobApplicationPipeline,
  extractReadableJobText,
  inferJobMetadataFromText,
  validateFetchableJobUrl,
  assertPublicHostname
} from "../lib/job-application-pipeline.mjs";
import { renderBrief } from "../scripts/generate-tailoring-brief.mjs";

const claimRegistry = [
  {
    claim_id: "NYL-01",
    area: "New York Life",
    resume_claim: "Built reusable enterprise-AI evaluation harness covering 8 agent specs and 15 synthetic test cases.",
    measurement: "8 agent specs; 15 synthetic test cases",
    evidence_source: "resume ledger",
    status: "verified",
    caveat: "Codex-assisted and manually verified."
  },
  {
    claim_id: "WK-01",
    area: "World Kinect",
    resume_claim: "Automated weekly identity-data processing on AWS Lambda, EC2, S3, and IAM, eliminating 10+ hours of reporting work.",
    measurement: "10+ hours/week",
    evidence_source: "resume ledger",
    status: "verified",
    caveat: "Manual reporting estimate."
  },
  {
    claim_id: "AV-01",
    area: "AgenVantage",
    resume_claim: "Built Git-aware context engine with OpenTelemetry traces and 17 deterministic tests.",
    measurement: "17 deterministic tests",
    evidence_source: "benchmark",
    status: "verified",
    caveat: "Local context optimization only."
  },
  {
    claim_id: "PRA-01",
    area: "PR Review Agent prototype",
    resume_claim: "Built PR Review Agent across 75 fixtures.",
    measurement: "75 fixtures",
    status: "verified",
    caveat: "Internal NYL-oriented prototype."
  }
];

test("builds a handbook-style pipeline from a job description", () => {
  const result = buildJobApplicationPipeline({
    jobUrl: "https://jobs.example.com/software-engineer",
    company: "Example",
    roleTitle: "AI Platform Software Engineer",
    jobDescription: [
      "Responsibilities: build AI evaluation systems, Python services, AWS Lambda workflows, OpenTelemetry dashboards.",
      "Requirements: experience with LLM evaluation, REST APIs, GraphQL, Docker, CI/CD, and distributed systems.",
      "Preferred: PyTorch and Kubernetes."
    ].join("\n"),
    masterResume: "",
    claimRegistry,
    resumeText: [
      "Nicholas Tayag",
      "New York Life Insurance Company, New York, NY",
      "Built unrelated AI governance notes.",
      "World Kinect Corporation, Miami, FL",
      "Automated weekly identity-data processing on AWS Lambda, EC2, S3, and IAM."
    ].join("\n")
  });
  assert.equal(result.analysisOnly, true);
  assert.equal(result.selectedMasterResume, "ai_engineer");
  assert.equal(result.handbookChecklist.handbookRules.length, 6);
  assert.ok(result.handbookChecklist.explicitTechnicalKeywords.includes("Python"));
  assert.ok(result.handbookChecklist.resumeMissingKeywords.includes("PyTorch"));
  assert.ok(result.resumeEdits.addOrEmphasize.some((item) => item.claimId === "NYL-01"));
  assert.ok(result.lineAdjustments.some((item) =>
    item.line === 3 &&
    item.replacement?.includes("8 agent specs")
  ));
  assert.ok(result.resumeEdits.doNotAddWithoutEvidence.includes("Kubernetes"));
  assert.equal(result.atsChecklist.isAtsProbability, false);
  assert.ok(result.atsChecklist.hazards.some((item) => item.includes("Kubernetes")));
  assert.ok(result.prompts.handbookKeywordPrompt.includes("Extract a keyword checklist"));
  assert.match(result.tailoringBrief, /# Tailoring Brief/);
  assert.match(result.tailoringBrief, /Small-context LLM handoff prompt/);
  assert.equal(result.score.isProbability, false);
  assert.ok(result.guardrails.some((item) => item.includes("does not modify")));
});

test("selects general SWE when the job is backend/platform rather than AI-heavy", () => {
  const result = buildJobApplicationPipeline({
    jobUrl: "https://jobs.example.com/backend",
    company: "Example",
    roleTitle: "Backend Software Engineer",
    jobDescription: "Build C# .NET REST APIs, SQL Server data models, Redis caching, and CI/CD pipelines.",
    claimRegistry,
    resumeText: "C# .NET REST APIs SQL Server Redis CI/CD"
  });
  assert.equal(result.selectedMasterResume, "general_swe");
  assert.match(result.packageSummary, /Master resume: general_swe/);
});

test("hard-excludes internal PR Review Agent content through the nested resume agent", () => {
  const result = buildJobApplicationPipeline({
    jobUrl: "https://jobs.example.com/tools",
    roleTitle: "Software Engineer",
    jobDescription: "Build PR review tools and CI/CD automation.",
    claimRegistry,
    resumeText: "Built PR Review Agent across 75 fixtures."
  });
  assert.equal(result.resumeAgent.claims.eligible.some((claim) => claim.claimId === "PRA-01"), false);
  assert.ok(result.resumeAgent.findings.internalContent.length > 0);
});

test("extracts readable text and metadata from simple job HTML", () => {
  const html = `
    <html><head><title>Software Engineer, AI Platform | Example</title></head>
    <body><script>ignore()</script><h1>Software Engineer, AI Platform</h1>
    <section>Requirements: Python &amp; GraphQL. Remote.</section></body></html>
  `;
  const text = extractReadableJobText(html);
  assert.ok(text.includes("Software Engineer, AI Platform"));
  assert.ok(text.includes("Python & GraphQL"));
  assert.equal(text.includes("ignore()"), false);
  const metadata = inferJobMetadataFromText(text, "https://jobs.example.com/123");
  assert.match(metadata.role, /Software Engineer/i);
  assert.equal(metadata.company, "Example");
  assert.equal(metadata.location, "Remote");
});

test("prefers schema.org JobPosting over noisy app-shell text", () => {
  const html = `
    <html><head><meta name="description" content="Wrong footer text Go authorization"></head>
    <body>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"JobPosting","title":"Software Engineer","description":"Build API infrastructure, data pipelines, monitoring, and AI solutions using Python and C#."}
      </script>
      <main>Cookie banner authorization unrelated footer</main>
    </body></html>
  `;
  const text = extractReadableJobText(html);
  assert.ok(text.includes("Build API infrastructure"));
  assert.ok(text.includes("Python and C#"));
  assert.equal(text.includes("Cookie banner"), false);
});

test("rejects unsafe job URLs before fetch", async () => {
  assert.throws(() => validateFetchableJobUrl("file:///etc/passwd"), /http or https/);
  assert.throws(() => validateFetchableJobUrl("https://user:pass@example.com/job"), /credentials/);
  await assert.rejects(() => assertPublicHostname("localhost"), /public job page/);
  await assert.rejects(() => assertPublicHostname("127.0.0.1"), /private address|public job page/);
});

test("renders deterministic tailoring brief as compact LLM handoff", () => {
  const pipeline = buildJobApplicationPipeline({
    company: "Example",
    roleTitle: "Software Engineer",
    jobDescription: "Build Python APIs, CI/CD, data pipelines, and monitoring.",
    claimRegistry,
    resumeText: "Nicholas Tayag\nEmail: n@example.com\nEXPERIENCE\nBuilt Python APIs.\nEDUCATION\nUF\nSKILLS\nPython\nPROJECTS\nAgenVantage"
  });
  const markdown = renderBrief(pipeline, {
    resumeFile: "/tmp/resume.md",
    claimRegistry: "/tmp/claims.csv"
  });
  assert.match(markdown, /# Tailoring Brief/);
  assert.match(markdown, /Small-context LLM handoff prompt/);
  assert.match(markdown, /Exact line edits/);
  assert.match(markdown, /Do not add without evidence/);
  assert.doesNotMatch(markdown, /PR Review Agent/);
});
