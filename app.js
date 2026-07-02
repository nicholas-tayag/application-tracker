import {
  importTrackerCsv,
  normalizeTracker,
  trackerMetrics
} from "./lib/tracker-core.mjs";

const DATASETS = [
  { file: "./data/selected_roles.csv", source: "core", label: "Core 100" },
  { file: "./data/newgrad_best_adds.csv", source: "newgrad", label: "More finds" },
  { file: "./data/aiml_best_roles.csv", source: "aiml", label: "AI/ML" }
];

const DEFAULT_WEIGHTS = {
  pay: 32,
  location: 30,
  fit: 18,
  chance: 10,
  company: 6,
  freshness: 4
};

const RANKING_MODES = {
  balanced: {
    label: "Balanced",
    helper: "Pay + location first",
    weights: DEFAULT_WEIGHTS,
    locationPreference: "flexible"
  },
  floridaPay: {
    label: "FL + Pay",
    helper: "Florida/Southeast",
    weights: { pay: 38, location: 36, fit: 14, chance: 7, company: 3, freshness: 2 },
    locationPreference: "florida"
  },
  remotePay: {
    label: "Remote + Pay",
    helper: "Remote-first scan",
    weights: { pay: 40, location: 34, fit: 14, chance: 7, company: 3, freshness: 2 },
    locationPreference: "remote"
  },
  dream: {
    label: "Dream",
    helper: "Prestige + fit",
    weights: { pay: 24, location: 20, fit: 18, chance: 8, company: 26, freshness: 4 },
    locationPreference: "flexible"
  },
  chance: {
    label: "Best chance",
    helper: "Interview odds",
    weights: { pay: 22, location: 24, fit: 22, chance: 24, company: 4, freshness: 4 },
    locationPreference: "flexible"
  }
};

const STATUS_OPTIONS = [
  "Discovered",
  "Saved",
  "Applying",
  "Applied",
  "OA",
  "Recruiter Screen",
  "Interviewing",
  "Rejected",
  "Offer",
  "Withdrawn"
];
const STATE_NAMES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC"
};
const STATE_OPTIONS = ["Remote", ...Object.values(STATE_NAMES).filter((value, index, items) => items.indexOf(value) === index).sort(), "Multiple", "Unknown"];
const DREAM_COMPANIES = [
  "Datadog",
  "Stripe",
  "Microsoft",
  "Google",
  "Amazon",
  "NVIDIA",
  "OpenAI",
  "Anthropic",
  "Meta",
  "CoreWeave",
  "Fireworks AI",
  "Glean",
  "Slack",
  "Nuro",
  "Capital One",
  "IBM"
];
const savedRankingMode = loadJson("ng_ranking_mode", "balanced");
const SAVED_PIPELINE_RESUME_KEY = "ng_job_pipeline_resume_text";
const state = {
  roles: [],
  selectedId: null,
  source: "all",
  search: "",
  chance: "all",
  status: "all",
  stateFilter: "all",
  minPay: 0,
  minPayCustom: 0,
  locationText: "",
  remoteOnly: false,
  hasPayOnly: false,
  activeTags: new Set(),
  sort: "score",
  filtersOpen: false,
  focusOpen: loadJson("ng_focus_open", false),
  locationPreference: loadJson("ng_location_preference", RANKING_MODES[savedRankingMode]?.locationPreference || "flexible"),
  rankingMode: savedRankingMode,
  weights: loadJson("ng_weights", DEFAULT_WEIGHTS),
  tracker: loadJson("ng_tracker", {}),
  revision: 0,
  persistence: "loading",
  saveChain: Promise.resolve(),
  agent: {
    applications: {},
    metrics: {},
    outcomeAnalytics: {},
    improvementHypotheses: {},
    revision: 0,
    loading: true
  },
  jobPipeline: {
    loading: false,
    result: null,
    error: ""
  },
  projectStatus: {
    registry: { workstreams: [] },
    summary: {},
    loading: true
  }
};

const els = {
  weights: document.querySelector("#weights"),
  roleList: document.querySelector("#roleList"),
  details: document.querySelector("#details"),
  metrics: document.querySelector("#metrics"),
  tagFilters: document.querySelector("#tagFilters"),
  filterPanel: document.querySelector("#filterPanel"),
  filterButton: document.querySelector("#filterButton"),
  closeFilters: document.querySelector("#closeFilters"),
  dreamBell: document.querySelector("#dreamBell"),
  focusSection: document.querySelector("#focusSection"),
  focusSummary: document.querySelector("#focusSummary"),
  toggleFocus: document.querySelector("#toggleFocus"),
  dreamJobs: document.querySelector("#dreamJobs"),
  statusSummary: document.querySelector("#statusSummary"),
  searchInput: document.querySelector("#searchInput"),
  stateFilter: document.querySelector("#stateFilter"),
  minPayFilter: document.querySelector("#minPayFilter"),
  minPayInput: document.querySelector("#minPayInput"),
  locationTextFilter: document.querySelector("#locationTextFilter"),
  remoteOnlyFilter: document.querySelector("#remoteOnlyFilter"),
  hasPayFilter: document.querySelector("#hasPayFilter"),
  chanceFilter: document.querySelector("#chanceFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  sourceFilter: document.querySelector("#sourceFilter"),
  locationPreference: document.querySelector("#locationPreference"),
  resetWeights: document.querySelector("#resetWeights"),
  clearFilters: document.querySelector("#clearFilters"),
  exportButton: document.querySelector("#exportButton"),
  importButton: document.querySelector("#importButton"),
  importInput: document.querySelector("#importInput"),
  persistenceStatus: document.querySelector("#persistenceStatus"),
  agentMetrics: document.querySelector("#agentMetrics"),
  agentQueue: document.querySelector("#agentQueue"),
  prepareNextRoles: document.querySelector("#prepareNextRoles"),
  jobPipelineForm: document.querySelector("#jobPipelineForm"),
  jobPipelineUrl: document.querySelector("#jobPipelineUrl"),
  jobPipelineMaster: document.querySelector("#jobPipelineMaster"),
  jobPipelineDescription: document.querySelector("#jobPipelineDescription"),
  jobPipelineResume: document.querySelector("#jobPipelineResume"),
  pipelineResumeFile: document.querySelector("#pipelineResumeFile"),
  uploadPipelineResume: document.querySelector("#uploadPipelineResume"),
  savePipelineResume: document.querySelector("#savePipelineResume"),
  clearPipelineResume: document.querySelector("#clearPipelineResume"),
  pipelineResumeStatus: document.querySelector("#pipelineResumeStatus"),
  jobPipelineResult: document.querySelector("#jobPipelineResult"),
  projectProgressSummary: document.querySelector("#projectProgressSummary"),
  projectWorkstreams: document.querySelector("#projectWorkstreams")
};

init();

async function init() {
  els.locationPreference.value = state.locationPreference;
  hydrateSavedPipelineResume();
  renderWeights();
  bindEvents();
  const batches = await Promise.all(DATASETS.map(loadDataset));
  state.roles = dedupeRoles(batches.flat()).map(enrichRole);
  await Promise.all([
    loadPersistentTracker(),
    loadApplicationAgent(),
    loadProjectStatus()
  ]);
  renderStateFilter();
  state.selectedId = sortedFilteredRoles()[0]?.id || null;
  render();
}

function bindEvents() {
  els.prepareNextRoles?.addEventListener("click", prepareNextRoles);
  els.jobPipelineForm?.addEventListener("submit", scanJobPipeline);
  els.jobPipelineResult?.addEventListener("click", handleJobPipelineResultClick);
  els.uploadPipelineResume?.addEventListener("click", () => els.pipelineResumeFile?.click());
  els.pipelineResumeFile?.addEventListener("change", loadPipelineResumeFile);
  els.savePipelineResume?.addEventListener("click", savePipelineResumeText);
  els.clearPipelineResume?.addEventListener("click", clearPipelineResumeText);
  els.jobPipelineResume?.addEventListener("input", () => {
    if (els.pipelineResumeStatus) {
      els.pipelineResumeStatus.textContent = "Unsaved local resume changes";
    }
  });
  els.filterButton.addEventListener("click", () => setFiltersOpen(!state.filtersOpen));
  els.closeFilters.addEventListener("click", () => setFiltersOpen(false));
  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderListAndMetrics();
  });
  els.stateFilter.addEventListener("change", (event) => {
    state.stateFilter = event.target.value;
    renderListAndMetrics();
  });
  els.minPayFilter.addEventListener("change", (event) => {
    state.minPay = Number(event.target.value);
    renderListAndMetrics();
  });
  els.minPayInput.addEventListener("input", (event) => {
    state.minPayCustom = Number(event.target.value || 0);
    renderListAndMetrics();
  });
  els.locationTextFilter.addEventListener("input", (event) => {
    state.locationText = event.target.value.trim().toLowerCase();
    renderListAndMetrics();
  });
  els.remoteOnlyFilter.addEventListener("change", (event) => {
    state.remoteOnly = event.target.checked;
    renderListAndMetrics();
  });
  els.hasPayFilter.addEventListener("change", (event) => {
    state.hasPayOnly = event.target.checked;
    renderListAndMetrics();
  });
  els.chanceFilter.addEventListener("change", (event) => {
    state.chance = event.target.value;
    renderListAndMetrics();
  });
  els.statusFilter.addEventListener("change", (event) => {
    state.status = event.target.value;
    renderListAndMetrics();
  });
  els.sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderListAndMetrics();
  });
  els.locationPreference.addEventListener("change", (event) => {
    state.locationPreference = event.target.value;
    saveJson("ng_location_preference", state.locationPreference);
    renderListAndMetrics(true);
  });
  els.resetWeights.addEventListener("click", () => {
    state.rankingMode = "balanced";
    state.weights = { ...DEFAULT_WEIGHTS };
    state.locationPreference = "flexible";
    els.locationPreference.value = "flexible";
    saveJson("ng_ranking_mode", state.rankingMode);
    saveJson("ng_weights", state.weights);
    saveJson("ng_location_preference", state.locationPreference);
    renderWeights();
    renderListAndMetrics(true);
  });
  els.clearFilters.addEventListener("click", () => {
    state.search = "";
    state.chance = "all";
    state.status = "all";
    state.stateFilter = "all";
    state.minPay = 0;
    state.minPayCustom = 0;
    state.locationText = "";
    state.remoteOnly = false;
    state.hasPayOnly = false;
    state.activeTags.clear();
    els.searchInput.value = "";
    els.chanceFilter.value = "all";
    els.statusFilter.value = "all";
    els.stateFilter.value = "all";
    els.minPayFilter.value = "0";
    els.minPayInput.value = "";
    els.locationTextFilter.value = "";
    els.remoteOnlyFilter.checked = false;
    els.hasPayFilter.checked = false;
    renderListAndMetrics();
  });
  els.toggleFocus.addEventListener("click", () => {
    state.focusOpen = !state.focusOpen;
    saveJson("ng_focus_open", state.focusOpen);
    renderDreamJobs();
  });
  els.exportButton.addEventListener("click", exportTracker);
  els.importButton.addEventListener("click", () => els.importInput.click());
  els.importInput.addEventListener("change", importTrackerFile);
  els.sourceFilter.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-source]");
    if (!button) return;
    state.source = button.dataset.source;
    els.sourceFilter.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    renderListAndMetrics();
  });
}

async function loadDataset(dataset) {
  const response = await fetch(dataset.file);
  const text = await response.text();
  return parseCsv(text).map((row) => normalizeRole(row, dataset));
}

function normalizeRole(row, dataset) {
  const company = row.Company || "";
  const role = row.Role || row["Best-fit role(s) pulled"] || "";
  const location = row.Location || "";
  const chance = row["Chance level"] || chanceFromTier(row.Tier || "");
  const fitTrack = row["Fit track"] || row["AI/ML fit track"] || row["Primary fit track"] || "";
  const url = row["Apply URL"] || row["Application/detail link"] || row["Apply / careers URL(s)"] || "";
  const fitScore = Number(row["Fit score"] || 0);
  const salary = row.Salary || "";
  const why = row["Why you fit"] || row["Why it fits your resume"] || "";
  const qualifications = row["Qualifications excerpt"] || "";
  const posted = row["Posted/Age"] || row["Posted date"] || "";
  const sourceLabel = dataset.label;

  return {
    id: slug(`${dataset.source}-${company}-${role}-${location}-${url}`),
    source: dataset.source,
    sourceLabel,
    company,
    role,
    location,
    chance,
    fitTrack,
    url: firstUrl(url),
    salary,
    posted,
    why,
    qualifications,
    description: [why, qualifications].filter(Boolean).join("\n"),
    fitScore,
    raw: row
  };
}

function enrichRole(role) {
  const tracker = state.tracker[role.id] || {};
  const pay = parsePay(role.salary);
  const payScore = scorePay(pay);
  const locationScore = scoreLocation(role.location);
  const fitScore = scoreFit(role);
  const chanceScore = { Higher: 100, Medium: 67, Lower: 38, Unknown: 50 }[role.chance] || 50;
  const companyScore = scoreCompany(role.company);
  const freshnessScore = scoreFreshness(role.posted);
  const total = weightedScore({ payScore, locationScore, fitScore, chanceScore, companyScore, freshnessScore });

  return {
    ...role,
    tracker,
    pay,
    stateCodes: getStateCodes(role.location),
    locationLabel: formatLocation(role.location),
    scores: { payScore, locationScore, fitScore, chanceScore, companyScore, freshnessScore, total }
  };
}

function weightedScore(parts) {
  const totalWeight = Object.values(state.weights).reduce((sum, value) => sum + Number(value), 0) || 1;
  const weighted =
    parts.payScore * state.weights.pay +
    parts.locationScore * state.weights.location +
    parts.fitScore * state.weights.fit +
    parts.chanceScore * state.weights.chance +
    parts.companyScore * state.weights.company +
    parts.freshnessScore * state.weights.freshness;
  return Math.round(weighted / totalWeight);
}

function render() {
  renderWeights();
  renderListAndMetrics(true);
}

function renderListAndMetrics(recalculate = false) {
  if (recalculate) state.roles = state.roles.map(enrichRole);
  renderFilterShell();
  renderMetrics();
  renderTagFilters();
  renderDreamJobs();
  renderStatusSummary();
  renderJobPipeline();
  renderAgentOverview();
  renderProjectStatus();
  renderList();
  renderDetails();
}

function setFiltersOpen(open) {
  state.filtersOpen = open;
  renderFilterShell();
}

function renderFilterShell() {
  const activeCount = activeFilterCount();
  els.filterPanel.classList.toggle("open", state.filtersOpen);
  els.filterButton.classList.toggle("active", state.filtersOpen || activeCount > 0);
  els.filterButton.textContent = activeCount ? `Filters (${activeCount})` : "Filters";
}

function renderWeights() {
  els.weights.innerHTML = Object.entries(RANKING_MODES).map(([key, mode]) => `
    <button class="mode-button ${state.rankingMode === key ? "active" : ""}" data-mode="${key}">
      <strong>${mode.label}</strong>
      <span>${mode.helper}</span>
    </button>
  `).join("");
  els.weights.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = RANKING_MODES[button.dataset.mode];
      state.rankingMode = button.dataset.mode;
      state.weights = { ...mode.weights };
      state.locationPreference = mode.locationPreference;
      els.locationPreference.value = mode.locationPreference;
      saveJson("ng_ranking_mode", state.rankingMode);
      saveJson("ng_weights", state.weights);
      saveJson("ng_location_preference", state.locationPreference);
      renderWeights();
      renderListAndMetrics(true);
    });
  });
}

function renderStateFilter() {
  const roleStates = [...new Set(state.roles.flatMap((role) => role.stateCodes))]
    .filter(Boolean)
    .sort((a, b) => {
      if (a === "Remote") return -1;
      if (b === "Remote") return 1;
      if (a === "Multiple") return 1;
      if (b === "Multiple") return -1;
      if (a === "Unknown") return 1;
      if (b === "Unknown") return -1;
      return a.localeCompare(b);
    });
  els.stateFilter.innerHTML = [
    `<option value="all">Any</option>`,
    ...roleStates.map((item) => `<option value="${escapeAttribute(item)}">${escapeHtml(item)}</option>`)
  ].join("");
}

function renderTagFilters() {
  const tags = roleTagCounts(state.roles);
  if (!tags.length) {
    els.tagFilters.innerHTML = `<span class="empty-tags">No tags loaded yet.</span>`;
    return;
  }
  els.tagFilters.innerHTML = tags.map((tag) => `
    <button class="tag-chip ${state.activeTags.has(tag.key) ? "active" : ""}" data-tag="${escapeAttribute(tag.key)}" type="button">
      <span>${escapeHtml(tag.label)}</span>
      <strong>${tag.count}</strong>
    </button>
  `).join("");
  els.tagFilters.querySelectorAll(".tag-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.tag;
      if (state.activeTags.has(key)) state.activeTags.delete(key);
      else state.activeTags.add(key);
      renderListAndMetrics();
    });
  });
}

function renderMetrics() {
  const roles = filteredRoles();
  const funnel = trackerMetrics(state.tracker);
  const top = sortedFilteredRoles()[0];
  els.metrics.innerHTML = [
    ["Visible roles", roles.length],
    ["Submitted", funnel.submitted],
    ["OA / screens", `${funnel.positives} (${percent(funnel.oaScreenRate)})`],
    ["Median response", funnel.medianResponseDays === null ? "n/a" : `${funnel.medianResponseDays}d`],
    ["Follow-ups due", funnel.followUpsDue],
    ["Top score", top ? `${top.scores.total}/100` : "n/a"]
  ].map(([label, value]) => `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function renderAgentOverview() {
  if (!els.agentMetrics || !els.agentQueue) return;
  const metrics = state.agent.metrics || {};
  const outcome = state.agent.outcomeAnalytics?.overall || {};
  const submitted = Number(outcome.submitted || 0);
  els.agentMetrics.innerHTML = [
    ["Ready for review", metrics.readyForReview || 0],
    ["Approved", metrics.approvedForManualSubmit || 0],
    ["Submitted", submitted || metrics.submitted || 0],
    ["OA / assessment", submitted
      ? `${formatRate(outcome.oa?.percent)} · ${formatLift(outcome.oa?.percentagePointLift)}`
      : "Baseline 6.33%"],
    ["Interview", submitted
      ? `${formatRate(outcome.interview?.percent)} · ${formatLift(outcome.interview?.percentagePointLift)}`
      : "Baseline 1.27%"],
    ["Stale", metrics.stale || 0]
  ].map(([label, value]) => `
    <div class="agent-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");

  const applications = Object.values(state.agent.applications || {})
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))
    .slice(0, 5);
  els.agentQueue.innerHTML = applications.length
    ? applications.map((application) => `
      <button class="agent-queue-item" type="button" data-role-id="${escapeAttribute(application.roleId)}">
        <span>${escapeHtml(application.company)}</span>
        <strong>${escapeHtml(application.role)}</strong>
        <small>${escapeHtml(application.stage.replaceAll("_", " "))} · ${application.masterResume.toUpperCase()}</small>
      </button>
    `).join("")
    : `<div class="agent-queue-empty">No prepared applications yet. Select a direct-link role to build one.</div>`;
  els.agentQueue.querySelectorAll(".agent-queue-item").forEach((button) => {
    button.addEventListener("click", () => {
      const role = state.roles.find((item) => item.id === button.dataset.roleId);
      if (!role) return;
      state.selectedId = role.id;
      renderList();
      renderDetails();
    });
  });
}

function renderProjectStatus() {
  if (!els.projectProgressSummary || !els.projectWorkstreams) return;
  const summary = state.projectStatus.summary || {};
  const workstreams = state.projectStatus.registry?.workstreams || [];
  els.projectProgressSummary.innerHTML = `
    <div>
      <span>Overall progress</span>
      <strong>${Number(summary.overallProgress || 0).toFixed(0)}%</strong>
    </div>
    <div>
      <span>Running</span>
      <strong>${summary.counts?.running || 0}</strong>
    </div>
    <div>
      <span>Blocked</span>
      <strong>${summary.counts?.blocked || 0}</strong>
    </div>
  `;
  els.projectWorkstreams.innerHTML = workstreams.map((workstream) => {
    const tasks = workstream.tasks || [];
    const progress = tasks.length
      ? tasks.reduce((sum, task) => sum + Number(task.progress || 0), 0) / tasks.length
      : 0;
    const active = tasks.find((task) => task.status === "running") ||
      tasks.find((task) => task.status === "blocked") ||
      tasks[0];
    return `
      <article class="project-workstream">
        <div class="project-workstream-heading">
          <strong>${escapeHtml(workstream.name)}</strong>
          <span>${Math.round(progress)}%</span>
        </div>
        <div class="project-progress-track"><span style="width:${Math.max(0, Math.min(100, progress))}%"></span></div>
        <small>${escapeHtml(active?.currentStep || active?.verificationSummary || "No active step")}</small>
      </article>
    `;
  }).join("") || `<div class="agent-queue-empty">No project checkpoints recorded.</div>`;
}

async function loadProjectStatus() {
  try {
    const response = await fetch("/api/project-status", { cache: "no-store" });
    if (!response.ok) throw new Error(`project status returned ${response.status}`);
    state.projectStatus = {
      ...(await response.json()),
      loading: false
    };
  } catch {
    state.projectStatus.loading = false;
  }
  renderProjectStatus();
}

function renderStatusSummary() {
  els.statusSummary.innerHTML = STATUS_OPTIONS.map((status) => {
    const count = state.roles.filter((role) => getStatus(role) === status).length;
    return `<div class="status-item"><span>${status}</span><strong>${count}</strong></div>`;
  }).join("");
}

function renderList() {
  const roles = sortedFilteredRoles();
  if (!roles.some((role) => role.id === state.selectedId)) state.selectedId = roles[0]?.id || null;
  els.roleList.innerHTML = roles.slice(0, 240).map((role) => roleCard(role)).join("");
  els.roleList.querySelectorAll(".role-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedId = card.dataset.id;
      renderList();
      renderDetails();
    });
  });
  els.roleList.querySelectorAll(".quick-apply").forEach((link) => {
    link.addEventListener("click", (event) => event.stopPropagation());
  });
}

function renderDreamJobs() {
  const allDreams = [...state.roles]
    .filter(isDreamRole)
    .sort((a, b) => {
      const companyDelta = dreamRank(a.company) - dreamRank(b.company);
      if (companyDelta !== 0) return companyDelta;
      return b.scores.total - a.scores.total;
    });
  const dreams = allDreams
    .filter(isDreamRole)
    .slice(0, state.focusOpen ? 10 : 0);

  els.focusSection.classList.toggle("collapsed", !state.focusOpen);
  els.toggleFocus.textContent = state.focusOpen ? "Hide" : "Show";
  els.focusSummary.textContent = `${allDreams.length} dream roles. Use the Dream tab for the full list.`;
  renderDreamBell(allDreams.length);

  if (!allDreams.length) {
    els.dreamJobs.innerHTML = `<div class="empty-dream">No dream roles are loaded yet.</div>`;
    return;
  }

  if (!state.focusOpen) {
    els.dreamJobs.innerHTML = "";
    return;
  }

  els.dreamJobs.innerHTML = dreams.map((role) => `
    <article class="dream-card ${role.id === state.selectedId ? "selected" : ""}" data-id="${role.id}" tabindex="0" role="button" aria-label="Select ${escapeAttribute(role.company)} ${escapeAttribute(role.role)}">
      <span class="dream-company">${escapeHtml(role.company)}</span>
      <strong>${escapeHtml(role.role)}</strong>
      <span>${escapeHtml(role.locationLabel || "Location unknown")}</span>
      <span class="dream-footer">
        <span class="pill chance-${role.chance}">${escapeHtml(role.chance)}</span>
        <span>${role.scores.total}/100</span>
      </span>
      ${role.url ? `<a class="mini-link" href="${escapeAttribute(role.url)}" target="_blank" rel="noreferrer">Apply</a>` : ""}
    </article>
  `).join("");

  els.dreamJobs.querySelectorAll(".dream-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedId = card.dataset.id;
      renderDreamJobs();
      renderList();
      renderDetails();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      card.click();
    });
  });
  els.dreamJobs.querySelectorAll(".mini-link").forEach((link) => {
    link.addEventListener("click", (event) => event.stopPropagation());
  });
}

function renderDreamBell(dreamCount) {
  const automationUpdates = Number(loadJson("ng_dream_update_count", 0)) || 0;
  const count = automationUpdates || dreamCount;
  els.dreamBell.textContent = count > 99 ? "99+" : String(count);
  els.dreamBell.classList.toggle("hot", count > 0);
  els.dreamBell.title = automationUpdates
    ? `${automationUpdates} dream-company updates from automation`
    : `${dreamCount} dream-company roles loaded`;
}

function roleCard(role) {
  const selected = role.id === state.selectedId ? "selected" : "";
  const status = getStatus(role);
  const payText = role.pay.label || "Pay unknown";
  const dream = isDreamRole(role);
  const age = jobAgeLabel(role);
  const due = deadlineLabel(role);
  return `
    <article class="role-card ${selected}" data-id="${role.id}">
      <div class="score-badge">
        <strong>${role.scores.total}</strong>
      </div>
      <div class="role-main">
        <div class="role-line">
          <span class="company">${escapeHtml(role.company)}</span>
          <h3 class="role-title">${escapeHtml(role.role)}</h3>
          ${dream ? `<span class="dream-dot">Dream</span>` : ""}
        </div>
        <div class="meta-line">
          <span class="pill">${escapeHtml(role.locationLabel || "Location unknown")}</span>
          <span class="pill">${escapeHtml(payText)}</span>
          <span class="pill chance-${role.chance}">${escapeHtml(role.chance || "Unknown")}</span>
          <span class="pill">${escapeHtml(status)}</span>
          ${age ? `<span class="pill age-pill">${escapeHtml(age)}</span>` : ""}
          ${due ? `<span class="pill due-pill">${escapeHtml(due)}</span>` : ""}
          <span class="pill muted-pill">${escapeHtml(role.fitTrack || "General SWE")}</span>
          ${role.posted ? `<span class="pill muted-pill">${escapeHtml(role.posted)}</span>` : ""}
          <span class="pill muted-pill">${escapeHtml(role.sourceLabel)}</span>
          ${role.url ? `<a class="quick-apply" href="${escapeAttribute(role.url)}" target="_blank" rel="noreferrer">Apply</a>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderDetails() {
  const role = state.roles.find((item) => item.id === state.selectedId);
  if (!role) {
    els.details.innerHTML = `
      <div class="empty-state">
        <h3>Select a role</h3>
        <p>Score breakdown, application link, notes, and tailoring prompts will show here.</p>
      </div>
    `;
    return;
  }

  const tracker = state.tracker[role.id] || {};
  const agentApplication = findAgentApplication(role);
  const age = jobAgeLabel(role) || "Age unknown";
  const due = deadlineLabel(role) || "No deadline set";
  els.details.innerHTML = `
    <div class="detail-hero">
      <div class="detail-kicker">
        <span>${escapeHtml(role.company)}</span>
        <span>${escapeHtml(role.sourceLabel)}</span>
        ${isDreamRole(role) ? `<span class="dream-dot">Dream</span>` : ""}
      </div>
      <h3>${escapeHtml(role.role)}</h3>
      <div class="detail-stats">
        <div><span>Score</span><strong>${role.scores.total}</strong></div>
        <div><span>Pay</span><strong>${escapeHtml(role.pay.label || "Unknown")}</strong></div>
        <div><span>Age</span><strong>${escapeHtml(age)}</strong></div>
        <div><span>Due</span><strong>${escapeHtml(due)}</strong></div>
      </div>
      ${role.url ? `<a class="link-button" href="${escapeAttribute(role.url)}" target="_blank" rel="noreferrer">Open application</a>` : ""}
      ${isAggregatorUrl(role.url) ? `<p class="link-warning">Aggregator link. Wait for a verified direct employer link before applying.</p>` : ""}
    </div>

    <section class="detail-section compact-detail">
      <h4>Role Tags</h4>
      <div class="detail-tags">
        ${getRoleTags(role).slice(0, 12).map((tag) => `<span class="pill">${escapeHtml(tag.label)}</span>`).join("")}
      </div>
    </section>

    <section class="detail-section">
      <h4>Score Breakdown</h4>
      <div class="breakdown">
        ${breakdownRow("Pay", role.scores.payScore)}
        ${breakdownRow("Location", role.scores.locationScore)}
        ${breakdownRow("Fit", role.scores.fitScore)}
        ${breakdownRow("Chance", role.scores.chanceScore)}
        ${breakdownRow("Company", role.scores.companyScore)}
        ${breakdownRow("Freshness", role.scores.freshnessScore)}
      </div>
    </section>

    <section class="detail-section">
      <h4>Application Agent</h4>
      <div class="agent-card">
        ${renderAgentApplication(role, agentApplication)}
      </div>
    </section>

    <section class="detail-section">
      <h4>Track This Application</h4>
      <div class="status-form">
        <select id="detailStatus">
          ${STATUS_OPTIONS.map((status) => `<option value="${status}" ${getStatus(role) === status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
        <input id="detailDate" type="date" value="${escapeAttribute(tracker.date || "")}" />
        <input id="detailResponseDate" type="date" value="${escapeAttribute(tracker.responseDate || "")}" aria-label="First response date" />
        <input id="detailDeadline" type="date" value="${escapeAttribute(tracker.deadline || "")}" aria-label="Application deadline" />
        <input id="detailFollowUp" type="date" value="${escapeAttribute(tracker.followUp || "")}" aria-label="Follow-up date" />
        <input id="detailResume" type="text" value="${escapeAttribute(tracker.resumeVersion || "")}" placeholder="Resume version used" />
        <textarea id="detailNotes" placeholder="Notes, recruiter, referral, follow-up date...">${escapeHtml(tracker.notes || "")}</textarea>
      </div>
    </section>

    <section class="detail-section">
      <h4>Tailor Around</h4>
      <ul class="tailor-list">
        ${tailoringBullets(role).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;

  document.querySelector("#detailStatus").addEventListener("change", () => saveDetail(role.id, true));
  document.querySelector("#detailDate").addEventListener("change", () => saveDetail(role.id, true));
  document.querySelector("#detailResponseDate").addEventListener("change", () => saveDetail(role.id, true));
  document.querySelector("#detailDeadline").addEventListener("change", () => saveDetail(role.id, true));
  document.querySelector("#detailFollowUp").addEventListener("change", () => saveDetail(role.id, true));
  document.querySelector("#detailResume").addEventListener("blur", () => saveDetail(role.id, true));
  document.querySelector("#detailNotes").addEventListener("blur", () => saveDetail(role.id, true));
  document.querySelector("#prepareApplication")?.addEventListener("click", () =>
    prepareApplicationPackage(role)
  );
  document.querySelector("#agentOutcome")?.addEventListener("change", (event) =>
    recordAgentOutcome(agentApplication?.id, event.target.value)
  );
  document.querySelector("#approveApplication")?.addEventListener("click", () =>
    reviewAgentApplication(agentApplication)
  );
}

function renderAgentApplication(role, application) {
  if (state.agent.loading) return `<p>Loading application agent…</p>`;
  if (!application) {
    const disabled = !role.url || isAggregatorUrl(role.url);
    return `
      <p>Build a review package from the best master resume, job keywords, and verified claims.</p>
      <button id="prepareApplication" class="primary-button" type="button" ${disabled ? "disabled" : ""}>
        Prepare application
      </button>
      ${disabled ? `<small>A verified direct employer/ATS link is required.</small>` : ""}
    `;
  }
  const claims = application.analysis?.matchedClaims || [];
  const blockers = application.analysis?.blockers || [];
  const review = application.review || {};
  const approved = application.stage === "approved_for_manual_submit";
  return `
    <div class="agent-status-row">
      <span class="pill">${escapeHtml(application.stage.replaceAll("_", " "))}</span>
      <strong>${application.masterResume === "ai" ? "AI Engineer" : "General SWE"} master</strong>
    </div>
    <p>${escapeHtml(application.analysis?.rationale || "")}</p>
    <div class="agent-columns">
      <div>
        <span>Claims to emphasize</span>
        <ul>${claims.slice(0, 4).map((item) => `<li>${escapeHtml(item.text)}</li>`).join("") || "<li>Review manually</li>"}</ul>
      </div>
      <div>
        <span>Eligibility flags</span>
        <ul>${blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No automatic blockers detected</li>"}</ul>
      </div>
    </div>
    <label class="field">
      <span>Record outcome</span>
      <select id="agentOutcome">
        ${["ready_for_review", "approved_for_manual_submit", "submitted", "assessment", "screen", "interview", "offer", "rejected", "withdrawn", "failed"]
          .map((stage) => agentStageOption(stage, application))
          .join("")}
      </select>
    </label>
    <div class="review-checklist">
      ${reviewCheck("resumeReviewed", "Resume selected and file verified", review.resumeReviewed)}
      ${reviewCheck("claimsReviewed", "Claims are truthful and supported", review.claimsReviewed)}
      ${reviewCheck("eligibilityReviewed", "Eligibility and sponsorship answers reviewed", review.eligibilityReviewed)}
      ${reviewCheck("locationReviewed", "Location and onsite expectations reviewed", review.locationReviewed)}
      <button id="approveApplication" class="${approved ? "ghost-button" : "primary-button"}" type="button">
        ${approved ? "Reopen review" : "Approve for manual submit"}
      </button>
    </div>
    ${application.artifactUrl
      ? `<a class="agent-package-link" href="${escapeAttribute(application.artifactUrl)}" target="_blank">Open local review package</a>`
      : application.artifactPath
        ? `<small>Local review package: ${escapeHtml(application.artifactPath)}</small>`
        : ""}
    <p class="agent-review-note">Final submission always requires your review.</p>
  `;
}

function reviewCheck(id, label, checked) {
  return `<label class="review-check"><input id="${id}" type="checkbox" ${checked ? "checked" : ""} /> <span>${escapeHtml(label)}</span></label>`;
}

function agentStageOption(stage, application) {
  const requiresApproval = ["submitted", "assessment", "screen", "interview", "offer"].includes(stage);
  const blocked = requiresApproval &&
    ["draft", "ready_for_review"].includes(application.stage);
  return `<option value="${stage}" ${application.stage === stage ? "selected" : ""} ${blocked ? "disabled" : ""}>${stage.replaceAll("_", " ")}</option>`;
}

function findAgentApplication(role) {
  return Object.values(state.agent.applications || {}).find((application) =>
    application.roleId === role.id ||
    (application.company === role.company && application.role === role.role)
  );
}

async function loadApplicationAgent() {
  try {
    const response = await fetch("/api/application-agent", { cache: "no-store" });
    if (!response.ok) throw new Error(`application agent returned ${response.status}`);
    const payload = await response.json();
    state.agent = {
      applications: payload.applications || {},
      metrics: payload.metrics || {},
      outcomeAnalytics: payload.outcomeAnalytics || {},
      improvementHypotheses: payload.improvementHypotheses || {},
      revision: Number(payload.revision || 0),
      loading: false
    };
    renderAgentOverview();
  } catch {
    state.agent.loading = false;
  }
}

async function prepareApplicationPackage(role) {
  const button = document.querySelector("#prepareApplication");
  if (button) {
    button.disabled = true;
    button.textContent = "Preparing…";
  }
  try {
    const response = await fetch("/api/application-agent/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: {
          id: role.id,
          company: role.company,
          role: role.role,
          location: role.location,
          url: role.url,
          sourceUrl: role.url,
          fitTrack: role.fitTrack,
          why: role.why,
          qualifications: role.qualifications,
          description: role.description
        }
      })
    });
    if (!response.ok) throw new Error(`prepare returned ${response.status}`);
    const payload = await response.json();
    state.agent.applications[payload.application.id] = payload.application;
    state.agent.metrics = payload.metrics;
    state.agent.outcomeAnalytics = payload.outcomeAnalytics || state.agent.outcomeAnalytics;
    renderAgentOverview();
    renderDetails();
  } catch {
    if (button) {
      button.disabled = false;
      button.textContent = "Prepare application";
    }
  }
}

async function prepareNextRoles() {
  const button = els.prepareNextRoles;
  const preparedRoleIds = new Set(
    Object.values(state.agent.applications || {}).map((application) => application.roleId)
  );
  const candidates = sortedFilteredRoles()
    .filter((role) => role.url && !isAggregatorUrl(role.url) && !preparedRoleIds.has(role.id))
    .slice(0, 3);
  if (!candidates.length || !button) return;
  button.disabled = true;
  button.textContent = "Preparing…";
  for (const role of candidates) await prepareApplicationPackage(role);
  button.disabled = false;
  button.textContent = "Prepare next 3";
}

async function scanJobPipeline(event) {
  event?.preventDefault();
  if (!els.jobPipelineResult) return;
  const jobUrl = els.jobPipelineUrl?.value.trim() || "";
  const jobDescription = els.jobPipelineDescription?.value.trim() || "";
  if (!jobUrl && !jobDescription) {
    state.jobPipeline = {
      loading: false,
      result: null,
      error: "Paste a job link or job description first."
    };
    renderJobPipeline();
    return;
  }
  state.jobPipeline = { loading: true, result: null, error: "" };
  renderJobPipeline();
  try {
    const response = await fetch("/api/job-pipeline/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobUrl,
        jobDescription,
        masterResume: els.jobPipelineMaster?.value || "",
        resumeText: els.jobPipelineResume?.value || ""
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.fallback || payload.error || `Scan failed with ${response.status}`);
    }
    state.jobPipeline = { loading: false, result: payload, error: "" };
  } catch (error) {
    state.jobPipeline = {
      loading: false,
      result: null,
      error: error.message || "Could not scan this job."
    };
  }
  renderJobPipeline();
}

function hydrateSavedPipelineResume() {
  const saved = localStorage.getItem(SAVED_PIPELINE_RESUME_KEY) || "";
  if (saved && els.jobPipelineResume) {
    els.jobPipelineResume.value = saved;
    if (els.pipelineResumeStatus) {
      els.pipelineResumeStatus.textContent = "Loaded saved resume text locally";
    }
  }
}

function savePipelineResumeText() {
  const value = els.jobPipelineResume?.value || "";
  if (!value.trim()) {
    if (els.pipelineResumeStatus) {
      els.pipelineResumeStatus.textContent = "Paste resume text before saving";
    }
    return;
  }
  localStorage.setItem(SAVED_PIPELINE_RESUME_KEY, value);
  if (els.pipelineResumeStatus) {
    els.pipelineResumeStatus.textContent = `Saved locally · ${value.trim().split(/\s+/).length} words`;
  }
}

function clearPipelineResumeText() {
  localStorage.removeItem(SAVED_PIPELINE_RESUME_KEY);
  if (els.jobPipelineResume) els.jobPipelineResume.value = "";
  if (els.pipelineResumeStatus) {
    els.pipelineResumeStatus.textContent = "Saved resume cleared from this browser";
  }
}

async function loadPipelineResumeFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 512 * 1024) {
    if (els.pipelineResumeStatus) {
      els.pipelineResumeStatus.textContent = "Resume file is too large for local scan";
    }
    return;
  }
  try {
    const text = await file.text();
    if (els.jobPipelineResume) els.jobPipelineResume.value = text;
    localStorage.setItem(SAVED_PIPELINE_RESUME_KEY, text);
    if (els.pipelineResumeStatus) {
      els.pipelineResumeStatus.textContent = `Loaded ${file.name} locally · saved for next scan`;
    }
  } catch {
    if (els.pipelineResumeStatus) {
      els.pipelineResumeStatus.textContent = "Could not read that resume file";
    }
  } finally {
    event.target.value = "";
  }
}

function renderJobPipeline() {
  if (!els.jobPipelineResult) return;
  if (state.jobPipeline.loading) {
    els.jobPipelineResult.innerHTML = `
      <div class="pipeline-loading">Scanning job description and building handbook checklist…</div>
    `;
    return;
  }
  if (state.jobPipeline.error) {
    els.jobPipelineResult.innerHTML = `
      <div class="pipeline-error">
        <strong>Scan needs a fallback</strong>
        <p>${escapeHtml(state.jobPipeline.error)}</p>
      </div>
    `;
    return;
  }
  const result = state.jobPipeline.result;
  if (!result) {
    els.jobPipelineResult.innerHTML = `
      <div class="agent-queue-empty">No scan yet. Start with a direct employer or ATS job link.</div>
    `;
    return;
  }
  const checklist = result.handbookChecklist || {};
  const edits = result.resumeEdits || {};
  const resumeAgent = result.resumeAgent || {};
  const score = result.score || {};
  const ats = result.atsChecklist || {};
  const topChanges = topLineChanges(result.lineAdjustments || []);
  els.jobPipelineResult.innerHTML = `
    <div class="pipeline-summary">
      <div>
        <span>Application score</span>
        <strong>${Number(score.total || 0)}/100</strong>
        <small>${escapeHtml(score.label || "not scored")}</small>
      </div>
      <div>
        <span>Master resume</span>
        <strong>${escapeHtml(result.selectedMasterResume || "auto")}</strong>
        <small>${escapeHtml(checklist.roleFamily?.label || "Unknown role")}</small>
      </div>
      <div>
        <span>Keyword coverage</span>
        <strong>${Number(resumeAgent.keywordCoverage?.covered || 0)}/${Number(resumeAgent.keywordCoverage?.total || 0)}</strong>
        <small>${escapeHtml(resumeAgent.score?.label || "resume scan")}</small>
      </div>
      <div>
        <span>ATS check</span>
        <strong>${escapeHtml(ats.copyPasteReady ? "Ready-ish" : "Review")}</strong>
        <small>${escapeHtml(ats.status || "not checked")}</small>
      </div>
    </div>
    <section class="top-changes-card">
      <div>
        <span>Do this first</span>
        <h3>${topChanges.length ? "Update these resume lines" : "No major line edits"}</h3>
      </div>
      <ol>
        ${topChanges.map((item) => `
          <li>
            <strong>${item.line ? `Line ${item.line}` : "Resume note"}</strong>
            <span>${escapeHtml(item.replacement || item.action || "")}</span>
          </li>
        `).join("") || "<li><span>Review formatting, then apply manually.</span></li>"}
      </ol>
    </section>
    <div class="pipeline-columns">
      <article>
        <h3>Exact master-resume line edits</h3>
        ${lineAdjustmentBlock(result.lineAdjustments || [])}
      </article>
      <article>
        <h3>Handbook keyword checklist</h3>
        ${listBlock("Use these keywords", checklist.explicitTechnicalKeywords)}
        ${listBlock("Missing", checklist.resumeMissingKeywords)}
        <details>
          <summary>More keyword detail</summary>
          ${listBlock("Matched", checklist.resumeMatchedKeywords)}
          ${listBlock("Repeated phrases", (checklist.repeatedJobPhrases || []).map((item) => `${item.phrase} ×${item.count}`))}
        </details>
      </article>
      <article>
        <h3>ATS / handbook pass</h3>
        <div class="ats-status-card">
          <strong>${escapeHtml(ats.status || "Not checked")}</strong>
          <span>${escapeHtml(ats.note || "Deterministic readability check.")}</span>
        </div>
        ${listBlock("Fix before applying", ats.hazards)}
        ${listBlock("Already OK", ats.passes)}
      </article>
      <article>
        <h3>Resume edits to make</h3>
        ${listBlock("Add or emphasize", (edits.addOrEmphasize || []).map((item) => item.bullet))}
        ${listBlock("Do not add without evidence", edits.doNotAddWithoutEvidence)}
        <details>
          <summary>Compression notes</summary>
          ${listBlock("Cut / compress", (edits.cutOrDeemphasize || []).map((item) => item.action))}
        </details>
      </article>
      <article>
        <h3>Prompt pack</h3>
        <details>
          <summary>Keyword prompt</summary>
          <pre>${escapeHtml(result.prompts?.handbookKeywordPrompt || "")}</pre>
        </details>
        <details>
          <summary>Resume tailoring prompt</summary>
          <pre>${escapeHtml(result.prompts?.resumeTailoringPrompt || "")}</pre>
        </details>
        <details>
          <summary>Deterministic tailoring brief</summary>
          <div class="brief-actions">
            <button class="copy-brief-button" data-copy-tailoring-brief type="button">Copy brief</button>
            <button class="copy-brief-button" data-download-tailoring-brief type="button">Download .md</button>
          </div>
          <pre>${escapeHtml(result.tailoringBrief || "Brief unavailable.")}</pre>
        </details>
      </article>
    </div>
    <div class="pipeline-guardrails">
      ${(result.guardrails || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
}

function topLineChanges(adjustments = []) {
  return adjustments
    .filter((item) => item && ["add_or_replace", "do_not_add"].includes(item.type))
    .slice(0, 5);
}

async function handleJobPipelineResultClick(event) {
  const copyButton = event.target.closest?.("[data-copy-tailoring-brief]");
  const downloadButton = event.target.closest?.("[data-download-tailoring-brief]");
  if (!copyButton && !downloadButton) return;
  const brief = state.jobPipeline.result?.tailoringBrief;
  if (!brief) return;
  if (downloadButton) {
    downloadTextFile(briefFileName(state.jobPipeline.result), brief, "text/markdown;charset=utf-8");
    return;
  }
  try {
    await navigator.clipboard.writeText(brief);
    copyButton.textContent = "Copied";
    setTimeout(() => { copyButton.textContent = "Copy brief"; }, 1600);
  } catch {
    copyButton.textContent = "Copy failed";
    setTimeout(() => { copyButton.textContent = "Copy brief"; }, 1600);
  }
}

function briefFileName(result) {
  return `${[
    result?.job?.company,
    result?.job?.role,
    "tailoring-brief"
  ].filter(Boolean).join("-")}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) + ".md";
}

function downloadTextFile(fileName, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function lineAdjustmentBlock(adjustments = []) {
  const values = Array.isArray(adjustments) ? adjustments.filter(Boolean) : [];
  if (!values.length) return `<p class="pipeline-empty-text">No line edits generated.</p>`;
  return `
    <ol class="line-adjustments">
      ${values.slice(0, 10).map((item) => `
        <li>
          <strong>${item.line ? `Line ${item.line}` : "Resume note"}</strong>
          ${item.current ? `<code>${escapeHtml(item.current)}</code>` : ""}
          <span>${escapeHtml(item.action || "")}</span>
          ${item.reason ? `<small>${escapeHtml(item.reason)}</small>` : ""}
        </li>
      `).join("")}
    </ol>
  `;
}

function listBlock(title, items = []) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  return `
    <div class="pipeline-list-block">
      <strong>${escapeHtml(title)}</strong>
      ${values.length
        ? `<ul>${values.slice(0, 8).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : `<p>None detected.</p>`}
    </div>
  `;
}

async function reviewAgentApplication(application) {
  if (!application) return;
  const approved = application.stage !== "approved_for_manual_submit";
  const response = await fetch("/api/application-agent/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applicationId: application.id,
      approved,
      resumeReviewed: document.querySelector("#resumeReviewed")?.checked || false,
      claimsReviewed: document.querySelector("#claimsReviewed")?.checked || false,
      eligibilityReviewed: document.querySelector("#eligibilityReviewed")?.checked || false,
      locationReviewed: document.querySelector("#locationReviewed")?.checked || false
    })
  });
  if (!response.ok) {
    showAgentMessage(
      response.status === 422
        ? "Complete all four review checks before approval."
        : "Could not save application review.",
      "error"
    );
    return;
  }
  const payload = await response.json();
  state.agent.applications[application.id] = payload.application;
  state.agent.metrics = payload.metrics;
  renderAgentOverview();
  renderDetails();
}

function showAgentMessage(message, tone) {
  const card = document.querySelector(".agent-card");
  if (!card) return;
  const notice = document.createElement("div");
  notice.className = `agent-notice ${tone}`;
  notice.textContent = message;
  card.prepend(notice);
}

async function recordAgentOutcome(applicationId, stage) {
  if (!applicationId) return;
  const response = await fetch("/api/application-agent/outcome", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId, stage })
  });
  if (!response.ok) return;
  const payload = await response.json();
  state.agent.applications[applicationId] = payload.application;
  state.agent.metrics = payload.metrics;
  state.agent.outcomeAnalytics = payload.outcomeAnalytics || state.agent.outcomeAnalytics;
  renderAgentOverview();
  if (stage === "submitted") {
    const role = state.roles.find((item) => item.id === state.selectedId);
    if (role) {
      state.tracker[role.id] = {
        ...(state.tracker[role.id] || {}),
        status: "Applied",
        date: state.tracker[role.id]?.date || new Date().toISOString().slice(0, 10),
        resumeVersion: payload.application.masterResume === "ai"
          ? "ai-engineer-master"
          : "general-swe-master",
        updatedAt: new Date().toISOString()
      };
      saveJson("ng_tracker", state.tracker);
      await queuePersistTracker();
    }
  }
  renderListAndMetrics(true);
}

function isAggregatorUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return ["jobright.ai", "linkedin.com", "indeed.com", "ziprecruiter.com", "glassdoor.com"]
      .some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function saveDetail(id, rerender = false) {
  state.tracker[id] = {
    status: document.querySelector("#detailStatus").value,
    date: document.querySelector("#detailDate").value,
    responseDate: document.querySelector("#detailResponseDate").value,
    deadline: document.querySelector("#detailDeadline").value,
    followUp: document.querySelector("#detailFollowUp").value,
    resumeVersion: document.querySelector("#detailResume").value,
    notes: document.querySelector("#detailNotes").value,
    updatedAt: new Date().toISOString()
  };
  saveJson("ng_tracker", state.tracker);
  await queuePersistTracker();
  if (rerender) renderListAndMetrics(true);
}

function breakdownRow(label, value) {
  return `
    <div class="breakdown-row">
      <span>${label}</span>
      <div class="bar"><span style="width: ${Math.max(0, Math.min(100, value))}%"></span></div>
      <strong>${value}</strong>
    </div>
  `;
}

function filteredRoles() {
  return state.roles.filter((role) => {
    if (state.source === "dream" && !isDreamRole(role)) return false;
    if (state.source !== "all" && state.source !== "dream" && role.source !== state.source) return false;
    if (state.chance !== "all" && role.chance !== state.chance) return false;
    if (state.status !== "all" && getStatus(role) !== state.status) return false;
    if (state.stateFilter !== "all" && !role.stateCodes.includes(state.stateFilter)) return false;
    const minPay = Math.max(state.minPay, state.minPayCustom);
    if (minPay && (!role.pay.value || role.pay.value < minPay)) return false;
    if (state.hasPayOnly && !role.pay.value) return false;
    if (state.remoteOnly && !role.stateCodes.includes("Remote")) return false;
    if (state.activeTags.size) {
      const roleTags = new Set(getRoleTags(role).map((tag) => tag.key));
      if (![...state.activeTags].every((tag) => roleTags.has(tag))) return false;
    }
    if (state.locationText && ![role.location, role.locationLabel, role.stateCodes.join(" ")].join(" ").toLowerCase().includes(state.locationText)) return false;
    if (!state.search) return true;
    const haystack = [role.company, role.role, role.location, role.locationLabel, role.fitTrack, role.salary, role.why].join(" ").toLowerCase();
    return haystack.includes(state.search);
  });
}

function roleTagCounts(roles) {
  const tags = new Map();
  roles.forEach((role) => {
    getRoleTags(role).forEach((tag) => {
      const current = tags.get(tag.key) || { ...tag, count: 0 };
      current.count += 1;
      tags.set(tag.key, current);
    });
  });
  const priority = {
    "special:dream": 1,
    "location:Remote": 2,
    "pay:known": 3,
    "chance:Higher": 4,
    "track:AI/ML": 5,
    "track:Platform": 6,
    "track:Backend": 7,
    "track:Cloud": 8,
    "track:Infrastructure": 9,
    "age:fresh": 10,
    "deadline:set": 11,
    "state:FL": 12
  };
  return [...tags.values()]
    .filter((tag) => tag.count >= 3 || state.activeTags.has(tag.key))
    .sort((a, b) => (priority[a.key] || 99) - (priority[b.key] || 99) || b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 28);
}

function getRoleTags(role) {
  const tags = [];
  const add = (key, label) => tags.push({ key, label });
  const text = `${role.role} ${role.fitTrack} ${role.why} ${role.sourceLabel}`.toLowerCase();
  if (isDreamRole(role)) add("special:dream", "Dream");
  if (role.stateCodes.includes("Remote")) add("location:Remote", "Remote");
  if (role.pay.value) add("pay:known", "Known pay");
  if (role.pay.value >= 150000) add("pay:150k", "$150k+");
  if (role.pay.value >= 125000) add("pay:125k", "$125k+");
  const ageDays = jobAgeDays(role.posted);
  if (Number.isFinite(ageDays) && ageDays <= 7) add("age:fresh", "Posted <=7d");
  if (state.tracker[role.id]?.deadline) add("deadline:set", "Deadline set");
  if (role.chance) add(`chance:${role.chance}`, `${role.chance} chance`);
  if (role.sourceLabel) add(`source:${role.sourceLabel}`, role.sourceLabel);
  role.stateCodes.forEach((code) => {
    if (!["Unknown", "Multiple"].includes(code)) add(`state:${code}`, code);
  });
  const derived = [
    ["track:AI/ML", "AI/ML", ["ai", "ml", "llm", "machine learning", "mlops"]],
    ["track:Platform", "Platform", ["platform"]],
    ["track:Backend", "Backend", ["backend", "api", ".net", "node", "server"]],
    ["track:Cloud", "Cloud", ["cloud", "aws", "azure"]],
    ["track:Infrastructure", "Infrastructure", ["infrastructure", "observability", "sre", "devops"]],
    ["track:Data", "Data", ["data engineer", "analytics", "sql", "etl"]],
    ["track:Security", "Security", ["security", "cyber", "governance", "rbac"]],
    ["track:Frontend", "Frontend", ["frontend", "react", "angular", "ui"]]
  ];
  derived.forEach(([key, label, keywords]) => {
    if (keywords.some((keyword) => text.includes(keyword))) add(key, label);
  });
  return [...new Map(tags.map((tag) => [tag.key, tag])).values()];
}

function isDreamRole(role) {
  return DREAM_COMPANIES.some((company) => role.company.toLowerCase().includes(company.toLowerCase()));
}

function dreamRank(company) {
  const index = DREAM_COMPANIES.findIndex((item) => company.toLowerCase().includes(item.toLowerCase()));
  return index === -1 ? 999 : index;
}

function sortedFilteredRoles() {
  const roles = [...filteredRoles()];
  roles.sort((a, b) => {
    if (state.sort === "pay") return b.scores.payScore - a.scores.payScore || b.scores.total - a.scores.total;
    if (state.sort === "statePay") return b.scores.locationScore - a.scores.locationScore || b.scores.payScore - a.scores.payScore || b.scores.total - a.scores.total;
    if (state.sort === "dueSoon") return dueSortValue(a) - dueSortValue(b) || b.scores.total - a.scores.total;
    if (state.sort === "location") return b.scores.locationScore - a.scores.locationScore || b.scores.total - a.scores.total;
    if (state.sort === "chance") return b.scores.chanceScore - a.scores.chanceScore || b.scores.total - a.scores.total;
    if (state.sort === "freshness") return b.scores.freshnessScore - a.scores.freshnessScore || b.scores.total - a.scores.total;
    if (state.sort === "company") return a.company.localeCompare(b.company);
    return b.scores.total - a.scores.total;
  });
  return roles;
}

function tailoringBullets(role) {
  const text = `${role.role} ${role.fitTrack} ${role.why}`.toLowerCase();
  const bullets = [];
  if (text.includes("ai") || text.includes("ml") || text.includes("llm")) {
    bullets.push("Lead with NYL AI/cloud platform scope, evaluation frameworks, and CaseFlow agentic workflow.");
  }
  if (text.includes("platform") || text.includes("infrastructure") || text.includes("backend")) {
    bullets.push("Use UF SASE Redis rate limiting, OpenTelemetry/Jaeger, and AWS FinOps as the technical proof.");
  }
  if (text.includes("security") || text.includes("governance")) {
    bullets.push("Emphasize RTX air-gapped credential platform, RBAC/auth, audit, and compliance workflows.");
  }
  if (text.includes("full") || text.includes("react") || text.includes("frontend")) {
    bullets.push("Point to FCI React product work and RTX Angular/.NET enterprise app experience.");
  }
  bullets.push("Quantify the application note with pay, location preference, referral path, and next action.");
  return bullets.slice(0, 4);
}

function getStatus(role) {
  return state.tracker[role.id]?.status || "Discovered";
}

function parsePay(value) {
  const text = String(value || "");
  const numbers = [...text.matchAll(/\$?\s*([0-9][0-9,.]*)\s*(k|K)?/g)].map((match) => {
    const raw = Number(match[1].replace(/,/g, ""));
    return match[2] ? raw * 1000 : raw;
  }).filter((item) => Number.isFinite(item) && item > 0);
  const yearly = /\/yr|year|annual|salary/i.test(text);
  const hourly = /\/hr|hour/i.test(text);
  const monthly = /\/mon|month/i.test(text);
  let estimate = 0;
  if (numbers.length) {
    const sensible = numbers.filter((item) => item < 1000000);
    estimate = (sensible.length ? sensible : numbers).reduce((sum, item) => sum + item, 0) / (sensible.length || numbers.length);
    if (hourly) estimate *= 2080;
    if (monthly) estimate *= 12;
    if (!yearly && !hourly && !monthly && estimate < 1000) estimate *= 1000;
  }
  if (estimate > 500000 || estimate < 25000) estimate = 0;
  return {
    value: Math.round(estimate),
    label: estimate ? `$${Math.round(estimate / 1000)}k est.` : ""
  };
}

function scorePay(pay) {
  if (!pay.value) return 45;
  if (pay.value >= 180000) return 100;
  if (pay.value >= 150000) return 90;
  if (pay.value >= 125000) return 78;
  if (pay.value >= 100000) return 64;
  if (pay.value >= 80000) return 52;
  return 38;
}

function scoreLocation(location) {
  const text = String(location || "").toLowerCase();
  const pref = state.locationPreference;
  if (!text) return 45;
  if (text.includes("remote")) return pref === "remote" ? 100 : 82;
  if (pref === "flexible") return 76;
  const matches = {
    nyc: ["nyc", "new york", "manhattan", "boston", "new jersey"],
    sf: ["san francisco", "sf", "san mateo", "palo alto", "mountain view", "sunnyvale", "san jose", "bay area"],
    seattle: ["seattle", "bellevue", "redmond"],
    florida: ["florida", "orlando", "miami", "tampa", "gainesville", "jacksonville", "atlanta", "charlotte"]
  };
  return matches[pref]?.some((needle) => text.includes(needle)) ? 100 : 48;
}

function scoreFit(role) {
  const text = `${role.role} ${role.fitTrack} ${role.why}`.toLowerCase();
  let score = 48;
  ["platform", "backend", "cloud", "aws", "infrastructure", "observability", "eval", "llm", "ai", "mlops", "data engineer"].forEach((keyword) => {
    if (text.includes(keyword)) score += 7;
  });
  if (role.fitScore) score = Math.max(score, Math.min(100, Math.round(Number(role.fitScore))));
  return Math.min(100, score);
}

function scoreCompany(company) {
  const stretch = ["Datadog", "Stripe", "Microsoft", "Google", "Amazon", "NVIDIA", "OpenAI", "Anthropic", "CoreWeave", "Fireworks AI", "Glean", "Slack"];
  const strong = ["RTX", "IBM", "Capital One", "Lockheed Martin", "Symbotic", "ServiceNow", "General Dynamics", "MongoDB", "Cloudflare"];
  if (stretch.some((item) => company.includes(item))) return 88;
  if (strong.some((item) => company.includes(item))) return 76;
  return 58;
}

function scoreFreshness(posted) {
  const days = jobAgeDays(posted);
  if (Number.isFinite(days)) {
    if (days <= 3) return 92;
    if (days <= 14) return 78;
    if (days <= 31) return 60;
    return 42;
  }
  const text = String(posted || "").toLowerCase();
  if (!text) return 52;
  return 55;
}

function exportTracker() {
  const rows = state.roles.map((role) => ({
    company: role.company,
    role: role.role,
    location: role.location,
    state: role.stateCodes.join(" / "),
    pay_estimate: role.pay.value || "",
    score: role.scores.total,
    chance: role.chance,
    status: getStatus(role),
    date: state.tracker[role.id]?.date || "",
    response_date: state.tracker[role.id]?.responseDate || "",
    deadline: state.tracker[role.id]?.deadline || "",
    follow_up: state.tracker[role.id]?.followUp || "",
    resume_version: state.tracker[role.id]?.resumeVersion || "",
    notes: state.tracker[role.id]?.notes || "",
    url: role.url
  }));
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "application-tracker-export.csv";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadPersistentTracker() {
  try {
    const response = await fetch("/api/tracker", { cache: "no-store" });
    if (!response.ok) throw new Error(`tracker API returned ${response.status}`);
    const payload = await response.json();
    state.revision = Number(payload.revision || 0);
    const serverTracker = normalizeTracker(payload.tracker);
    if (Object.keys(serverTracker).length) {
      state.tracker = mergeTrackers(serverTracker, state.tracker);
      saveJson("ng_tracker", state.tracker);
      if (JSON.stringify(state.tracker) !== JSON.stringify(serverTracker)) {
        await queuePersistTracker();
      }
    } else if (Object.keys(state.tracker).length) {
      await queuePersistTracker();
    }
    setPersistence("saved");
  } catch {
    state.tracker = normalizeTracker(state.tracker);
    setPersistence("local");
  }
}

function queuePersistTracker() {
  const operation = () => persistTracker();
  state.saveChain = state.saveChain.then(operation, operation);
  return state.saveChain;
}

async function persistTracker() {
  setPersistence("saving");
  try {
    let response = await fetch("/api/tracker", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: state.revision, tracker: state.tracker })
    });
    if (response.status === 409) {
      const current = await response.json();
      state.revision = Number(current.revision || 0);
      state.tracker = mergeTrackers(current.tracker, state.tracker);
      response = await fetch("/api/tracker", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: state.revision, tracker: state.tracker })
      });
    }
    if (!response.ok) throw new Error(`tracker API returned ${response.status}`);
    const payload = await response.json();
    state.revision = Number(payload.revision || state.revision);
    state.tracker = normalizeTracker(payload.tracker);
    saveJson("ng_tracker", state.tracker);
    setPersistence("saved");
  } catch {
    setPersistence("local");
  }
}

function mergeTrackers(serverTracker, localTracker) {
  const server = normalizeTracker(serverTracker);
  const local = normalizeTracker(localTracker);
  const merged = { ...server };
  Object.entries(local).forEach(([id, localEntry]) => {
    const serverEntry = server[id];
    if (!serverEntry) {
      merged[id] = localEntry;
      return;
    }
    const serverUpdated = Date.parse(serverEntry.updatedAt || "") || 0;
    const localUpdated = Date.parse(localEntry.updatedAt || "") || 0;
    merged[id] = localUpdated >= serverUpdated ? localEntry : serverEntry;
  });
  return merged;
}

async function importTrackerFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const result = importTrackerCsv(await file.text(), state.roles, state.tracker);
  state.tracker = result.tracker;
  saveJson("ng_tracker", state.tracker);
  await queuePersistTracker();
  renderListAndMetrics(true);
  const details = [
    `${result.imported} matched`,
    result.unmatched ? `${result.unmatched} unmatched` : "",
    result.skipped ? `${result.skipped} skipped` : ""
  ].filter(Boolean).join("; ");
  setPersistence("saved", `Import complete: ${details}`);
  els.persistenceStatus.title = result.unmatchedRows
    .slice(0, 5)
    .map((row) => `${row.company} — ${row.role}`)
    .join("\n");
  event.target.value = "";
}

function setPersistence(status, label = "") {
  state.persistence = status;
  if (!els.persistenceStatus) return;
  const labels = {
    loading: "Loading tracker…",
    saving: "Saving…",
    saved: "Saved to local server",
    local: "Browser-only fallback"
  };
  els.persistenceStatus.textContent = label || labels[status] || status;
  els.persistenceStatus.dataset.state = status;
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatRate(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatLift(value) {
  const numeric = Number(value || 0);
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(1)}pp`;
}

function formatLocation(location) {
  const text = String(location || "").trim();
  if (!text) return "";
  const states = getStateCodes(text);
  const cleaned = text.replace(/^(multiple|multi locations?)\s*[:/-]?\s*/i, "").trim();
  if (states.includes("Remote")) return `Remote / ${text.replace(/remote/ig, "").replace(/^[:;,\s]+|[:;,\s]+$/g, "") || "US"}`;
  if (states.includes("Multiple")) return `Multiple / ${cleaned || text}`;
  if (states.length && states[0] !== "Unknown") return `${states.slice(0, 3).join(" / ")} / ${text}`;
  return `Unknown / ${text}`;
}

function getStateCodes(location) {
  const text = String(location || "").toLowerCase();
  if (!text) return ["Unknown"];
  const codes = new Set();
  if (text.includes("remote")) codes.add("Remote");
  if (/multiple|multi locations|various|nationwide|united states|us\b/.test(text)) codes.add("Multiple");
  Object.entries(STATE_NAMES).forEach(([name, code]) => {
    if (text.includes(name)) codes.add(code);
  });
  const abbreviationMatches = String(location).match(/\b[A-Z]{2}\b/g) || [];
  abbreviationMatches.forEach((code) => {
    if (Object.values(STATE_NAMES).includes(code)) codes.add(code);
  });
  const cityMap = {
    "new york": "NY", nyc: "NY", manhattan: "NY", brooklyn: "NY",
    boston: "MA", cambridge: "MA",
    "san francisco": "CA", "bay area": "CA", "palo alto": "CA", "mountain view": "CA", sunnyvale: "CA", "san jose": "CA", "san mateo": "CA", menlo: "CA",
    seattle: "WA", bellevue: "WA", redmond: "WA",
    austin: "TX", dallas: "TX", houston: "TX",
    chicago: "IL",
    atlanta: "GA",
    charlotte: "NC", raleigh: "NC",
    orlando: "FL", miami: "FL", tampa: "FL", gainesville: "FL", jacksonville: "FL",
    washington: "DC", arlington: "VA", mclean: "VA", reston: "VA"
  };
  Object.entries(cityMap).forEach(([city, code]) => {
    if (text.includes(city)) codes.add(code);
  });
  return codes.size ? [...codes].sort() : ["Unknown"];
}

function countStates(roles) {
  const states = new Set(roles.flatMap((role) => role.stateCodes).filter((item) => !["Unknown", "Multiple"].includes(item)));
  return states.size || "n/a";
}

function activeFilterCount() {
  let count = state.activeTags.size;
  if (state.search) count++;
  if (state.chance !== "all") count++;
  if (state.status !== "all") count++;
  if (state.stateFilter !== "all") count++;
  if (state.minPay || state.minPayCustom) count++;
  if (state.locationText) count++;
  if (state.remoteOnly) count++;
  if (state.hasPayOnly) count++;
  return count;
}

function dueSortValue(role) {
  const date = state.tracker[role.id]?.deadline;
  if (!date) return Number.MAX_SAFE_INTEGER;
  const time = new Date(`${date}T00:00:00`).getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function deadlineLabel(role) {
  const date = state.tracker[role.id]?.deadline;
  if (!date) return "";
  const due = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(due.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days}d`;
}

function jobAgeLabel(role) {
  const days = jobAgeDays(role.posted);
  if (!Number.isFinite(days)) return "";
  if (days === 0) return "up today";
  if (days === 1) return "up 1d";
  return `up ${days}d`;
}

function jobAgeDays(posted) {
  const text = String(posted || "").trim().toLowerCase();
  if (!text) return NaN;
  const matches = [];
  if (text.includes("today")) matches.push(0);
  if (text.includes("yesterday")) matches.push(1);

  [...text.matchAll(/(\d+)\s*d(?:ay)?s?\b/g)].forEach((match) => {
    matches.push(Number(match[1]));
  });
  [...text.matchAll(/(\d+)\s*w(?:eek)?s?\b/g)].forEach((match) => {
    matches.push(Number(match[1]) * 7);
  });
  [...text.matchAll(/(\d+)\s*mo(?:nth)?s?\b/g)].forEach((match) => {
    matches.push(Number(match[1]) * 30);
  });
  [...text.matchAll(/20\d{2}-\d{2}-\d{2}/g)].forEach((match) => {
    const postedDate = new Date(`${match[0]}T00:00:00`);
    if (!Number.isFinite(postedDate.getTime())) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    matches.push(Math.max(0, Math.round((today.getTime() - postedDate.getTime()) / 86400000)));
  });

  return matches.length ? Math.min(...matches) : NaN;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
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
  return rows.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] || ""])));
}

function dedupeRoles(roles) {
  const seen = new Set();
  return roles.filter((role) => {
    const key = `${role.company}|${role.role}|${role.location}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] || {});
  return [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((line) => line.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

function chanceFromTier(tier) {
  if (tier.includes("Safe")) return "Higher";
  if (tier.includes("Reach")) return "Medium";
  if (tier.includes("Stretch")) return "Lower";
  return "Unknown";
}

function firstUrl(value) {
  return String(value || "").split(" | ")[0].trim();
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140);
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
