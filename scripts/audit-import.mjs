import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importTrackerCsv, parseCsv } from "../lib/tracker-core.mjs";

const inputPaths = process.argv.slice(2).filter((value) => value !== "--");
if (!inputPaths.length) {
  console.error("Usage: npm run import:audit -- /path/to/tracker.csv [...]");
  process.exitCode = 1;
} else {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const datasets = [
    ["core", "data/selected_roles.csv"],
    ["newgrad", "data/newgrad_best_adds.csv"],
    ["aiml", "data/aiml_best_roles.csv"]
  ];
  const roles = [];
  for (const [source, path] of datasets) {
    const rows = parseCsv(await readFile(join(root, path), "utf8"));
    rows.forEach((row, index) => {
      roles.push({
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

  for (const inputPath of inputPaths) {
    const result = importTrackerCsv(await readFile(inputPath, "utf8"), roles);
    console.log(JSON.stringify({
      file: basename(inputPath),
      matched: result.imported,
      unmatched: result.unmatched,
      skipped: result.skipped,
      unmatchedRows: result.unmatchedRows
    }, null, 2));
  }
}
