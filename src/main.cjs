const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { SettingsStore } = require("./settings-store.cjs");
const { UniFiClient, normalizeConsoleAddress } = require("./unifi-client.cjs");
const { processImage, FIT_MODES, TEMPLATES } = require("./image-processor.cjs");

const isDevelopment = !app.isPackaged;
const allowedImageExtensions = new Set([
  ".gif",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".avif",
  ".tif",
  ".tiff",
]);

let mainWindow;
let store;
let activeClient;
let preparedDirectory;

if (process.env.LOOPFRAME_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.LOOPFRAME_USER_DATA));
}

function profileSummary(profile) {
  return {
    id: profile.unique_id,
    name: profile.full_name || profile.alias || profile.username || "",
    username: profile.username || profile.email || "",
  };
}

function donationPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "donation.json")
    : path.join(__dirname, "..", "donation.json");
}

async function readDonation() {
  try {
    const raw = JSON.parse(await fs.readFile(donationPath(), "utf8"));
    const url = String(raw.url || "");
    const valid = /^https:\/\//i.test(url);
    return {
      enabled: Boolean(raw.enabled && valid),
      service: String(raw.service || "Donation"),
      label: String(raw.label || "Support this project"),
      url: valid ? url : "",
      placement: "footer",
      promptOnLaunch: false,
    };
  } catch {
    return {
      enabled: false,
      service: "",
      label: "Support this project",
      url: "",
      placement: "footer",
      promptOnLaunch: false,
    };
  }
}

async function connect(host, username, password) {
  const client = new UniFiClient(host);
  const profile = await client.login(username, password);
  const devices = await client.listDevices();
  if (!devices.length) {
    throw new Error("No compatible Access doorbell or display was found.");
  }
  activeClient = client;
  return {
    profile: profileSummary(profile),
    devices,
  };
}

async function ensureClient() {
  if (activeClient) return activeClient;
  const settings = await store.readSettings();
  const password = await store.readPassword();
  if (!settings.host || !settings.username || !password) {
    throw new Error("Open setup and sign in to the console first.");
  }
  await connect(settings.host, settings.username, password);
  return activeClient;
}

function assertPreparedPath(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(preparedDirectory) + path.sep)) {
    throw new Error("The prepared image path is outside the application workspace.");
  }
  return resolved;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 920,
    minHeight: 680,
    backgroundColor: "#f3f2ec",
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const allowed = safeExternalUrl(url);
    if (allowed) shell.openExternal(allowed);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const local = pathToFileURL(path.join(__dirname, "renderer", "index.html")).toString();
    if (url !== local) {
      event.preventDefault();
      const allowed = safeExternalUrl(url);
      if (allowed) shell.openExternal(allowed);
    }
  });

  await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

function registerHandlers() {
  ipcMain.handle("settings:get", () => store.readSettings());
  ipcMain.handle("settings:save", async (_event, settings) => store.saveSettings(settings));
  ipcMain.handle("settings:remove-connection", async () => {
    activeClient = null;
    return store.removeConnection();
  });
  ipcMain.handle("settings:remove-all", async () => {
    activeClient = null;
    return store.removeAll();
  });
  ipcMain.handle("history:list", () => store.listHistory());
  ipcMain.handle("donation:get", () => readDonation());

  ipcMain.handle("console:connect", async (_event, credentials) => {
    const result = await connect(credentials.host, credentials.username, credentials.password);
    return result;
  });

  ipcMain.handle("console:refresh-devices", async () => {
    const client = await ensureClient();
    return {
      profile: profileSummary(await client.getProfile()),
      devices: await client.listDevices(),
    };
  });

  ipcMain.handle("console:test-saved", async () => {
    await ensureClient();
    return { ok: true };
  });

  ipcMain.handle("image:process", async (_event, payload) => {
    if (!payload?.sourcePath) throw new Error("Choose an image first.");
    const extension = path.extname(payload.sourcePath).toLowerCase();
    if (!allowedImageExtensions.has(extension)) {
      throw new Error("Choose a GIF, PNG, JPEG, WebP, AVIF, or TIFF image.");
    }
    const stat = await fs.stat(payload.sourcePath);
    if (stat.size > 80 * 1024 * 1024) {
      throw new Error("The selected image is larger than 80 MB.");
    }
    const stamp = Date.now();
    const outputPath = path.join(preparedDirectory, `loopframe-${stamp}.gif`);
    const result = await processImage(payload.sourcePath, payload.options || {});
    await fs.writeFile(outputPath, result.buffer);
    return {
      path: outputPath,
      digest: result.digest,
      preview: result.preview,
      source: result.source,
      output: result.output,
      options: result.options,
    };
  });

  ipcMain.handle("publish:apply", async (_event, payload) => {
    const client = await ensureClient();
    const preparedPath = assertPreparedPath(payload.preparedPath);
    const settings = await store.readSettings();
    const deviceId = payload.deviceId || settings.deviceId;
    if (!deviceId) throw new Error("Choose a compatible device first.");
    const backup = await client.captureBackground(deviceId);
    const uploaded = await client.publish(deviceId, preparedPath, backup);
    const record = {
      ...backup,
      uploadedPath: uploaded.uploadedPath,
      preparedDigest: payload.digest,
      sourceName: payload.sourceName || path.basename(preparedPath),
      preview: payload.preview || "",
    };
    const backupPath = await store.saveBackup(record);
    await store.addHistory({
      deviceId,
      deviceName: backup.deviceName,
      sourceName: record.sourceName,
      digest: record.preparedDigest,
      status: "published",
    });
    return { ...record, backupPath };
  });

  ipcMain.handle("publish:restore", async (_event, backup) => {
    const client = await ensureClient();
    if (!backup?.deviceId || !backup?.backupPath) {
      throw new Error("The rollback record is incomplete.");
    }
    const restored = await client.restore(backup.deviceId, backup, backup.uploadedPath);
    if (!restored) throw new Error("The original background could not be verified after restore.");
    await store.removeBackup(backup.backupPath);
    await store.addHistory({
      deviceId: backup.deviceId,
      deviceName: backup.deviceName,
      sourceName: backup.sourceName || "",
      digest: backup.preparedDigest || "",
      status: "restored",
    });
    return { ok: true };
  });

  ipcMain.handle("backups:list", () => store.listBackups());
  ipcMain.handle("external:open", async (_event, value) => {
    const url = safeExternalUrl(value);
    if (!url) throw new Error("Only secure web links can be opened.");
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("meta:get", () => ({
    version: app.getVersion(),
    platform: process.platform,
    credentialVault: safeStorage.isEncryptionAvailable(),
    fits: FIT_MODES,
    templates: TEMPLATES,
  }));
}

app.whenReady().then(async () => {
  store = new SettingsStore(app.getPath("userData"), safeStorage);
  await store.initialize();
  preparedDirectory = path.join(app.getPath("temp"), "loopframe-prepared");
  await fs.mkdir(preparedDirectory, { recursive: true });
  registerHandlers();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});
