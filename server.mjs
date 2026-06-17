import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4177);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function isPathInsideRoot(candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function decodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

const handler = (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${currentPort}`);
  const decodedPath = url.pathname === "/" ? "/index.html" : decodePathname(url.pathname);
  if (!decodedPath) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }
  const requested = decodedPath;
  const file = normalize(join(root, requested));

  if (!isPathInsideRoot(file) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": types[extname(file)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(file).pipe(res);
};

let currentPort = port;

async function startServer(startPort, maxAttempts = 10) {
  let p = startPort;
  for (let i = 0; i < maxAttempts; i++) {
    const server = createServer(handler);
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(p, () => resolve(server));
      });
      currentPort = p;
      console.log(`Application tracker running at http://localhost:${p}`);
      return;
    } catch (err) {
      if (err && err.code === "EADDRINUSE") {
        server.close();
        console.warn(`Port ${p} in use, trying port ${p + 1}...`);
        p += 1;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`No available ports found starting at ${startPort}`);
}

startServer(port).catch((err) => {
  console.error(err);
  process.exit(1);
});
