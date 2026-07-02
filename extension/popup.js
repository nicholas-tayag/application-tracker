const API = "http://localhost:4177";
const profileFields = ["fullName", "email", "phone", "location", "linkedin", "github"];

document.querySelector("#saveProfile").addEventListener("click", saveProfile);
document.querySelector("#analyze").addEventListener("click", analyzeAndFill);
loadProfile();

async function loadProfile() {
  try {
    const state = await api("/api/application-agent");
    for (const key of profileFields) document.querySelector(`#${key}`).value = state.profile?.[key] || "";
    setStatus("Connected to the local tracker.", "good");
  } catch {
    setStatus("Start the tracker at localhost:4177.", "warn");
  }
}

async function saveProfile() {
  const profile = Object.fromEntries(
    profileFields.map((key) => [key, document.querySelector(`#${key}`).value.trim()])
  );
  await api("/api/application-agent/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile })
  });
  setStatus("Profile saved locally.", "good");
}

async function analyzeAndFill() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://")) {
    setStatus("Open a secure employer or ATS application page.", "warn");
    return;
  }
  const scan = await chrome.tabs.sendMessage(tab.id, { type: "scan-fields" });
  const state = await api("/api/application-agent");
  const application = Object.values(state.applications || {}).find((item) =>
    equivalentUrl(item.jobUrl, scan.url)
  );
  if (!application) {
    setStatus("Prepare this exact direct-link role in the tracker first.", "warn");
    return;
  }
  const plan = await api("/api/application-agent/autofill-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId: application.id, fields: scan.fields })
  });
  const result = await chrome.tabs.sendMessage(tab.id, { type: "apply-plan", plan });
  document.querySelector("#result").innerHTML =
    `<strong>${result.filled} safe fields filled</strong><br>` +
    `${plan.blockers.length} fields require review. Final submission was not touched.`;
  setStatus("Safe fill complete. Review every field.", "good");
}

async function api(path, options) {
  const response = await fetch(`${API}${path}`, options);
  if (!response.ok) throw new Error(`Tracker returned ${response.status}`);
  return response.json();
}

function equivalentUrl(left, right) {
  try {
    const normalize = (value) => {
      const url = new URL(value);
      return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
    };
    return normalize(left) === normalize(right);
  } catch {
    return false;
  }
}

function setStatus(message, tone) {
  const status = document.querySelector("#status");
  status.textContent = message;
  status.className = `status ${tone}`;
}
