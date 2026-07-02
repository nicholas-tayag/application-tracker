import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentMetrics,
  prepareApplication,
  recordOutcome,
  reviewApplication,
  updateCandidateProfile
} from "./lib/application-agent.mjs";
import { ApplicationAgentStore } from "./lib/application-agent-store.mjs";
import { buildAutofillPlan } from "./lib/form-autofill.mjs";
import {
  computeOutcomeAnalytics,
  generateImprovementHypotheses
} from "./lib/outcome-monitor.mjs";
import {
  normalizeProjectStatus,
  summarizeProjectStatus
} from "./lib/project-status.mjs";
import {
  analyzeResumeQuality,
  hashResumeContent,
  parseClaimRegistryCsv,
  shouldAnalyzeResume
} from "./lib/resume-agent.mjs";
import {
  buildJobApplicationPipeline,
  fetchJobDescriptionFromUrl
} from "./lib/job-application-pipeline.mjs";
import { TrackerStore } from "./lib/tracker-store.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4177);
const privateDirectory =
  process.env.APPLICATION_TRACKER_PRIVATE_DIR ||
  join(homedir(), ".application-tracker");
const trackerPath =
  process.env.TRACKER_DATA_PATH || join(privateDirectory, "tracker-state.json");
const trackerStore = new TrackerStore(trackerPath);
const agentPath =
  process.env.APPLICATION_AGENT_DATA_PATH ||
  join(privateDirectory, "application-agent-state.json");
const packageDirectory =
  process.env.APPLICATION_PACKAGE_PATH ||
  join(privateDirectory, "application-packages");
const agentStore = new ApplicationAgentStore(agentPath);
const projectStatusPath =
  process.env.PROJECT_STATUS_PATH || join(privateDirectory, "project-status.json");
const projectStatusTemplatePath = join(root, "data", "project-status.template.json");
const defaultClaimRegistryPath =
  process.env.RESUME_CLAIM_REGISTRY_PATH ||
  "/Users/nicky/Documents/ResumeMaxxing/RESUME_CLAIM_REGISTRY.csv";
const maxBodyBytes = 2 * 1024 * 1024;
const publicFiles = new Set([
  "/index.html",
  "/app.js",
  "/styles.css",
  "/lib/tracker-core.mjs",
  "/data/selected_roles.csv",
  "/data/newgrad_best_adds.csv",
  "/data/aiml_best_roles.csv"
]);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function isPathInsideRoot(candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function decodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

async function handler(req, res) {
  try {
    const url = new URL(req.url || "/", `http://localhost:${currentPort}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      const state = await trackerStore.read();
      sendJson(res, 200, {
        ok: true,
        service: "application-tracker",
        revision: state.revision,
        trackedApplications: Object.keys(state.tracker).length
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/tracker") {
      sendJson(res, 200, await trackerStore.read());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/application-agent") {
      const state = await agentStore.read();
      const outcomeAnalytics = computeOutcomeAnalytics(state.applications, {
        minimumSampleSize: 50
      });
      sendJson(res, 200, {
        ...state,
        metrics: agentMetrics(state),
        outcomeAnalytics,
        improvementHypotheses: generateImprovementHypotheses(outcomeAnalytics, {
          minimumSampleSize: 50
        })
      });
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/application-agent/profile") {
      const body = await readJsonBody(req);
      const current = await agentStore.read();
      const next = updateCandidateProfile(current, body.profile);
      const saved = await agentStore.write(next, current.revision);
      sendJson(res, 200, {
        profile: saved.profile,
        revision: saved.revision
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/project-status") {
      const registry = await readProjectStatus();
      sendJson(res, 200, {
        registry,
        summary: summarizeProjectStatus(registry)
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/resume-agent/analyze") {
      const body = await readJsonBody(req);
      const resumeText = String(body.resumeText || "");
      if (!resumeText.trim()) {
        sendJson(res, 400, { error: "resumeText is required" });
        return;
      }
      const currentHash = hashResumeContent(resumeText);
      if (!shouldAnalyzeResume(currentHash, body.previousHash)) {
        sendJson(res, 200, {
          changed: false,
          resumeHash: currentHash,
          message: "Resume is unchanged; analysis skipped."
        });
        return;
      }
      const registryCsv = body.claimRegistryCsv ||
        await readOptionalFile(defaultClaimRegistryPath);
      const result = analyzeResumeQuality({
        jobDescription: body.jobDescription,
        role: body.role,
        masterResume: body.masterResume,
        claimRegistry: parseClaimRegistryCsv(registryCsv),
        resumeText,
        resumeBullets: body.resumeBullets,
        lineLimit: body.lineLimit
      });
      sendJson(res, 200, { changed: true, ...result });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/job-pipeline/scan") {
      const body = await readJsonBody(req);
      const registryCsv = body.claimRegistryCsv ||
        await readOptionalFile(defaultClaimRegistryPath);
      let fetched = null;
      let jobDescription = String(body.jobDescription || "");
      let jobUrl = String(body.jobUrl || body.role?.url || "");
      if (!jobDescription.trim() && jobUrl.trim()) {
        try {
          fetched = await fetchJobDescriptionFromUrl(jobUrl);
          jobDescription = fetched.description;
          jobUrl = fetched.finalUrl || jobUrl;
        } catch (error) {
          if ([
            "INVALID_JOB_URL",
            "PRIVATE_JOB_URL",
            "JOB_FETCH_FAILED",
            "JOB_UNREADABLE_CONTENT"
          ].includes(error.code)) {
            sendJson(res, 422, {
              error: error.message,
              code: error.code,
              fallback: "Paste the job description text into the scanner if the job board blocks local fetching."
            });
            return;
          }
          throw error;
        }
      }
      if (!jobDescription.trim()) {
        sendJson(res, 400, { error: "jobUrl or jobDescription is required" });
        return;
      }
      const pipeline = buildJobApplicationPipeline({
        jobUrl,
        jobDescription,
        extractedFromUrl: Boolean(fetched),
        fetchedAt: fetched?.fetchedAt,
        company: body.company,
        roleTitle: body.roleTitle,
        location: body.location,
        masterResume: body.masterResume,
        claimRegistryCsv: registryCsv,
        resumeText: body.resumeText || "",
        resumeBullets: body.resumeBullets,
        lineLimit: body.lineLimit
      });
      sendJson(res, 200, pipeline);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/application-agent/review") {
      const body = await readJsonBody(req);
      if (!body?.applicationId) {
        sendJson(res, 400, { error: "applicationId is required" });
        return;
      }
      const current = await agentStore.read();
      let result;
      try {
        result = reviewApplication(current, body.applicationId, body);
      } catch (error) {
        if (error.code === "REVIEW_INCOMPLETE") {
          sendJson(res, 422, { error: error.message });
          return;
        }
        throw error;
      }
      let saved;
      try {
        saved = await agentStore.write(result.state, current.revision);
      } catch (error) {
        if (error.code === "REVISION_CONFLICT") {
          sendJson(res, 409, { error: error.message, ...error.current });
          return;
        }
        throw error;
      }
      sendJson(res, 200, {
        application: saved.applications[body.applicationId],
        metrics: agentMetrics(saved),
        revision: saved.revision
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/application-agent/prepare") {
      const body = await readJsonBody(req);
      if (!body?.role || typeof body.role !== "object") {
        sendJson(res, 400, { error: "role is required" });
        return;
      }
      const current = await agentStore.read();
      let prepared;
      try {
        prepared = prepareApplication(body.role, current, {
          masterResume: body.masterResume
        });
      } catch (error) {
        if (error.code === "DIRECT_URL_REQUIRED") {
          sendJson(res, 422, { error: error.message });
          return;
        }
        throw error;
      }
      const artifact = await writeApplicationPackage(prepared.application);
      prepared.application.artifactPath = artifact.path;
      prepared.application.artifactUrl = artifact.url;
      let saved;
      try {
        saved = await agentStore.write(prepared.state, current.revision);
      } catch (error) {
        if (error.code === "REVISION_CONFLICT") {
          await rm(artifact.path, { force: true });
          sendJson(res, 409, { error: error.message, ...error.current });
          return;
        }
        throw error;
      }
      const outcomeAnalytics = computeOutcomeAnalytics(saved.applications, {
        minimumSampleSize: 50
      });
      sendJson(res, 201, {
        application: saved.applications[prepared.application.id],
        metrics: agentMetrics(saved),
        outcomeAnalytics,
        revision: saved.revision
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/application-agent/outcome") {
      const body = await readJsonBody(req);
      if (!body?.applicationId) {
        sendJson(res, 400, { error: "applicationId is required" });
        return;
      }
      const current = await agentStore.read();
      let result;
      try {
        result = recordOutcome(current, body.applicationId, body);
      } catch (error) {
        if (error.code === "REVIEW_REQUIRED") {
          sendJson(res, 422, { error: error.message });
          return;
        }
        throw error;
      }
      let saved;
      try {
        saved = await agentStore.write(result.state, current.revision);
      } catch (error) {
        if (error.code === "REVISION_CONFLICT") {
          sendJson(res, 409, { error: error.message, ...error.current });
          return;
        }
        throw error;
      }
      const outcomeAnalytics = computeOutcomeAnalytics(saved.applications, {
        minimumSampleSize: 50
      });
      sendJson(res, 200, {
        application: saved.applications[body.applicationId],
        metrics: agentMetrics(saved),
        outcomeAnalytics,
        revision: saved.revision
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/application-agent/autofill-plan") {
      const body = await readJsonBody(req);
      const state = await agentStore.read();
      const application = state.applications[body?.applicationId];
      if (!application) {
        sendJson(res, 404, { error: "application not found" });
        return;
      }
      const resumePath = resumePathFor(application.masterResume);
      sendJson(res, 200, buildAutofillPlan(
        body.fields,
        state.profile,
        { resumePath, application }
      ));
      return;
    }
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/application-agent/package/")
    ) {
      const filename = basename(url.pathname);
      if (!/^[a-z0-9-]+\.md$/.test(filename)) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      const path = join(packageDirectory, filename);
      try {
        const body = await readFile(path, "utf8");
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          "content-length": Buffer.byteLength(body),
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'",
          "x-content-type-options": "nosniff"
        });
        res.end(body);
      } catch (error) {
        if (error.code === "ENOENT") {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        throw error;
      }
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/tracker") {
      const body = await readJsonBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        sendJson(res, 400, { error: "request body must be an object" });
        return;
      }
      try {
        const saved = await trackerStore.write(
          body.tracker,
          body.revision === undefined ? null : body.revision
        );
        sendJson(res, 200, saved);
      } catch (error) {
        if (error.code === "REVISION_CONFLICT") {
          sendJson(res, 409, { error: error.message, ...error.current });
          return;
        }
        throw error;
      }
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    const decodedPath = url.pathname === "/" ? "/index.html" : decodePathname(url.pathname);
    if (!decodedPath) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Bad request");
      return;
    }
    if (!publicFiles.has(decodedPath)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const file = normalize(join(root, decodedPath));
    if (!isPathInsideRoot(file) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    createReadStream(file).pipe(res);
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "internal_error"
      });
    } else {
      res.destroy(error);
    }
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let bytes = 0;
    let settled = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBodyBytes) {
        settled = true;
        const error = new Error("request body is too large");
        error.statusCode = 413;
        reject(error);
        req.resume();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const error = new Error("request body must be valid JSON");
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

async function writeApplicationPackage(application) {
  await mkdir(packageDirectory, { recursive: true });
  const filename = `${slug(application.company)}-${slug(application.role)}-${application.id}.md`;
  const path = join(packageDirectory, filename);
  const resumePath = resumePathFor(application.masterResume);
  const lines = [
    `# ${application.company} — ${application.role}`,
    "",
    `- Stage: ${application.stage}`,
    `- Location: ${application.location || "Unknown"}`,
    `- Direct application: ${application.jobUrl || "Unavailable"}`,
    `- Master resume: ${application.masterResume === "ai" ? "AI Engineer" : "General SWE"}`,
    `- Resume file: ${resumePath}`,
    `- Prepared: ${application.updatedAt}`,
    "",
    "## Review before submission",
    "",
    "Final submission is intentionally manual. Verify every eligibility answer,",
    "uploaded document, location preference, work authorization response, and",
    "voluntary demographic field before submitting.",
    "",
    "## Selection rationale",
    "",
    application.analysis.rationale || "",
    "",
    "## Job keywords",
    "",
    ...(application.analysis.keywords || []).map((item) => `- ${item}`),
    "",
    "## Evidence-backed claims to emphasize",
    "",
    ...(application.analysis.matchedClaims || []).map((item) => `- ${item.text}`),
    "",
    "## Eligibility blockers",
    "",
    ...((application.analysis.blockers || []).length
      ? application.analysis.blockers.map((item) => `- ${item}`)
      : ["- None detected automatically; manual review is still required."]),
    "",
    "## Questions requiring review",
    "",
    ...(application.analysis.unansweredQuestions || []).map((item) => `- ${item}`),
    "",
    "## Integrity note",
    "",
    application.analysis.integrityNote || "",
    "",
    "## Screening feedback limitation",
    "",
    application.analysis.screeningNote || ""
  ];
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return {
    path,
    url: `/api/application-agent/package/${filename}`
  };
}

function resumePathFor(masterResume) {
  return masterResume === "ai"
    ? process.env.RESUME_AI_PATH || ""
    : process.env.RESUME_GENERAL_SWE_PATH || "";
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "application";
}

async function readProjectStatus() {
  const raw = await readOptionalFile(projectStatusPath) ||
    await readOptionalFile(projectStatusTemplatePath) ||
    "{}";
  return normalizeProjectStatus(JSON.parse(raw));
}

async function readOptionalFile(path) {
  if (!path) return "";
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

let currentPort = port;

export async function startServer(startPort = port, maxAttempts = 10) {
  let candidate = startPort;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const server = createServer(handler);
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(candidate, "127.0.0.1", () => resolve(server));
      });
      currentPort = candidate;
      console.log(`Application tracker running at http://localhost:${candidate}`);
      return server;
    } catch (error) {
      if (error?.code === "EADDRINUSE") {
        server.close();
        candidate += 1;
        continue;
      }
      throw error;
    }
  }
  throw new Error(`No available ports found starting at ${startPort}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer(port).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
