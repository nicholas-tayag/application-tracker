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

const STATUS_OPTIONS = ["Saved", "Applying", "Applied", "Interviewing", "Rejected"];
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
  tracker: loadJson("ng_tracker", {})
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
  exportButton: document.querySelector("#exportButton")
};

init();

async function init() {
  els.locationPreference.value = state.locationPreference;
  renderWeights();
  bindEvents();
  const batches = await Promise.all(DATASETS.map(loadDataset));
  state.roles = dedupeRoles(batches.flat()).map(enrichRole);
  renderStateFilter();
  state.selectedId = sortedFilteredRoles()[0]?.id || null;
  render();
}

function bindEvents() {
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
  const chanceScore = { Higher: 100, Medium: 67, Lower: 38 }[role.chance] || 55;
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
  const applied = state.roles.filter((role) => getStatus(role) === "Applied").length;
  const interviewing = state.roles.filter((role) => getStatus(role) === "Interviewing").length;
  const top = sortedFilteredRoles()[0];
  els.metrics.innerHTML = [
    ["Visible roles", roles.length],
    ["Applied", applied],
    ["Interviewing", interviewing],
    ["Top score", top ? `${top.scores.total}/100` : "n/a"],
    ["Tracked states", countStates(roles)]
  ].map(([label, value]) => `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
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
      <h4>Track This Application</h4>
      <div class="status-form">
        <select id="detailStatus">
          ${STATUS_OPTIONS.map((status) => `<option value="${status}" ${getStatus(role) === status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
        <input id="detailDate" type="date" value="${escapeAttribute(tracker.date || "")}" />
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
  document.querySelector("#detailDeadline").addEventListener("change", () => saveDetail(role.id, true));
  document.querySelector("#detailFollowUp").addEventListener("change", () => saveDetail(role.id, true));
  document.querySelector("#detailResume").addEventListener("blur", () => saveDetail(role.id, true));
  document.querySelector("#detailNotes").addEventListener("blur", () => saveDetail(role.id, true));
}

function saveDetail(id, rerender = false) {
  state.tracker[id] = {
    status: document.querySelector("#detailStatus").value,
    date: document.querySelector("#detailDate").value,
    deadline: document.querySelector("#detailDeadline").value,
    followUp: document.querySelector("#detailFollowUp").value,
    resumeVersion: document.querySelector("#detailResume").value,
    notes: document.querySelector("#detailNotes").value
  };
  saveJson("ng_tracker", state.tracker);
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
  return state.tracker[role.id]?.status || "Saved";
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
  link.click();
  URL.revokeObjectURL(url);
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
  return "Medium";
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
