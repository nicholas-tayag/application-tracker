import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  importTrackerCsv,
  parseCsv,
  trackerMetrics
} from "../lib/tracker-core.mjs";
import { TrackerStore } from "../lib/tracker-store.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const datasets = [
  ["core", "data/selected_roles.csv"],
  ["newgrad", "data/newgrad_best_adds.csv"],
  ["aiml", "data/aiml_best_roles.csv"]
];

const loadedRoles = [];
for (const [source, path] of datasets) {
  const rows = parseCsv(await readFile(join(root, path), "utf8"));
  rows.forEach((row, index) => {
    loadedRoles.push({
      id: `${source}-${index}`,
      company: row.Company || "",
      role: row.Role || row["Best-fit role(s) pulled"] || "",
      location: row.Location || "",
      url:
        row["Apply URL"] ||
        row["Application/detail link"] ||
        row["Apply / careers URL(s)"] ||
        ""
    });
  });
}

const dedupedRoles = [
  ...new Map(
    loadedRoles.map((role) => [
      [role.company, role.role, role.location].map((value) => value.trim().toLowerCase()).join("|"),
      role
    ])
  ).values()
];

const syntheticTracker = Object.fromEntries(
  Array.from({ length: 10000 }, (_, index) => {
    const status = ["Applied", "OA", "Recruiter Screen", "Interviewing", "Rejected"][index % 5];
    const applicationDay = String((index % 20) + 1).padStart(2, "0");
    const responseDay = String((index % 20) + 5).padStart(2, "0");
    return [
      `application-${index}`,
      {
        status,
        date: `2026-05-${applicationDay}`,
        responseDate: index % 3 ? `2026-05-${responseDay}` : "",
        followUp: index % 7 === 0 ? "2026-06-22" : ""
      }
    ];
  })
);

const analyticsDurations = [];
let analyticsResult;
for (let index = 0; index < 100; index += 1) {
  const start = performance.now();
  analyticsResult = trackerMetrics(syntheticTracker, new Date("2026-06-22T12:00:00Z"));
  analyticsDurations.push(performance.now() - start);
}

const importSample = dedupedRoles.slice(0, 100);
const importCsv = [
  "company,role,location,status,application_date,response_date,resume_version",
  ...importSample.map((role, index) =>
    [
      csvCell(role.company),
      csvCell(role.role),
      csvCell(role.location),
      index % 2 ? "oa" : "applied",
      "2026-06-01",
      index % 2 ? "2026-06-05" : "",
      "benchmark-v1"
    ].join(",")
  ),
  "Unmatched Company,Unknown Role,Remote,applied,2026-06-01,,benchmark-v1"
].join("\n");
const importResult = importTrackerCsv(importCsv, importSample);

const temporaryDirectory = await mkdtemp(join(tmpdir(), "application-tracker-benchmark-"));
let persistence;
try {
  const path = join(temporaryDirectory, "tracker.json");
  const store = new TrackerStore(path);
  const writeStart = performance.now();
  await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      store.write({ [`role-${index}`]: { status: "Saved" } })
    )
  );
  const writeDurationMs = performance.now() - writeStart;
  const payload = JSON.parse(await readFile(path, "utf8"));
  persistence = {
    concurrentWrites: 100,
    completedWrites: payload.revision,
    validJsonAfterWrites: true,
    finalTrackerEntries: Object.keys(payload.tracker).length,
    durationMs: round(writeDurationMs)
  };
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const sortedAnalytics = analyticsDurations.sort((a, b) => a - b);
const results = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`
  },
  catalog: {
    csvRowsLoaded: loadedRoles.length,
    uniqueRolesAfterCompanyTitleLocationDeduplication: dedupedRoles.length,
    duplicatesRemoved: loadedRoles.length - dedupedRoles.length,
    sourceFiles: datasets.map(([, path]) => path)
  },
  csvImport: {
    matchingRows: importSample.length,
    imported: importResult.imported,
    unmatched: importResult.unmatched,
    skipped: importResult.skipped,
    expectedUnmatched: 1
  },
  analytics: {
    records: Object.keys(syntheticTracker).length,
    iterations: analyticsDurations.length,
    medianMs: round(percentile(sortedAnalytics, 0.5)),
    p95Ms: round(percentile(sortedAnalytics, 0.95)),
    submitted: analyticsResult.submitted,
    positives: analyticsResult.positives
  },
  persistence,
  limitations: [
    "Catalog counts describe the repository CSV snapshots, not live or still-open jobs.",
    "Analytics timings use deterministic synthetic tracker records on one local machine.",
    "Concurrent writes validate serialized atomic JSON persistence, not multi-host coordination.",
    "Import correctness covers exact company/title/location matching and does not infer fuzzy matches."
  ]
};

const output = join(root, "benchmarks", "latest-results.json");
await writeFile(output, `${JSON.stringify(results, null, 2)}\n`, "utf8");
console.log(JSON.stringify(results, null, 2));

function percentile(values, quantile) {
  return values[Math.min(values.length - 1, Math.floor(values.length * quantile))];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function csvCell(value) {
  return `"${String(value || "").replaceAll('"', '""')}"`;
}
