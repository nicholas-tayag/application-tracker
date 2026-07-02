#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  buildJobApplicationPipeline,
  fetchJobDescriptionFromUrl,
  renderTailoringBrief
} from "../lib/job-application-pipeline.mjs";

export { renderTailoringBrief as renderBrief };

const DEFAULT_CLAIM_REGISTRY =
  "/Users/nicky/Documents/ResumeMaxxing/RESUME_CLAIM_REGISTRY.csv";

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.urls.length) {
    throw new Error("At least one --url is required.");
  }
  if (!args.resumeFile) {
    throw new Error("Provide --resume-file so line edits can map to the master resume.");
  }

  const resumeText = await readFile(resolve(args.resumeFile), "utf8");
  const claimRegistryCsv = await readOptional(args.claimRegistry || DEFAULT_CLAIM_REGISTRY);
  const outputDir = resolve(args.outDir || "qa/tailoring-briefs");
  await mkdir(outputDir, { recursive: true });

  const outputs = [];
  for (const url of args.urls) {
    const fetched = await fetchJobDescriptionFromUrl(url);
    const pipeline = buildJobApplicationPipeline({
      jobUrl: fetched.finalUrl || url,
      jobDescription: fetched.description,
      extractedFromUrl: true,
      fetchedAt: fetched.fetchedAt,
      roleTitle: normalizeFetchedTitle(fetched.title),
      claimRegistryCsv,
      resumeText,
      masterResume: args.masterResume || "",
      lineLimit: args.lineLimit || 118
    });
    const fileName = `${slugify([
      pipeline.job.company,
      pipeline.job.role,
      new URL(url).hostname
    ].filter(Boolean).join("-")) || `job-${outputs.length + 1}`}.md`;
    const path = join(outputDir, fileName);
    await writeFile(path, renderTailoringBrief(pipeline, {
      resumeFile: resolve(args.resumeFile),
      claimRegistry: args.claimRegistry || DEFAULT_CLAIM_REGISTRY
    }), "utf8");
    outputs.push({ path, pipeline });
  }

  for (const output of outputs) {
    const { pipeline } = output;
    console.log([
      output.path,
      `  ${pipeline.job.company || "Company"} — ${pipeline.job.role || "Role"}`,
      `  score: ${pipeline.score.total}/100 (${pipeline.score.label})`,
      `  ATS: ${pipeline.atsChecklist.status}`,
      `  exact edits: ${pipeline.lineAdjustments.length}`
    ].join("\n"));
  }
}

function parseArgs(argv) {
  const args = {
    urls: [],
    resumeFile: "",
    claimRegistry: "",
    outDir: "",
    masterResume: "",
    lineLimit: 118
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value.`);
      return argv[index];
    };
    if (arg === "--url") args.urls.push(next());
    else if (arg === "--resume-file") args.resumeFile = next();
    else if (arg === "--claim-registry") args.claimRegistry = next();
    else if (arg === "--out-dir") args.outDir = next();
    else if (arg === "--master-resume") args.masterResume = next();
    else if (arg === "--line-limit") args.lineLimit = Number(next()) || 118;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/generate-tailoring-brief.mjs --resume-file <path> --url <job-url> [--url <job-url>] [--out-dir qa/tailoring-briefs]`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function slugify(value) {
  return String(value || basename(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function normalizeFetchedTitle(value) {
  const title = String(value || "").trim();
  const jobApplication = title.match(/job application for (.+?) at .+/i);
  if (jobApplication?.[1]) return jobApplication[1].trim();
  return title
    .replace(/\s*\|\s*.*$/g, "")
    .replace(/\s+-\s+.*$/g, "")
    .trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
