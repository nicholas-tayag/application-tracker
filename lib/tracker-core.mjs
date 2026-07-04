const ALLOWED_STATUSES = new Set([
  "Discovered", "Saved", "Applying", "Applied", "OA", "Recruiter Screen",
  "Interviewing", "Rejected", "Offer", "Withdrawn"
]);
const POSITIVE_STATUSES = new Set(["OA", "Recruiter Screen", "Interviewing", "Offer"]);
const SUBMITTED_STATUSES = new Set([
  "Applied", "OA", "Recruiter Screen", "Interviewing",
  "Rejected", "Offer", "Withdrawn"
]);
const TERMINAL_STATUSES = new Set(["Rejected", "Offer", "Withdrawn"]);

export function normalizeTracker(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([id]) => typeof id === "string" && id.length > 0 && id.length <= 240)
      .map(([id, entry]) => [id, normalizeEntry(entry)])
  );
}

export function normalizeEntry(entry) {
  const source = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  return {
    status: ALLOWED_STATUSES.has(source.status) ? source.status : "Discovered",
    date: normalizeDate(source.date),
    responseDate: normalizeDate(source.responseDate),
    deadline: normalizeDate(source.deadline),
    followUp: normalizeDate(source.followUp),
    resumeVersion: cleanText(source.resumeVersion, 160),
    notes: cleanText(source.notes, 4000),
    updatedAt: normalizeTimestamp(source.updatedAt)
  };
}

export function trackerMetrics(tracker, now = new Date()) {
  const entries = Object.values(normalizeTracker(tracker));
  const submitted = entries.filter((entry) => SUBMITTED_STATUSES.has(entry.status));
  const positives = submitted.filter((entry) => POSITIVE_STATUSES.has(entry.status));
  const rejections = submitted.filter((entry) => entry.status === "Rejected");
  const pending = submitted.filter(
    (entry) => !TERMINAL_STATUSES.has(entry.status) && !entry.responseDate
  );
  const responseDays = submitted
    .map((entry) => daysBetween(entry.date, entry.responseDate))
    .filter(Number.isFinite);
  return {
    tracked: entries.length,
    submitted: submitted.length,
    positives: positives.length,
    oaScreenRate: submitted.length ? positives.length / submitted.length : 0,
    rejections: rejections.length,
    rejectionRate: submitted.length ? rejections.length / submitted.length : 0,
    pending: pending.length,
    medianResponseDays: median(responseDays),
    followUpsDue: entries.filter((entry) => isDue(entry.followUp, now)).length,
    deadlinesDue: entries.filter((entry) => isDue(entry.deadline, now)).length
  };
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((item) => item.length)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.map((items) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), items[index] || ""]))
  );
}

export function importTrackerCsv(text, roles, existing = {}) {
  const tracker = { ...normalizeTracker(existing) };
  const roleIndex = new Map();
  roles.forEach((role) => {
    roleIndex.set(roleMatchKey(role.company, role.role, role.location), role.id);
    roleIndex.set(roleMatchKey(role.company, role.role, ""), role.id);
    if (role.url) roleIndex.set(`url|${normalizeUrl(role.url)}`, role.id);
  });
  let imported = 0;
  let unmatched = 0;
  let skipped = 0;
  const unmatchedRows = [];
  for (const row of parseCsv(text)) {
    const company = firstValue(row, ["company", "Company"]);
    const roleName = firstValue(row, ["role", "Role"]);
    const location = firstValue(row, ["location", "Location"]);
    const url = firstValue(row, ["job_url", "url", "URL", "Apply URL"]);
    const canMatchByFields = company && roleName;
    if (!url && !canMatchByFields) {
      skipped += 1;
      continue;
    }
    const id =
      (url && roleIndex.get(`url|${normalizeUrl(url)}`)) ||
      (canMatchByFields && roleIndex.get(roleMatchKey(company, roleName, location))) ||
      (canMatchByFields && roleIndex.get(roleMatchKey(company, roleName, "")));
    if (!id) {
      unmatched += 1;
      unmatchedRows.push({ company, role: roleName, location, url });
      continue;
    }
    tracker[id] = normalizeEntry({
      status: normalizeImportedStatus(firstValue(row, ["status", "Status"])),
      date: firstValue(row, ["application_date", "date", "Date"]),
      responseDate: firstValue(row, ["response_date", "responseDate"]),
      deadline: firstValue(row, ["deadline", "Deadline"]),
      followUp: firstValue(row, ["follow_up", "followUp"]),
      resumeVersion: firstValue(row, ["resume_version", "resumeVersion", "resume"]),
      notes: firstValue(row, ["notes", "Notes"]),
      updatedAt: new Date().toISOString()
    });
    imported += 1;
  }
  return { tracker, imported, unmatched, skipped, unmatchedRows };
}

export function roleMatchKey(company, role, location = "") {
  return [company, role, location]
    .map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

function normalizeImportedStatus(value) {
  const aliases = {
    saved: "Saved", ready: "Saved", applying: "Applying", applied: "Applied",
    submitted: "Applied", oa: "OA", "online assessment": "OA",
    "recruiter screen": "Recruiter Screen", screen: "Recruiter Screen",
    interviewing: "Interviewing", interview: "Interviewing",
    "technical interview": "Interviewing", rejected: "Rejected",
    offer: "Offer", withdrawn: "Withdrawn"
  };
  return aliases[String(value || "").trim().toLowerCase()] || "Discovered";
}

function normalizeUrl(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}${url.search}`;
  } catch {
    return input.replace(/^https?:\/\/(?:www\.)?/i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

function firstValue(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && String(row[name]).trim()) return String(row[name]).trim();
  }
  return "";
}

function cleanText(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(`${text}T00:00:00Z`))
    ? text
    : "";
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function daysBetween(start, end) {
  if (!start || !end) return NaN;
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return NaN;
  return Math.round((endTime - startTime) / 86400000);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isDue(value, now) {
  if (!value) return false;
  const due = Date.parse(`${value}T23:59:59`);
  if (!Number.isFinite(due)) return false;
  return due <= now.getTime() + 3 * 86400000;
}
