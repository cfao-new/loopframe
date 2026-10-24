import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import gifenc from "gifenc";

const { GIFEncoder, applyPalette, quantize } = gifenc;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const screenshotDirectory = path.join(projectRoot, "docs", "screenshots");
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "loopframe-ui-"));
const userData = path.join(temporaryDirectory, "profile");
const sourcePath = path.join(temporaryDirectory, "smoke-source.gif");
const donationPath = path.join(temporaryDirectory, "donation.json");

function makeSourceFrame(width, height, color) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      rgba[index] = x < width / 2 ? color[0] : 240;
      rgba[index + 1] = y < height / 2 ? color[1] : 214;
      rgba[index + 2] = color[2];
      rgba[index + 3] = 255;
    }
  }
  return rgba;
}

async function createSourceGif() {
  const encoder = GIFEncoder();
  for (const color of [[24, 110, 82], [38, 78, 126], [178, 92, 56]]) {
    const rgba = makeSourceFrame(120, 240, color);
    const palette = quantize(rgba, 64);
    encoder.writeFrame(applyPalette(rgba, palette), 120, 240, {
      palette,
      delay: 120,
      repeat: 0,
    });
  }
  encoder.finish();
  await fs.writeFile(sourcePath, Buffer.from(encoder.bytes()));
}

async function createMockConsole() {
  const events = [];
  let currentBg = "backgrounds/original.png";
  let currentBgs = "backgrounds/original.png";
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url, "http://127.0.0.1");
    events.push({ method: request.method, path: url.pathname });

    const send = (status, value, headers = {}) => {
      response.writeHead(status, { "Content-Type": "application/json", ...headers });
      response.end(JSON.stringify(value));
    };

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      send(200, {
        unique_id: "session-user",
        full_name: "Loopframe Test",
        username: "loopframe-test",
      }, {
        "Set-Cookie": "TOKEN=test-token; Path=/",
        "X-CSRF-Token": "test-csrf",
      });
      return;
    }
    if (url.pathname === "/api/users/self") {
      send(200, {
        unique_id: "session-user",
        full_name: "Loopframe Test",
        username: "loopframe-test",
      });
      return;
    }
    if (url.pathname === "/proxy/access/api/v2/devices/topology4") {
      send(200, {
        code: 1,
        data: [{
          unique_id: "doorbell-1",
          name: "Front door",
          device_type: "UVC G6 Pro Entry",
          model: "G6 Pro Entry",
          firmware: "5.5.43",
          is_camera: true,
          is_connected: true,
          configs: [
            { key: "bg", value: currentBg },
            { key: "bgs", value: currentBgs },
          ],
        }],
      });
      return;
    }
    if (url.pathname === "/proxy/access/api/v2/device/doorbell-1/resources") {
      assert.match(body.toString("utf8"), /filename="loopframe-/);
      send(200, { code: 1, data: { filepath: "backgrounds/loopframe.gif" } });
      return;
    }
    if (url.pathname === "/proxy/access/api/v2/device/doorbell-1/settings") {
      const settings = JSON.parse(body.toString("utf8"));
      currentBg = settings.find((entry) => entry.key === "bg").value;
      currentBgs = settings.find((entry) => entry.key === "bgs").value;
      send(200, { code: 1 });
      return;
    }
    if (url.pathname === "/proxy/access/api/v2/device/doorbell-1/resources/bgs") {
      const filename = url.searchParams.get("filename");
      currentBgs = currentBgs.split(",").filter((item) => item !== filename).join(",");
      send(200, { code: 1 });
      return;
    }
    send(404, { code: 0, msg: "not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    events,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function waitForRender(page) {
  await page.waitForFunction(
    () => {
      const ready = document.querySelector("#preview-status")?.textContent.includes("Ready to review");
      const digest = document.querySelector("#preview-digest")?.textContent || "";
      return ready && digest.startsWith("SHA-256");
    },
    { timeout: 20000 },
  );
  return page.locator("#preview-digest").textContent();
}

async function overflow(page) {
  return page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
}

async function captureWindow(electronApp, filePath) {
  const base64 = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const image = await window.webContents.capturePage();
    return image.toPNG().toString("base64");
  });
  await fs.writeFile(filePath, Buffer.from(base64, "base64"));
}

await createSourceGif();
await fs.mkdir(screenshotDirectory, { recursive: true });
await fs.writeFile(donationPath, JSON.stringify({
  enabled: true,
  service: "Ko-fi",
  label: "Support this project",
  url: "https://example.com/support",
  placement: "footer",
  promptOnLaunch: false,
}, null, 2));
const mock = await createMockConsole();
let electronApp;

try {
  electronApp = await electron.launch({
    executablePath: path.join(
      projectRoot,
      "node_modules",
      "electron",
      "dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [projectRoot, "--disable-gpu"],
    env: {
      ...process.env,
      LOOPFRAME_USER_DATA: userData,
      LOOPFRAME_DONATION_FILE: donationPath,
    },
  });
  const page = await electronApp.firstWindow();
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
  await page.waitForTimeout(300);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.locator("#setup-form").waitFor();
  await captureWindow(electronApp, path.join(screenshotDirectory, "setup.png"));

  const fitCount = await page.locator("#fit-grid .fit-option").count();
  if (fitCount !== 6) {
    console.log(JSON.stringify({
      errors,
      body: (await page.locator("body").innerText()).slice(0, 4000),
    }, null, 2));
  }
  assert.equal(fitCount, 6);
  assert.equal(await page.locator("#template-grid .template-option").count(), 5);
  assert.equal(await page.locator("#open-people").getAttribute("aria-disabled"), "true");
  assert.equal(await page.locator("#donation-link").isVisible(), true);
  assert.equal(await page.locator("#donation-link").getAttribute("href"), "https://example.com/support");

  await page.locator("#setup-host").fill(mock.origin);
  await page.locator("#setup-user").fill("loopframe-test");
  await page.locator("#setup-password").fill("test-password");
  assert.match(await page.locator("#open-people").getAttribute("data-url"), /\/network\/default\/admins$/);

  await page.locator("#find-devices").click();
  await page.locator(".device-option").waitFor();
  assert.equal(await page.locator(".device-option").count(), 1);
  await page.locator("#finish-setup").click();
  await page.locator("#studio-view.is-active").waitFor();

  const desktopOverflow = await overflow(page);
  assert.equal(desktopOverflow.overflow, false);

  await page.locator("#file-input").setInputFiles(sourcePath);
  await page.locator("#output-preview").waitFor({ state: "visible" });
  let digest = await waitForRender(page);
  await page.locator('[data-fit="fill"]').click();
  digest = await waitForRender(page);
  await page.locator('[data-template="soft-bottom"]').click();
  digest = await waitForRender(page);
  await captureWindow(electronApp, path.join(screenshotDirectory, "studio.png"));
  assert.equal(await page.locator("#review-publish").isEnabled(), true);

  for (const fit of ["contain", "width", "height", "original", "stretch"]) {
    await page.locator(`[data-fit="${fit}"]`).click();
    digest = await waitForRender(page);
  }
  for (const template of ["none", "soft-bottom", "soft-top", "vignette", "focus-frame"]) {
    await page.locator(`[data-template="${template}"]`).click();
    digest = await waitForRender(page);
  }

  await page.locator("#zoom").fill("140");
  digest = await waitForRender(page);
  await page.locator("#offset-x").fill("-50");
  digest = await waitForRender(page);
  await page.locator("#offset-y").fill("35");
  digest = await waitForRender(page);
  await page.locator("#background-color").fill("#23362c");
  digest = await waitForRender(page);
  await page.locator("#center-image").click();
  digest = await waitForRender(page);

  await page.locator("#review-publish").click();
  await page.locator("#publish-dialog").waitFor({ state: "visible" });
  await page.locator("#confirm-publish").click();
  await page.getByText("The GIF is active on the selected device.").waitFor();

  await page.locator('[data-view-target="settings"]').click();
  await page.locator("#settings-view.is-active").waitFor();
  await page.locator("#backup-list .backup-item").waitFor();
  await captureWindow(electronApp, path.join(screenshotDirectory, "settings.png"));
  await page.locator("#backup-list [data-restore-index]").click();
  await page.getByText("The previous background was restored.").waitFor();
  await page.getByText("No pending rollback records.").waitFor();

  const settingsOverflow = await overflow(page);
  assert.equal(settingsOverflow.overflow, false);
  await page.setViewportSize({ width: 430, height: 932 });
  const mobileOverflow = await overflow(page);
  assert.equal(mobileOverflow.overflow, false);
  await page.locator('[data-view-target="studio"]').click();
  await page.locator("#studio-view.is-active").waitFor();
  await captureWindow(electronApp, path.join(screenshotDirectory, "studio-mobile.png"));

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.locator('[data-view-target="settings"]').click();
  await page.locator("#settings-view.is-active").waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#remove-connection").click();
  await page.locator("#setup-view.is-active").waitFor();
  await page.locator('[data-view-target="settings"]').click();
  await page.locator("#settings-view.is-active").waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#remove-all").click();
  await page.locator("#setup-view.is-active").waitFor();

  assert.deepEqual(errors, []);
  assert.ok(mock.events.some((event) => event.method === "POST" && event.path.endsWith("/resources")));
  assert.ok(mock.events.some((event) => event.method === "DELETE"));

  console.log(JSON.stringify({
    status: "passed",
    fitModes: 6,
    templates: 5,
    publish: true,
    restore: true,
    removeConnection: true,
    removeAllData: true,
    donationSlot: true,
    desktopWidth: desktopOverflow.width,
    mobileWidth: mobileOverflow.width,
  }, null, 2));
} finally {
  if (electronApp) await electronApp.close();
  await mock.close();
  await fs.rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
