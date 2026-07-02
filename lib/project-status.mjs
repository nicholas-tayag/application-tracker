const VALID_STATUSES = new Set(["queued", "running", "completed", "blocked"]);
const STATUS_TRANSITIONS = Object.freeze({
  queued: new Set(["queued", "running", "blocked"]),
  running: new Set(["running", "completed", "blocked"]),
  blocked: new Set(["blocked", "queued", "running"]),
  completed: new Set(["completed"])
});
const DAY_MS = 86_400_000;

export function normalizeProjectStatus(rawRegistry = {}, options = {}) {
  const now = normalizeTimestamp(options.now) || new Date().toISOString();
  const source = Array.isArray(rawRegistry) ? { workstreams: rawRegistry } : object(rawRegistry);
  const workstreams = array(source.workstreams)
    .map((item, index) => normalizeWorkstream(item, index, now))
    .filter(Boolean);

  return {
    schemaVersion: 1,
    project: text(source.project) || "application-tracker",
    updatedAt: latestTimestamp(
      normalizeTimestamp(source.updatedAt),
      ...workstreams.flatMap((workstream) =>
        workstream.tasks.map((task) => task.lastUpdate)
      )
    ) || now,
    registryType: "explicit_checkpoint_registry",
    liveIntrospection: false,
    note: "Updated only at integration checkpoints or automation runs; it does not inspect live agents.",
    workstreams
  };
}

export function updateProjectTask(rawRegistry, selector, patch = {}, options = {}) {
  const now = normalizeTimestamp(options.now) || new Date().toISOString();
  const registry = normalizeProjectStatus(rawRegistry, { now });
  const workstreamId = slug(selector?.workstreamId || selector?.workstream);
  const taskId = slug(selector?.taskId || selector?.task);
  const workstream = registry.workstreams.find((item) => item.id === workstreamId);
  if (!workstream) throw new Error(`Unknown workstream: ${workstreamId || "(missing)"}`);

  const index = workstream.tasks.findIndex((item) => item.id === taskId);
  if (index < 0) throw new Error(`Unknown task: ${taskId || "(missing)"}`);

  const current = workstream.tasks[index];
  const proposedStatus = normalizeStatus(patch.status ?? current.status);
  if (
    current.status === "completed" &&
    proposedStatus !== "completed" &&
    options.allowReopen !== true
  ) {
    throw new Error("Completed tasks cannot be reopened without allowReopen");
  }
  if (!STATUS_TRANSITIONS[current.status].has(proposedStatus) && options.allowReopen !== true) {
    throw new Error(`Invalid status transition: ${current.status} -> ${proposedStatus}`);
  }

  const merged = {
    ...current,
    ...object(patch),
    id: current.id,
    status: proposedStatus,
    lastUpdate: normalizeTimestamp(patch.lastUpdate) || now
  };
  workstream.tasks[index] = normalizeTask(merged, index, now);
  registry.updatedAt = now;
  return normalizeProjectStatus(registry, { now });
}

export function summarizeProjectStatus(rawRegistry, options = {}) {
  const now = normalizeTimestamp(options.now) || new Date().toISOString();
  const staleAfterDays = positiveInteger(options.staleAfterDays, 7);
  const registry = normalizeProjectStatus(rawRegistry, { now });
  const tasks = registry.workstreams.flatMap((workstream) =>
    workstream.tasks.map((task) => ({
      ...task,
      workstreamId: workstream.id,
      workstreamName: workstream.name
    }))
  );
  const counts = Object.fromEntries(
    [...VALID_STATUSES].map((status) => [
      status,
      tasks.filter((task) => task.status === status).length
    ])
  );
  const staleTasks = tasks
    .filter((task) => isStale(task, now, staleAfterDays))
    .map(taskReference);
  const blockers = tasks
    .filter((task) => task.status === "blocked" || task.blocker)
    .map((task) => ({ ...taskReference(task), blocker: task.blocker }));
  const completedDeliverables = tasks
    .filter((task) => task.status === "completed")
    .flatMap((task) =>
      task.completedDeliverables.map((deliverable) => ({
        ...taskReference(task),
        deliverable
      }))
    );

  return {
    generatedAt: now,
    overallProgress: deriveOverallProgress(registry),
    totalTasks: tasks.length,
    counts,
    staleAfterDays,
    staleTasks,
    blockers,
    completedDeliverables,
    workstreams: registry.workstreams.map((workstream) => ({
      id: workstream.id,
      name: workstream.name,
      progress: deriveOverallProgress({ workstreams: [workstream] }),
      taskCount: workstream.tasks.length,
      completedCount: workstream.tasks.filter((task) => task.status === "completed").length
    })),
    liveIntrospection: false
  };
}

export function deriveOverallProgress(rawRegistry) {
  const workstreams = array(rawRegistry?.workstreams);
  const tasks = workstreams.flatMap((workstream) => array(workstream?.tasks));
  if (!tasks.length) return 0;
  const total = tasks.reduce((sum, task) => sum + validProgress(task?.progress), 0);
  return round(total / tasks.length, 1);
}

function normalizeWorkstream(raw, index, now) {
  const value = object(raw);
  const name = text(value.name) || text(value.id);
  if (!name) return null;
  const id = slug(value.id || name) || `workstream-${index + 1}`;
  return {
    id,
    name,
    description: text(value.description),
    tasks: array(value.tasks).map((task, taskIndex) =>
      normalizeTask(task, taskIndex, now)
    )
  };
}

function normalizeTask(raw, index, now) {
  const value = object(raw);
  const name = text(value.name || value.taskName);
  if (!name) throw new TypeError("Each project task requires a name");
  const status = normalizeStatus(value.status);
  const progress = value.progress === undefined
    ? defaultProgress(status)
    : validProgress(value.progress);
  if (status === "completed" && progress !== 100) {
    throw new RangeError("Completed tasks must have progress 100");
  }
  if (status === "queued" && progress === 100) {
    throw new RangeError("Queued tasks cannot have progress 100");
  }

  return {
    id: slug(value.id || name) || `task-${index + 1}`,
    name,
    owner: text(value.owner) || "unassigned",
    status,
    progress,
    currentStep: text(value.currentStep),
    lastUpdate: normalizeTimestamp(value.lastUpdate) || now,
    verificationSummary: text(value.verificationSummary),
    blocker: text(value.blocker),
    completedDeliverables: uniqueStrings(value.completedDeliverables)
  };
}

function normalizeStatus(value) {
  const status = text(value).toLowerCase().replaceAll(" ", "_") || "queued";
  if (!VALID_STATUSES.has(status)) {
    throw new RangeError(`Invalid project task status: ${status}`);
  }
  return status;
}

function validProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw new RangeError("Task progress must be a number from 0 to 100");
  }
  return round(progress, 1);
}

function defaultProgress(status) {
  return status === "completed" ? 100 : 0;
}

function isStale(task, now, staleAfterDays) {
  if (task.status === "completed") return false;
  return Date.parse(now) - Date.parse(task.lastUpdate) > staleAfterDays * DAY_MS;
}

function taskReference(task) {
  return {
    workstreamId: task.workstreamId,
    workstreamName: task.workstreamName,
    taskId: task.id,
    taskName: task.name,
    owner: task.owner,
    status: task.status,
    progress: task.progress,
    lastUpdate: task.lastUpdate
  };
}

function normalizeTimestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function latestTimestamp(...values) {
  return values
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function uniqueStrings(values) {
  return [...new Set(array(values).map(text).filter(Boolean))];
}

function slug(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
