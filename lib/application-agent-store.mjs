import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { emptyAgentState, normalizeAgentState } from "./application-agent.mjs";

export class ApplicationAgentStore {
  constructor(path) {
    this.path = path;
    this.writeChain = Promise.resolve();
  }

  async read() {
    try {
      return normalizeAgentState(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return emptyAgentState();
      throw error;
    }
  }

  async write(nextState, expectedRevision = null) {
    const operation = async () => {
      const current = await this.read();
      if (expectedRevision !== null && Number(expectedRevision) !== current.revision) {
        const error = new Error("application agent revision conflict");
        error.code = "REVISION_CONFLICT";
        error.current = current;
        throw error;
      }
      const payload = normalizeAgentState({
        ...nextState,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString()
      });
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
