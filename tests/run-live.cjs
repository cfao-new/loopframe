const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const temporaryRoot = path.join(projectRoot, ".loopframe-test");
const child = spawn(process.execPath, [path.join(__dirname, "live-console.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", async (code, signal) => {
  try {
    await fs.rm(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 250,
    });
  } catch (error) {
    console.error(`Temporary test files could not be removed: ${error.message}`);
  }
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
