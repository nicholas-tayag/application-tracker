import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveOverallProgress,
  normalizeProjectStatus,
  summarizeProjectStatus,
  updateProjectTask
} from "../lib/project-status.mjs";

const NOW = "2026-06-22T12:00:00.000Z";

function registry(tasks) {
  return {
    project: "Application Tracker",
    workstreams: [{ id: "product", name: "Product", tasks }]
  };
}

test("normalizes an explicit checkpoint registry without claiming live introspection", () => {
  const result = normalizeProjectStatus(registry([{
    name: "UI integration",
    owner: "UI agent",
    status: "running",
    progress: 40,
    currentStep: "Connect status cards",
    lastUpdate: "2026-06-22T10:00:00Z"
  }]), { now: NOW });

  assert.equal(result.project, "Application Tracker");
  assert.equal(result.registryType, "explicit_checkpoint_registry");
  assert.equal(result.liveIntrospection, false);
  assert.equal(result.workstreams[0].tasks[0].id, "ui-integration");
});

test("enforces valid status transitions and completed task immutability", () => {
  const initial = registry([{
    id: "catalog",
    name: "Catalog refresh",
    status: "queued",
    progress: 0
  }]);
  const running = updateProjectTask(
    initial,
    { workstreamId: "product", taskId: "catalog" },
    { status: "running", progress: 60, currentStep: "Validate links" },
    { now: NOW }
  );
  const completed = updateProjectTask(
    running,
    { workstreamId: "product", taskId: "catalog" },
    {
      status: "completed",
      progress: 100,
      verificationSummary: "90 links returned HTTP 200",
      completedDeliverables: ["Catalog audit"]
    },
    { now: "2026-06-22T13:00:00Z" }
  );

  assert.equal(completed.workstreams[0].tasks[0].status, "completed");
  assert.throws(
    () => updateProjectTask(
      completed,
      { workstreamId: "product", taskId: "catalog" },
      { status: "running", progress: 80 },
      { now: "2026-06-22T14:00:00Z" }
    ),
    /cannot be reopened/
  );
});

test("rejects invalid progress and inconsistent completed progress", () => {
  assert.throws(
    () => normalizeProjectStatus(registry([{
      name: "Bad progress",
      status: "running",
      progress: 101
    }]), { now: NOW }),
    /0 to 100/
  );
  assert.throws(
    () => normalizeProjectStatus(registry([{
      name: "False completion",
      status: "completed",
      progress: 90
    }]), { now: NOW }),
    /must have progress 100/
  );
});

test("identifies stale active tasks but excludes completed tasks", () => {
  const summary = summarizeProjectStatus(registry([
    {
      name: "Old running task",
      status: "running",
      progress: 50,
      lastUpdate: "2026-06-10T00:00:00Z"
    },
    {
      name: "Old completed task",
      status: "completed",
      progress: 100,
      lastUpdate: "2026-06-01T00:00:00Z"
    }
  ]), { now: NOW, staleAfterDays: 7 });

  assert.deepEqual(summary.staleTasks.map((task) => task.taskId), ["old-running-task"]);
});

test("summarizes completed deliverables and verification", () => {
  const summary = summarizeProjectStatus(registry([{
    name: "Security hardening",
    owner: "Integration agent",
    status: "completed",
    progress: 100,
    verificationSummary: "Traversal and private-file tests pass",
    completedDeliverables: ["Static allowlist", "Private state relocation"]
  }]), { now: NOW });

  assert.equal(summary.counts.completed, 1);
  assert.deepEqual(
    summary.completedDeliverables.map((item) => item.deliverable),
    ["Static allowlist", "Private state relocation"]
  );
  assert.equal(summary.overallProgress, 100);
});

test("reports blocked tasks whether status or blocker text marks the risk", () => {
  const summary = summarizeProjectStatus(registry([
    {
      name: "Browser extension",
      status: "blocked",
      progress: 25,
      blocker: "Manifest permissions need review"
    },
    {
      name: "Resume import",
      status: "running",
      progress: 70,
      blocker: "Waiting for a user-provided resume"
    }
  ]), { now: NOW });

  assert.equal(summary.counts.blocked, 1);
  assert.equal(summary.blockers.length, 2);
  assert.match(summary.blockers[1].blocker, /user-provided resume/);
});

test("derives overall progress as an equal-weight task average", () => {
  assert.equal(deriveOverallProgress(registry([
    { name: "One", progress: 25 },
    { name: "Two", progress: 50 },
    { name: "Three", progress: 100, status: "completed" }
  ])), 58.3);
  assert.equal(deriveOverallProgress({ workstreams: [] }), 0);
});
