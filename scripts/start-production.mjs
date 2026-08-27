import { spawn } from "node:child_process";
import { resolve } from "node:path";

const nextCli = resolve("node_modules/next/dist/bin/next");
const webArguments = ["start"];
const children = [
  spawn(process.execPath, [nextCli, ...webArguments], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, ["dist/ai-worker.js"], { stdio: "inherit", env: process.env }),
];
let stopping = false;

function stopAll(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopAll(signal);
    setTimeout(() => process.exit(0), 35_000).unref();
  });
}

for (const child of children) {
  child.once("error", () => {
    process.exitCode = 1;
    stopAll();
  });
  child.once("exit", (code, signal) => {
    if (stopping) {
      if (children.every((item) => item.exitCode !== null || item.killed)) process.exit();
      return;
    }
    process.exitCode = code === 0 && !signal ? 1 : code ?? 1;
    stopAll();
  });
}
