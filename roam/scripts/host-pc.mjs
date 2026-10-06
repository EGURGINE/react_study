import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");

async function executableExists(filename) {
  try {
    if (!(await stat(filename)).isFile()) return false;
    await access(filename, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findCloudflared() {
  const name = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const configured = process.env.CLOUDFLARED_PATH;
  const candidates = configured
    ? [resolve(configured)]
    : [resolve(scriptDirectory, "../../.task-tools", name),
      ...(process.env.PATH || "").split(delimiter).filter(Boolean).map((directory) => join(directory, name))];
  for (const candidate of candidates) {
    if (await executableExists(candidate)) return candidate;
  }
  throw new Error(configured
    ? `CLOUDFLARED_PATH does not point to an executable file: ${configured}`
    : "cloudflared was not found. Set CLOUDFLARED_PATH, place it in ../../.task-tools, or add it to PATH.");
}

function checkPort(port) {
  return new Promise((resolveCheck, reject) => {
    const probe = createServer();
    probe.once("error", (error) => reject(new Error(error.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Stop the existing game server before running host:pc.`
      : `Cannot bind 127.0.0.1:${port}: ${error.message}`)));
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => probe.close(resolveCheck));
  });
}

function waitForServer(child, port) {
  return new Promise((ready, reject) => {
    let output = "";
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("close", onClose);
      child.off("error", onError);
    };
    const onData = (chunk) => {
      output = (output + chunk.toString()).slice(-4096);
      if (output.includes(`ROAM multiplayer server listening on port ${port}`)) {
        cleanup();
        ready();
      }
    };
    const onClose = () => { cleanup(); reject(new Error("The game server exited before becoming ready.")); };
    const onError = (error) => { cleanup(); reject(error); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("The game server did not become ready within 15 seconds.")); }, 15000);
    child.stdout.on("data", onData);
    child.once("close", onClose);
    child.once("error", onError);
  });
}

async function main() {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
  await checkPort(port);
  const cloudflared = await findCloudflared();
  const children = [];
  let stopping = false;
  let finish;
  const finished = new Promise((resolveFinished) => { finish = resolveFinished; });

  async function stop(code, message) {
    if (stopping) return finished;
    stopping = true;
    process.exitCode = code;
    if (message) console.error(`[host:pc] ${message}`);
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
    const force = setTimeout(() => {
      for (const { child } of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    }, 5000);
    force.unref();
    await Promise.all(children.map(({ closed }) => closed));
    clearTimeout(force);
    finish();
    return finished;
  }

  function launch(label, executable, args, environment, inspectOutput) {
    const child = spawn(executable, args, {
      cwd: projectDirectory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    const closed = new Promise((resolveClosed) => child.once("close", (code, signal) => {
      resolveClosed();
      if (!stopping) void stop(1, `${label} exited (${signal || code}). Stopping this hosting session.`);
    }));
    children.push({ child, closed });
    child.once("error", (error) => { void stop(1, `Could not start ${label}: ${error.message}`); });
    child.stdout.on("data", (chunk) => { process.stdout.write(chunk); inspectOutput?.(chunk); });
    child.stderr.on("data", (chunk) => { process.stderr.write(chunk); inspectOutput?.(chunk); });
    return child;
  }

  const onSignal = () => { void stop(0, "Stopping the game server and tunnel started by this session."); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    console.log(`[host:pc] Starting the game server at http://127.0.0.1:${port}`);
    const server = launch("game server", process.execPath, [join(projectDirectory, "server/index.js")], {
      ...process.env, HOST: "127.0.0.1", PORT: String(port),
    });
    await waitForServer(server, port);
    if (stopping) { await finished; return; }
    let tunnelOutput = "";
    let announced = false;
    launch("cloudflared", cloudflared, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], process.env, (chunk) => {
      if (announced) return;
      tunnelOutput = (tunnelOutput + chunk.toString()).slice(-8192);
      const match = tunnelOutput.match(/https:\/\/([a-z0-9-]+\.trycloudflare\.com)\b/i);
      if (!match) return;
      announced = true;
      console.log(`\nPUBLIC_HTTP_URL=https://${match[1]}`);
      console.log(`PUBLIC_WEBSOCKET_URL=wss://${match[1]}/ws`);
      console.log("[host:pc] Keep this command running. Ctrl+C stops this session; a new run gets a new public URL.");
    });
    await finished;
  } catch (error) {
    await stop(1, error.message);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

main().catch((error) => {
  console.error(`[host:pc] ${error.message}`);
  process.exitCode = 1;
});
