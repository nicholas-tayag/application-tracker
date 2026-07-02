import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeTracker } from "./tracker-core.mjs";

export class TrackerStore {
  constructor(path) {
    this.path = path;
    this.writeChain = Promise.resolve();
  }

  async read() {
    try {
      const payload = JSON.parse(await readFile(this.path, "utf8"));
      return {
        revision: Number(payload.revision || 0),
        tracker: normalizeTracker(payload.tracker),
        updatedAt: String(payload.updatedAt || "")
      };
    } catch (error) {
      if (error.code === "ENOENT") return { revision: 0, tracker: {}, updatedAt: "" };
      throw error;
    }
  }

  async write(tracker, expectedRevision = null) {
    const operation = async () => {
      const current = await this.read();
      if (expectedRevision !== null && Number(expectedRevision) !== current.revision) {
        const error = new Error("tracker revision conflict");
        error.code = "REVISION_CONFLICT";
        error.current = current;
        throw error;
      }
      const payload = {
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        tracker: normalizeTracker(tracker)
      };
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        await rename(temporary, this.path);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      return payload;
    };
    const result = this.writeChain.then(operation, operation);
    this.writeChain = result.catch(() => {});
    return result;
  }
}
