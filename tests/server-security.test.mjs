import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

test("serves only public assets and keeps repository/private files inaccessible", async () => {
  const directory = await mkdtemp(join(tmpdir(), "application-tracker-server-"));
  const port = 43871;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(port),
      APPLICATION_TRACKER_PRIVATE_DIR: directory
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForServer(child, port);
    const publicResponse = await fetch(`http://127.0.0.1:${port}/index.html`);
    const gitResponse = await fetch(`http://127.0.0.1:${port}/.git/config`);
    const privateResponse = await fetch(
      `http://127.0.0.1:${port}/data/application-agent-state.json`
    );
    const apiResponse = await fetch(`http://127.0.0.1:${port}/api/application-agent`);
    assert.equal(publicResponse.status, 200);
    assert.equal(gitResponse.status, 404);
    assert.equal(privateResponse.status, 404);
    assert.equal(apiResponse.status, 200);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

function waitForServer(child, port) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server startup timed out")), 5000);
    const onData = (chunk) => {
      if (!String(chunk).includes(`localhost:${port}`)) return;
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      resolve();
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited early with code ${code}`));
    });
  });
}
