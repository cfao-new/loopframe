import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const executablePath = path.join(projectRoot, "dist", "win-unpacked", "Loopframe.exe");
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "loopframe-packaged-"));
let electronApp;

try {
  await fs.access(executablePath);
  electronApp = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      LOOPFRAME_USER_DATA: path.join(temporaryDirectory, "profile"),
    },
  });
  const page = await electronApp.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.locator("#setup-form").waitFor();
  const fitCount = await page.locator("#fit-grid .fit-option").count();
  if (fitCount !== 6) {
    console.log(JSON.stringify({
      errors,
      body: (await page.locator("body").innerText()).slice(0, 3000),
    }, null, 2));
  }
  assert.equal(fitCount, 6);
  assert.equal(await page.locator("#template-grid .template-option").count(), 5);
  assert.equal(await page.locator("#donation-link").isHidden(), true);
  const meta = await page.evaluate(() => window.loopframe.getMeta());
  assert.equal(meta.version, "1.0.0");
  assert.equal(meta.credentialVault, true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    status: "passed",
    executable: path.basename(executablePath),
    version: meta.version,
    credentialVault: meta.credentialVault,
  }, null, 2));
} finally {
  if (electronApp) await electronApp.close();
  await fs.rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
