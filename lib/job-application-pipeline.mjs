import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import {
  analyzeResumeQuality,
  parseClaimRegistryCsv
} from "./resume-agent.mjs";

export const PIPELINE_VERSION = 1;

const HANDBOOK_STEPS = [
  {
    id: "target_role",
    label: "Classify target role",
    prompt: "What role family is this job actually hiring for: General SWE, backend/platform, AI/ML, security/identity, frontend, or data?"
  },
  {
    id: "keyword_checklist",
    label: "Build keyword checklist",
    prompt: "Extract repeated required skills, technologies, domain phrases, and qualifications from the job description."
  },
  {
    id: "resume_gap_scan",
    label: "Compare against master resume",
    prompt: "Which job keywords are already supported by verified resume evidence, which are missing, and which should not be added?"
  },
  {
    id: "bullet_selection",
    label: "Select evidence-backed bullets",
    prompt: "Choose only bullets that maximize relevance while preserving accurate metrics, ownership, and interview defensibility."
  },
  {
    id: "ats_review",
    label: "ATS and recruiter scan",
    prompt: "Check that the tailored resume remains boring, readable, keyword-aligned, one-column, and metric-backed."
  },
  {
    id: "human_review",
    label: "Manual final review",
    prompt: "Confirm eligibility, location, work authorization, resume version, and every application answer before manually submitting."
  }
];

const REQUIRED_SECTION_PATTERNS = [
  /\bqualifications?\b/i,
  /\brequirements?\b/i,
  /\bresponsibilit(?:y|ies)\b/i,
  /\babout (?:the )?role\b/i,
  /\bwhat you(?:'|’)ll do\b/i,
  /\bminimum\b/i,
  /\bpreferred\b/i
];

const DREAM_COMPANIES = [
  "Google", "Meta", "Microsoft", "Amazon", "Apple", "Netflix", "NVIDIA",
  "OpenAI", "Anthropic", "Datadog", "Stripe", "Palantir", "CoreWeave"
];

export function buildJobApplicationPipeline(input = {}) {
  const job = normalizeJobInput(input);
  const resumeText = String(input.resumeText || "").trim();
  const claimRegistry = Array.isArray(input.claimRegistry)
    ? input.claimRegistry
    : parseClaimRegistryCsv(input.claimRegistryCsv || "");
  const masterResume = selectMasterResume(job, input.masterResume);
  const analysis = analyzeResumeQuality({
    jobDescription: job.description,
    role: job,
    masterResume,
    claimRegistry,
    resumeText,
    resumeBullets: input.resumeBullets,
    lineLimit: input.lineLimit || 118
  });
  const handbookChecklist = buildHandbookChecklist(job, analysis);
  const resumeEdits = buildResumeEditPlan(analysis, job, masterResume);
  const lineAdjustments = buildLineAdjustments(resumeText, analysis, resumeEdits);
  const atsChecklist = buildAtsChecklist(resumeText, analysis, handbookChecklist, lineAdjustments);
  const prompts = buildPromptPack(job, analysis, resumeEdits);
  const packageSummary = buildPackageSummary(job, analysis, resumeEdits);
  const contextAgent = buildContextAgentPacket({
    job,
    masterResume,
    analysis,
    handbookChecklist,
    atsChecklist,
    resumeEdits,
    lineAdjustments
  });
  const basePipeline = {
    version: PIPELINE_VERSION,
    analysisOnly: true,
    source: {
      url: job.url,
      extractedFromUrl: Boolean(input.extractedFromUrl),
      fetchedAt: clean(input.fetchedAt)
    },
    job,
    selectedMasterResume: masterResume,
    handbookChecklist,
    atsChecklist,
    prompts,
    contextAgent,
    resumeEdits,
    lineAdjustments,
    score: scoreApplicationFit(analysis, job),
    resumeAgent: analysis,
    packageSummary,
    guardrails: [
      "This pipeline recommends edits; it does not modify or submit a resume.",
      "Final applications remain manual and require human review.",
      "Do not add missing keywords without verified evidence.",
      "Legal, demographic, sponsorship, salary, and work-authorization answers are never inferred.",
      "Treat a rejected application as a signal to investigate, not proof of a specific screening failure."
    ]
  };

  return {
    ...basePipeline,
    tailoringBrief: renderTailoringBrief(basePipeline, {
      resumeFile: clean(input.resumeFile || "pasted resume text"),
      claimRegistry: clean(input.claimRegistryPath || "default claim registry")
    })
  };
}

export function buildLineAdjustments(resumeText, analysis, edits) {
  const lines = String(resumeText || "")
    .split(/\r?\n/)
    .map((text, index) => ({ number: index + 1, text: text.trim() }))
    .filter((line) => line.text);
  if (!lines.length) {
    return [{
      type: "resume_text_required",
      line: null,
      action: "Paste your master resume text into the scanner to get exact line-by-line edits.",
      reason: "The pipeline can score the job without resume text, but exact line edits require the source lines."
    }];
  }
  const adjustments = [];
  const usedReplacementLines = new Set();
  const bulletLines = lines.filter((line) =>
    /^[-*•]\s+/.test(line.text) || looksLikeAccomplishment(line.text)
  );
  for (const item of edits.addOrEmphasize || []) {
    if (containsTerm(resumeText, item.bullet)) continue;
    const anchor = findAreaAnchor(lines, item.area, usedReplacementLines) ||
      findWeakReplacementLine(bulletLines, analysis, usedReplacementLines);
    if (anchor?.number) usedReplacementLines.add(anchor.number);
    adjustments.push({
      type: "add_or_replace",
      line: anchor?.number || null,
      current: anchor?.text || "",
      action: anchor
        ? `Add near or replace this line with: ${item.bullet}`
        : `Add this evidence-backed bullet: ${item.bullet}`,
      replacement: item.bullet,
      claimId: item.claimId,
      reason: `Verified claim matches this job through: ${(item.relevanceTerms || []).join(", ") || "role keywords"}.`
    });
  }
  for (const warning of analysis.missingEvidenceWarnings || []) {
    if (warning.type === "missing_evidence") {
      adjustments.push({
        type: "do_not_add",
        line: null,
        keyword: warning.keyword,
        action: `Do not add "${warning.keyword}" unless you can point to real evidence first.`,
        reason: warning.message
      });
    }
  }
  for (const item of analysis.findings.overLineLimit || []) {
    const match = findLineContaining(lines, item.bullet);
    if (match) {
      adjustments.push({
        type: "shorten",
        line: match.number,
        current: match.text,
        action: "Shorten this line after tailoring; it is likely to wrap heavily in the one-page template.",
        reason: `${item.characters} characters estimated as ${item.estimatedLines} lines.`
      });
    }
  }
  if (!adjustments.length) {
    adjustments.push({
      type: "no_change",
      line: null,
      action: "No exact line edits were required by the deterministic scan. Manually verify formatting before submission.",
      reason: "Resume text already covers the explicit supported keywords detected by the scanner."
    });
  }
  return adjustments.slice(0, 14);
}

export function buildAtsChecklist(resumeText, analysis, handbookChecklist = {}, lineAdjustments = []) {
  const text = String(resumeText || "");
  const canonicalText = canonical(text);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sectionText = lines.join("\n");
  const hazards = [];
  const passes = [];

  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  const hasLinkedIn = /linkedin\.com\/in\//i.test(text);
  const hasGithub = /github\.com\//i.test(text);
  if (hasEmail) passes.push("Header includes an email address.");
  else hazards.push("Add a plain-text email address in the header.");
  if (hasLinkedIn || hasGithub) passes.push("Header includes at least one plain-text professional profile link.");
  else hazards.push("Add plain-text LinkedIn and/or GitHub URLs; avoid icon-only links.");

  const sectionChecks = [
    ["experience", /\b(work\s+experience|experience|professional\s+experience)\b/i],
    ["education", /\beducation\b/i],
    ["skills", /\bskills\b/i],
    ["projects", /\bprojects?\b/i]
  ];
  const missingSections = sectionChecks
    .filter(([, pattern]) => !pattern.test(sectionText))
    .map(([section]) => section);
  if (missingSections.length) {
    hazards.push(`Missing ATS-standard section label(s): ${missingSections.join(", ")}.`);
  } else {
    passes.push("Uses standard ATS-readable section labels.");
  }

  if (/[◆◇●■□▸→]/.test(text)) {
    hazards.push("Remove decorative icons/symbols that may extract poorly in ATS parsers.");
  } else {
    passes.push("No ATS-hostile decorative icons detected in pasted text.");
  }
  if (/\b(table|textbox|text box|two-column|sidebar)\b/i.test(text)) {
    hazards.push("Verify the final document is single-column and does not rely on tables/text boxes.");
  } else {
    passes.push("No obvious table/sidebar wording detected in pasted text.");
  }

  const missingKeywords = handbookChecklist.resumeMissingKeywords || [];
  const doNotAdd = new Set(lineAdjustments
    .filter((item) => item.type === "do_not_add")
    .map((item) => canonical(item.keyword || "")));
  const unsafeMissing = missingKeywords.filter((keyword) => doNotAdd.has(canonical(keyword)));
  if (unsafeMissing.length) {
    hazards.push(`Do not keyword-stuff unsupported terms: ${unsafeMissing.join(", ")}.`);
  } else if (missingKeywords.length) {
    hazards.push(`Tailor supported missing terms if truthful: ${missingKeywords.slice(0, 6).join(", ")}.`);
  } else {
    passes.push("Explicit job keywords are covered by the pasted resume text.");
  }

  const overLimit = analysis.findings?.overLineLimit || [];
  if (overLimit.length >= 8) {
    hazards.push(`${overLimit.length} bullet(s) may wrap heavily; shorten only the lines called out in exact edits before exporting.`);
  } else if (overLimit.length) {
    passes.push("Minor line wrapping risk detected; exact edits call out the worst offenders.");
  } else if (lines.length) {
    passes.push("Bullets appear within the configured line-length target.");
  }

  const unsupportedMetrics = (analysis.findings?.unsupportedMetrics || [])
    .filter((item) => isResumeImpactMetric(item.value));
  if (unsupportedMetrics.length) {
    hazards.push(`Verify metric evidence before submitting: ${unsupportedMetrics.slice(0, 4).map((item) => item.value).join(", ")}.`);
  }

  const keywordCoverage = analysis.keywordCoverage?.ratio;
  const passCount = passes.length;
  const hazardCount = hazards.length;
  const status = !lines.length
    ? "resume text required"
    : hazardCount === 0 && (keywordCoverage === null || keywordCoverage >= 0.8)
      ? "ats-ready draft"
      : hazardCount <= 2 && (keywordCoverage === null || keywordCoverage >= 0.6)
        ? "needs light tailoring"
        : "needs review before applying";

  return {
    status,
    isAtsProbability: false,
    note: "Deterministic ATS/readability checklist, not an employer ATS score.",
    passes: passes.slice(0, 8),
    hazards: hazards.slice(0, 10),
    keywordCoverage,
    passCount,
    hazardCount,
    copyPasteReady: Boolean(lines.length && hasEmail && missingSections.length === 0 && hazardCount <= 2),
    handbookAlignment: [
      "Uses exact job keywords only when truthful.",
      "Keeps bullets evidence-backed and recruiter-readable.",
      "Flags unsupported keywords instead of inventing experience.",
      "Prioritizes standard section labels and plain text extraction."
    ]
  };
}

export function renderTailoringBrief(pipeline, context = {}) {
  const checklist = pipeline.handbookChecklist || {};
  const ats = pipeline.atsChecklist || {};
  const edits = pipeline.resumeEdits || {};
  const score = pipeline.score || {};
  return `${tailoringFrontMatter(pipeline)}
# Tailoring Brief — ${pipeline.job?.company || "Company"} ${pipeline.job?.role || "Role"}

Generated deterministically from the job page, master resume text, and claim registry. This is a compact pre-LLM artifact: use it directly for ATS-safe edits, or pass only this brief to an LLM/recruiter judge instead of the full context.

## Inputs

- Job URL: ${pipeline.job?.url || "n/a"}
- Resume file: ${context.resumeFile || "pasted resume text"}
- Claim registry: ${context.claimRegistry || "default claim registry"}
- Fetched at: ${pipeline.source?.fetchedAt || "n/a"}
- Selected master resume: ${pipeline.selectedMasterResume}

## Deterministic verdict

- Application prep score: ${score.total}/100 — ${score.label}
- Score type: ${score.interpretation}
- ATS/readability status: ${ats.status}
- Keyword coverage: ${pipeline.resumeAgent?.keywordCoverage?.covered ?? 0}/${pipeline.resumeAgent?.keywordCoverage?.total ?? 0}
- Copy/paste ready: ${ats.copyPasteReady ? "yes, after human review" : "no, review hazards first"}

## Job keyword target

### Explicit technical keywords

${markdownBulletList(checklist.explicitTechnicalKeywords)}

### Already present in master resume

${markdownBulletList(checklist.resumeMatchedKeywords)}

### Missing or weak in master resume

${markdownBulletList(checklist.resumeMissingKeywords)}

### Repeated job phrases

${markdownBulletList((checklist.repeatedJobPhrases || []).map((item) => `${item.phrase} ×${item.count}`))}

## Exact line edits for master resume

${markdownLineEdits(pipeline.lineAdjustments)}

## ATS / handbook pass

### Fix before applying

${markdownBulletList(ats.hazards)}

### Already OK

${markdownBulletList(ats.passes)}

## Evidence-backed claims to emphasize

${markdownBulletList((edits.addOrEmphasize || []).map((item) =>
  `${item.claimId}: ${item.bullet}${item.caveat ? ` Caveat: ${item.caveat}` : ""}`
))}

## Do not add without evidence

${markdownBulletList(edits.doNotAddWithoutEvidence)}

## Cut or compress

${markdownBulletList((edits.cutOrDeemphasize || []).map((item) => item.action || item.reason))}

## Small-context LLM handoff prompt

\`\`\`text
${pipeline.contextAgent?.llmPrompt || [
  "You are a strict big-tech resume reviewer. Use only the evidence in this deterministic tailoring brief.",
  "Return the 5 highest-impact edits, any lines to shorten, unsupported keywords to avoid, and a final ATS-safe checklist.",
  "Do not invent metrics, skills, employment scope, deployment status, or outcomes."
].join("\n")}
\`\`\`

## Guardrails

${markdownBulletList(pipeline.guardrails)}
`;
}

export function buildContextAgentPacket({
  job,
  masterResume,
  analysis,
  handbookChecklist,
  atsChecklist,
  resumeEdits,
  lineAdjustments
}) {
  const exactEdits = (lineAdjustments || [])
    .filter((item) => ["add_or_replace", "do_not_add", "shorten"].includes(item.type))
    .slice(0, 10)
    .map((item) => ({
      type: item.type,
      line: item.line || null,
      current: item.current || "",
      replacement: item.replacement || "",
      action: item.action || "",
      claimId: item.claimId || "",
      reason: item.reason || ""
    }));
  const evidenceClaims = (resumeEdits.addOrEmphasize || []).slice(0, 8).map((item) => ({
    claimId: item.claimId,
    area: item.area,
    bullet: item.bullet,
    caveat: item.caveat,
    relevanceTerms: item.relevanceTerms || []
  }));
  const unsupportedKeywords = resumeEdits.doNotAddWithoutEvidence || [];
  const packet = {
    version: 1,
    purpose: "small-context resume tailoring packet",
    target: {
      company: job.company || "",
      role: job.role || "",
      location: job.location || "",
      url: job.url || "",
      selectedMasterResume: masterResume
    },
    roleFamily: analysis.roleFamily,
    keywordPlan: {
      explicit: handbookChecklist.explicitTechnicalKeywords || [],
      matched: handbookChecklist.resumeMatchedKeywords || [],
      missing: handbookChecklist.resumeMissingKeywords || [],
      unsupported: unsupportedKeywords,
      repeatedPhrases: (handbookChecklist.repeatedJobPhrases || []).slice(0, 8)
    },
    atsPlan: {
      status: atsChecklist.status,
      copyPasteReady: atsChecklist.copyPasteReady,
      hazards: atsChecklist.hazards || [],
      passes: atsChecklist.passes || []
    },
    exactEdits,
    evidenceClaims,
    compression: {
      jobDescriptionChars: String(job.description || "").length,
      packetCharsEstimate: 0,
      useInsteadOfFullContext: true
    },
    llmPrompt: [
      "You are a strict big-tech resume reviewer.",
      "Use only this context-agent packet; do not request the full resume, full job post, or full claim registry unless a blocker says evidence is missing.",
      "Return exact master-resume line edits, ATS-safe keyword priorities, unsupported keywords to avoid, and a final human review checklist.",
      "Do not invent metrics, skills, employment scope, deployment status, or outcomes."
    ].join("\n")
  };
  packet.compression.packetCharsEstimate = JSON.stringify(packet).length;
  return packet;
}

export async function fetchJobDescriptionFromUrl(url, options = {}) {
  const parsed = validateFetchableJobUrl(url);
  await assertPublicHostname(parsed.hostname);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Number(options.timeoutMs || 10000))
  );
  try {
    const response = await fetch(parsed.href, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "user-agent": "application-tracker-local-job-scanner/1.0"
      }
    });
    const finalUrl = response.url || parsed.href;
    const finalParsed = validateFetchableJobUrl(finalUrl);
    await assertPublicHostname(finalParsed.hostname);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      const error = new Error(`job page returned HTTP ${response.status}`);
      error.code = "JOB_FETCH_FAILED";
      throw error;
    }
    if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
      const error = new Error("job page is not readable HTML/text");
      error.code = "JOB_UNREADABLE_CONTENT";
      throw error;
    }
    const raw = await response.text();
    return {
      url: parsed.href,
      finalUrl,
      title: extractTitle(raw),
      description: extractReadableJobText(raw),
      fetchedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function extractReadableJobText(htmlOrText) {
  const source = String(htmlOrText || "");
  const structured = extractStructuredJobPostingText(source);
  if (structured) return structured.slice(0, 50000);
  const withoutScripts = source
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const text = decodeEntities(withoutScripts.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 50000);
}

function extractStructuredJobPostingText(source) {
  const blocks = [...String(source || "").matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(decodeEntities(block[1]).trim());
      const postings = Array.isArray(parsed) ? parsed : [parsed];
      const posting = postings.find((item) =>
        item && typeof item === "object" && /JobPosting/i.test(String(item["@type"] || ""))
      );
      if (!posting) continue;
      return [
        posting.title,
        posting.hiringOrganization?.name,
        posting.jobLocation?.address?.addressLocality,
        posting.jobLocation?.address?.addressRegion,
        posting.description,
        posting.qualifications,
        posting.responsibilities,
        posting.skills
      ].filter(Boolean).map((value) => extractReadableJobText(String(value))).join(" ");
    } catch {
      // Fall back to generic extraction below.
    }
  }
  const meta = String(source || "").match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  return meta ? decodeEntities(meta[1]).replace(/\s+/g, " ").trim() : "";
}

export function inferJobMetadataFromText(text, url = "") {
  const cleanText = clean(text);
  const titleMatch = cleanText.match(/\b(?:software|ai|machine learning|backend|frontend|full stack|platform|data|security)[\w\s/+-]{0,80}(?:engineer|developer|intern)\b/i);
  const companyFromText = (() => {
    const patterns = [
      /\bjob application for .{0,90}? at ([A-Z][A-Za-z0-9&.,' -]{2,60})\b/i,
      /\b(?:hiring organization|company)\s*[:\-]\s*([A-Z][A-Za-z0-9&.,' -]{2,60})\b/i
    ];
    for (const pattern of patterns) {
      const match = cleanText.match(pattern);
      if (match?.[1]) {
        return clean(match[1], 80)
          .replace(/\s+(?:back to|job|jobs|careers).*$/i, "")
          .trim();
      }
    }
    return "";
  })();
  const companyFromHost = (() => {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "");
      if (host.endsWith("greenhouse.io")) {
        const pathCompany = parsed.pathname.split("/").filter(Boolean)[0] || "";
        if (pathCompany && !["jobs", "job"].includes(pathCompany.toLowerCase())) {
          return pathCompany
            .replace(/[-_]+/g, " ")
            .replace(/\b\w/g, (char) => char.toUpperCase());
        }
      }
      const parts = host.split(".").filter(Boolean);
      const meaningful = parts.find((part) =>
        !["apply", "career", "careers", "jobs", "job", "boards", "job-boards", "boards-api", "greenhouse", "myworkdayjobs", "wd12", "www"].includes(part.toLowerCase())
      ) || parts[0] || "";
      return meaningful
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
    } catch {
      return "";
    }
  })();
  return {
    role: normalizeInferredRole(titleMatch ? titleMatch[0] : ""),
    company: companyFromText || companyFromHost,
    location: inferLocation(cleanText)
  };
}

export function validateFetchableJobUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    const error = new Error("jobUrl must be a valid URL");
    error.code = "INVALID_JOB_URL";
    throw error;
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    const error = new Error("jobUrl must use http or https");
    error.code = "INVALID_JOB_URL";
    throw error;
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    const error = new Error("jobUrl must not include credentials");
    error.code = "INVALID_JOB_URL";
    throw error;
  }
  return parsed;
}

export async function assertPublicHostname(hostname) {
  const lower = String(hostname || "").toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower === "0.0.0.0" ||
    lower === "127.0.0.1" ||
    lower === "::1"
  ) {
    const error = new Error("jobUrl must point to a public job page");
    error.code = "PRIVATE_JOB_URL";
    throw error;
  }
  if (isPrivateIp(lower)) {
    const error = new Error("jobUrl resolves to a private address");
    error.code = "PRIVATE_JOB_URL";
    throw error;
  }
  try {
    const addresses = await lookup(lower, { all: true, verbatim: true });
    if (addresses.some((item) => isPrivateIp(item.address))) {
      const error = new Error("jobUrl resolves to a private address");
      error.code = "PRIVATE_JOB_URL";
      throw error;
    }
  } catch (error) {
    if (error.code === "PRIVATE_JOB_URL") throw error;
  }
}

function normalizeJobInput(input) {
  const provided = input.job || input.role || {};
  const textMetadata = inferJobMetadataFromText(input.jobDescription || provided.description, input.jobUrl || provided.url);
  return {
    url: clean(input.jobUrl || provided.url),
    company: clean(input.company || provided.company || textMetadata.company),
    role: clean(input.roleTitle || provided.role || provided.title || textMetadata.role),
    title: clean(input.roleTitle || provided.role || provided.title || textMetadata.role),
    location: clean(input.location || provided.location || textMetadata.location),
    description: clean(input.jobDescription || provided.description || provided.qualifications || "", 50000)
  };
}

function selectMasterResume(job, requested) {
  const normalized = canonical(requested);
  if (["ai", "ai engineer", "ai_engineer"].includes(normalized)) return "ai_engineer";
  if (["swe", "general", "general swe", "general_swe"].includes(normalized)) return "general_swe";
  const corpus = canonical(`${job.role} ${job.title} ${job.description}`);
  return /\b(ai|machine learning|ml engineer|llm|pytorch|tensorflow|model|rag|embedding|inference)\b/.test(corpus)
    ? "ai_engineer"
    : "general_swe";
}

function buildHandbookChecklist(job, analysis) {
  const required = analysis.keywordCoverage.required;
  const matched = analysis.keywordCoverage.matched;
  const missing = analysis.keywordCoverage.missing;
  const repeatedPhrases = repeatedImportantPhrases(job.description);
  const sectionSignals = REQUIRED_SECTION_PATTERNS
    .filter((pattern) => pattern.test(job.description))
    .map((pattern) => pattern.source.replace(/\\b|\(\?:|\)|\?|\\|'|’|\./g, ""));
  return {
    roleFamily: analysis.roleFamily,
    explicitTechnicalKeywords: required,
    resumeMatchedKeywords: matched,
    resumeMissingKeywords: missing,
    repeatedJobPhrases: repeatedPhrases,
    detectedSections: sectionSignals,
    handbookRules: HANDBOOK_STEPS,
    recruiterChecklist: [
      "Use a targeted resume variant; do not show every project.",
      "Place the highest-relevance experience bullets first.",
      "Use action + metric + method bullets where evidence supports the metric.",
      "Mirror exact job keywords only when your evidence supports them.",
      "Keep formatting plain: one column, standard headings, no icons or tables."
    ]
  };
}

function buildResumeEditPlan(analysis, job, masterResume) {
  const missingSupported = analysis.missingEvidenceWarnings
    .filter((warning) => warning.type === "unused_supported_keyword")
    .map((warning) => warning.keyword);
  const missingUnsupported = analysis.missingEvidenceWarnings
    .filter((warning) => warning.type === "missing_evidence")
    .map((warning) => warning.keyword);
  const verifiedBullets = analysis.bulletRecommendations
    .filter((item) => item.valid)
    .slice(0, 6)
    .map((item) => ({
      claimId: item.claimId,
      area: analysis.claims.eligible.find((claim) => claim.claimId === item.claimId)?.area || "",
      bullet: item.bullet,
      evidenceSource: item.evidenceSource,
      caveat: item.caveat,
      relevanceTerms: item.relevanceTerms
    }));
  const cuts = buildCutRecommendations(analysis, job);
  return {
    masterResume,
    targetSummary: `${job.company || "Target company"} — ${job.role || "Target role"}`,
    addOrEmphasize: verifiedBullets,
    missingSupportedKeywords: missingSupported,
    doNotAddWithoutEvidence: missingUnsupported,
    rewritePrompts: [
      "Rewrite the top 3 work bullets so each includes action + metric + method and at least one supported job keyword.",
      "Replace weak lead verbs such as helped/assisted/worked with direct ownership verbs only when accurate.",
      "If a keyword is missing and unsupported, do not add it; consider a project only if it truly demonstrates the skill.",
      "Render the final resume and manually check line wrapping before submitting."
    ],
    cutOrDeemphasize: cuts,
    warnings: [
      ...analysis.findings.internalContent.map((item) => item.reason),
      ...analysis.claims.needsConfirmation.map((claim) =>
        `${claim.claimId} needs evidence review before resume use: ${claim.caveat || "confirm claim."}`
      )
    ]
  };
}

function buildCutRecommendations(analysis, job) {
  const cuts = [];
  if (analysis.findings.overLineLimit.length) {
    cuts.push({
      reason: "Some bullets are likely to wrap heavily.",
      action: "Shorten or split these bullets after visual resume rendering.",
      bulletIndexes: analysis.findings.overLineLimit.map((item) => item.index)
    });
  }
  if (analysis.keywordCoverage.missing.length > analysis.keywordCoverage.matched.length) {
    cuts.push({
      reason: "Keyword coverage is below the job's explicit requirements.",
      action: "Remove lower-relevance projects and make room for verified experience that matches the role."
    });
  }
  if (DREAM_COMPANIES.some((company) => containsTerm(`${job.company} ${job.description}`, company))) {
    cuts.push({
      reason: "Dream-company application detected.",
      action: "Use the stricter one-page variant and preserve only the highest-signal bullets."
    });
  }
  return cuts;
}

function findAreaAnchor(lines, area, usedLineNumbers = new Set()) {
  if (!area) return null;
  const normalizedArea = canonical(area);
  const aliases = [
    normalizedArea,
    normalizedArea.includes("new york life") ? "new york life" : "",
    normalizedArea.includes("world kinect") ? "world kinect" : "",
    normalizedArea.includes("agenvantage") ? "agenvantage" : "",
    normalizedArea.includes("application tracker") ? "application tracker" : "",
    normalizedArea.includes("vision") ? "visiontagger" : "",
    normalizedArea.includes("rtx") ? "rtx" : "",
    normalizedArea.includes("florida") ? "florida community innovation" : ""
  ].filter(Boolean);
  const header = lines.find((line) => aliases.some((alias) => containsTerm(line.text, alias)));
  if (!header) return null;
  return lines.find((line) =>
    line.number > header.number &&
    !usedLineNumbers.has(line.number) &&
    (/^[-*•]\s+/.test(line.text) || looksLikeAccomplishment(line.text))
  ) || (!usedLineNumbers.has(header.number) ? header : null);
}

function findWeakReplacementLine(lines, analysis, usedLineNumbers = new Set()) {
  const weak = new Set((analysis.findings.weakVerbs || []).map((item) => item.bullet));
  return lines.find((line) => weak.has(line.text.replace(/^[-*•]\s+/, "")) && !usedLineNumbers.has(line.number)) ||
    lines.find((line) => canonical(line.text).includes("mesh") && !usedLineNumbers.has(line.number)) ||
    [...lines].reverse().find((line) => !usedLineNumbers.has(line.number)) ||
    null;
}

function findLineContaining(lines, text) {
  const needle = canonical(String(text || "").replace(/^[-*•]\s+/, "")).slice(0, 80);
  if (!needle) return null;
  return lines.find((line) => canonical(line.text).includes(needle)) || null;
}

function looksLikeAccomplishment(text) {
  return /^(built|implemented|validated|identified|researched|co-developed|consolidated|automated|engineered|instrumented|added)\b/i
    .test(String(text || "").replace(/^[-*•]\s+/, ""));
}

function buildPromptPack(job, analysis, resumeEdits) {
  return {
    handbookKeywordPrompt: [
      "Extract a keyword checklist from this job description.",
      "Group the output into required skills, preferred skills, domain keywords, repeated phrases, and missing resume keywords.",
      "Do not invent qualifications. Use exact wording from the job when possible.",
      "",
      job.description.slice(0, 5000)
    ].join("\n"),
    resumeTailoringPrompt: [
      "Tailor my master resume to this job using only verified evidence.",
      `Target: ${job.company || "Unknown company"} — ${job.role || "Unknown role"}`,
      `Selected master resume: ${resumeEdits.masterResume}`,
      `Role family: ${analysis.roleFamily.label}`,
      `Matched keywords: ${analysis.keywordCoverage.matched.join(", ") || "none"}`,
      `Missing keywords not to add without evidence: ${resumeEdits.doNotAddWithoutEvidence.join(", ") || "none"}`,
      "Return exact bullet edits, cuts, and risks. Do not write unsupported claims."
    ].join("\n"),
    recruiterJudgePrompt: [
      "Act as a Big Tech recruiter and score whether this tailored resume likely earns a screen.",
      "Score role fit, scan speed, keyword coverage, metrics, and overclaim risk.",
      "Return a deterministic writing score, not a probability."
    ].join("\n")
  };
}

function buildPackageSummary(job, analysis, edits) {
  return [
    `${job.company || "Company"} — ${job.role || "Role"}`,
    `Master resume: ${edits.masterResume}`,
    `Role family: ${analysis.roleFamily.label} (${analysis.roleFamily.confidence})`,
    `Keyword coverage: ${analysis.keywordCoverage.covered}/${analysis.keywordCoverage.total}`,
    `Resume score: ${analysis.score.total}/100 (${analysis.score.label})`,
    `Top edit count: ${edits.addOrEmphasize.length}`,
    `Manual review required before submission.`
  ].join("\n");
}

function scoreApplicationFit(analysis, job) {
  const keyword = analysis.keywordCoverage.ratio === null ? 12 : analysis.keywordCoverage.ratio * 25;
  const evidence = Math.min(30, analysis.claims.eligible.length * 5);
  const role = analysis.roleFamily.confidence === "high" ? 20 : analysis.roleFamily.confidence === "medium" ? 15 : 10;
  const riskPenalty = analysis.findings.internalContent.length * 25 +
    analysis.missingEvidenceWarnings.filter((item) => item.type === "missing_evidence").length * 2;
  const dreamBonus = DREAM_COMPANIES.some((company) => containsTerm(`${job.company} ${job.description}`, company)) ? 3 : 0;
  const total = Math.max(0, Math.min(100, Math.round(keyword + evidence + role + 20 + dreamBonus - riskPenalty)));
  return {
    total,
    label: total >= 85 ? "strong apply" : total >= 70 ? "worth tailoring" : total >= 55 ? "review carefully" : "weak fit",
    isProbability: false,
    interpretation: "Deterministic application-prep score, not an interview probability."
  };
}

function repeatedImportantPhrases(text) {
  const tokens = canonical(text).split(/\s+/).filter((token) => token.length > 2);
  const counts = new Map();
  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phrase = tokens.slice(index, index + size).join(" ");
      if (STOP_PHRASES.has(phrase) || [...STOP_WORDS].some((word) => phrase === word)) continue;
      if (!/[a-z]/.test(phrase)) continue;
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([phrase, count]) => ({ phrase, count }));
}

const STOP_WORDS = new Set(["and", "the", "with", "for", "you", "our", "are", "will", "that", "this", "from"]);
const STOP_PHRASES = new Set(["and the", "with the", "for the", "you will", "we are"]);

function inferLocation(text) {
  const match = text.match(/\b(Remote|New York|NYC|Seattle|San Francisco|Sunnyvale|Mountain View|Austin|Miami|Gainesville|Boston|Chicago|Atlanta|Washington,?\s*DC)\b/i);
  return match ? match[0] : "";
}

function extractTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? clean(decodeEntities(match[1])) : "";
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"");
}

function isResumeImpactMetric(value) {
  const metric = String(value || "").trim().toLowerCase();
  if (!metric) return false;
  if (/^(19|20)\d{2}$/.test(metric)) return false;
  if (/^\d{3}$/.test(metric)) return false;
  if (/^\d{4}$/.test(metric)) return false;
  if (/^\d\.\d{1,2}$/.test(metric)) return false;
  if (/^\d+$/.test(metric) && Number(metric) < 5) return false;
  return /[%+x/]|(?:\b\d{2,}\b)/i.test(metric);
}

function normalizeInferredRole(value) {
  const role = clean(value, 140)
    .replace(/\s+at\s+[A-Z][A-Za-z0-9&.,' -]{2,80}.*$/i, "")
    .replace(/\s+back to\s+.*$/i, "")
    .trim();
  return role || clean(value, 140);
}

function tailoringFrontMatter(pipeline) {
  return `---\nversion: ${pipeline.version}\ncompany: ${yamlScalar(pipeline.job?.company || "")}\nrole: ${yamlScalar(pipeline.job?.role || "")}\nscore: ${pipeline.score?.total ?? 0}\nats_status: ${yamlScalar(pipeline.atsChecklist?.status || "")}\n---\n`;
}

function markdownLineEdits(adjustments = []) {
  if (!adjustments.length) return "- No exact line edits generated.";
  return adjustments.map((item) => {
    const line = item.line ? `Line ${item.line}` : "Resume note";
    return [
      `### ${line}${item.claimId ? ` — ${item.claimId}` : ""}`,
      item.current ? `Current: ${item.current}` : "",
      item.replacement ? `Replace/add: ${item.replacement}` : `Action: ${item.action}`,
      item.reason ? `Reason: ${item.reason}` : ""
    ].filter(Boolean).join("\n\n");
  }).join("\n\n");
}

function markdownBulletList(items = []) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) return "- None detected.";
  return values.map((item) => `- ${String(item).replace(/\s+/g, " ").trim()}`).join("\n");
}

function yamlScalar(value) {
  return JSON.stringify(String(value || ""));
}

function clean(value, limit = 10000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function canonical(value) {
  return clean(value).toLowerCase();
}

function containsTerm(text, term) {
  const source = canonical(text);
  const target = canonical(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#.])${target}([^a-z0-9+#.]|$)`, "i").test(source);
}

function isPrivateIp(value) {
  const ipVersion = isIP(value);
  if (!ipVersion) return false;
  if (ipVersion === 4) {
    const parts = value.split(".").map(Number);
    return parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 0;
  }
  const lower = value.toLowerCase();
  return lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80:");
}
