import test from "node:test";
import assert from "node:assert/strict";
import {
  importTrackerCsv,
  normalizeTracker,
  parseCsv,
  trackerMetrics
} from "../lib/tracker-core.mjs";

test("normalizes untrusted tracker fields", () => {
  const tracker = normalizeTracker({
    role: {
      status: "Not real",
      date: "06/22/2026",
      responseDate: "2026-06-25",
      notes: "x".repeat(5000)
    }
  });
  assert.equal(tracker.role.status, "Discovered");
  assert.equal(tracker.role.date, "");
  assert.equal(tracker.role.responseDate, "2026-06-25");
  assert.equal(tracker.role.notes.length, 4000);
});

test("calculates conversion, latency, and due work", () => {
  const metrics = trackerMetrics(
    {
      one: {
        status: "OA",
        date: "2026-06-01",
        responseDate: "2026-06-05",
        followUp: "2026-06-22"
      },
      two: {
        status: "Rejected",
        date: "2026-06-02",
        responseDate: "2026-06-08"
      },
      three: { status: "Applied", date: "2026-06-20" }
    },
    new Date("2026-06-22T12:00:00Z")
  );
  assert.equal(metrics.submitted, 3);
  assert.equal(metrics.positives, 1);
  assert.equal(metrics.oaScreenRate, 1 / 3);
  assert.equal(metrics.rejections, 1);
  assert.equal(metrics.pending, 1);
  assert.equal(metrics.medianResponseDays, 5);
  assert.equal(metrics.followUpsDue, 1);
});

test("parses quoted CSV cells and byte-order marks", () => {
  const rows = parseCsv('\uFEFFcompany,notes\nAcme,"one, two"\n');
  assert.deepEqual(rows, [{ company: "Acme", notes: "one, two" }]);
});

test("imports matching applications without inventing roles", () => {
  const roles = [
    {
      id: "acme-swe",
      company: "Acme",
      role: "Software Engineer",
      location: "NY",
      url: "https://example.com/jobs/1"
    }
  ];
  const result = importTrackerCsv(
    [
      "company,role,location,status,application_date,response_date,resume_version",
      "Acme,Software Engineer,NY,oa,2026-06-01,2026-06-05,swe-v1",
      "Other,Engineer,CA,applied,2026-06-02,,swe-v1"
    ].join("\n"),
    roles
  );
  assert.equal(result.imported, 1);
  assert.equal(result.unmatched, 1);
  assert.equal(result.tracker["acme-swe"].status, "OA");
  assert.equal(result.tracker["acme-swe"].resumeVersion, "swe-v1");
});

test("matches tracker rows by job URL and accepts shortlist status aliases", () => {
  const roles = [
    {
      id: "amazon-role",
      company: "Amazon",
      role: "SDE",
      location: "US",
      url: "https://amazon.jobs/jobs/123/"
    }
  ];
  const result = importTrackerCsv(
    "company,role,job_url,status,resume\nAmazon,Different title,https://amazon.jobs/jobs/123,ready,general-v1",
    roles
  );
  assert.equal(result.imported, 1);
  assert.equal(result.tracker["amazon-role"].status, "Saved");
  assert.equal(result.tracker["amazon-role"].resumeVersion, "general-v1");
});

test("matches equivalent direct URLs with optional www hosts", () => {
  const roles = [{
    id: "amazon-role",
    company: "Amazon",
    role: "Software Development Engineer",
    location: "Seattle",
    url: "https://amazon.jobs/en/jobs/3177934/software-development-engineer-2026-us"
  }];
  const result = importTrackerCsv(
    "company,role,job_url,status\nAmazon,Different title,https://www.amazon.jobs/en/jobs/3177934/software-development-engineer-2026-us,applied",
    roles
  );
  assert.equal(result.imported, 1);
  assert.equal(result.unmatched, 0);
  assert.equal(result.tracker["amazon-role"].status, "Applied");
});

test("imports URL-matched rows even when the role title is missing", () => {
  const roles = [{
    id: "stripe-role",
    company: "Stripe",
    role: "Software Engineer",
    location: "Remote",
    url: "https://stripe.com/jobs/listing/software-engineer/123456"
  }];
  const result = importTrackerCsv(
    "company,job_url,status\nStripe,https://stripe.com/jobs/listing/software-engineer/123456,applied",
    roles
  );
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.unmatched, 0);
  assert.equal(result.tracker["stripe-role"].status, "Applied");
});
