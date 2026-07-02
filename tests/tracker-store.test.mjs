import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TrackerStore } from "../lib/tracker-store.mjs";

test("persists tracker state atomically with revisions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "application-tracker-"));
  try {
    const path = join(directory, "tracker.json");
    const store = new TrackerStore(path);
    assert.equal((await store.read()).revision, 0);
    const first = await store.write({ role: { status: "Applied" } }, 0);
    assert.equal(first.revision, 1);
    assert.equal((await store.read()).tracker.role.status, "Applied");
    await assert.doesNotReject(async () => JSON.parse(await readFile(path, "utf8")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects stale revisions instead of silently overwriting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "application-tracker-"));
  try {
    const store = new TrackerStore(join(directory, "tracker.json"));
    await store.write({ role: { status: "Applied" } }, 0);
    await assert.rejects(
      () => store.write({ role: { status: "Rejected" } }, 0),
      (error) => error.code === "REVISION_CONFLICT"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("serializes concurrent writes without corrupting JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "application-tracker-"));
  try {
    const path = join(directory, "tracker.json");
    const store = new TrackerStore(path);
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        store.write({ [`role-${index}`]: { status: "Saved" } })
      )
    );
    const payload = JSON.parse(await readFile(path, "utf8"));
    assert.equal(payload.revision, 25);
    assert.equal(Object.keys(payload.tracker).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
