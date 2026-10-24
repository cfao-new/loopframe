const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { SettingsStore } = require("./settings-store.cjs");
const { FIT_MODES, TEMPLATES } = require("./image-options.cjs");

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
let activeProtectClient;
let preparedDirectory;
let artworkCacheDirectory;
let imageProcessor;
let networkRuntime;

if (process.env.LOOPFRAME_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.LOOPFRAME_USER_DATA));
}

function getImageProcessor() {
  if (!imageProcessor) imageProcessor = require("./image-processor.cjs");
  return imageProcessor;
}

function getNetworkRuntime() {
  if (!networkRuntime) {
    networkRuntime = {
      ...require("./unifi-client.cjs"),
      ...require("./protect-client.cjs"),
    };
  }
  return networkRuntime;
}

async function ensurePreparedDirectory() {
  if (!preparedDirectory) {
    preparedDirectory = path.join(app.getPath("temp"), "loopframe-prepared");
  }
  await fs.mkdir(preparedDirectory, { recursive: true });
  return preparedDirectory;
}

function profileSummary(profile) {
  return {
    id: profile.unique_id,
    name: profile.full_name || profile.alias || profile.username || "",
    username: profile.username || profile.email || "",
  };
}

function donationPath() {
  if (process.env.LOOPFRAME_DONATION_FILE) {
    return path.resolve(process.env.LOOPFRAME_DONATION_FILE);
  }
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

function mergeDiscoveredDevices(accessDevices, protectDevices) {
  const merged = [...accessDevices];
  for (const device of protectDevices) {
    const existing = merged.find((item) => item.deviceId === device.deviceId);
    if (!existing) {
      merged.push(device);
    } else if (
      existing.upload?.status === "unsupported" &&
      device.upload?.status !== "unsupported"
    ) {
      merged[merged.indexOf(existing)] = device;
    }
  }
  return merged;
}

async function accessDevicesFor(client, experimental) {
  try {
    return {
      devices: await client.listDevices({ experimental }),
      status: { state: "connected", message: "Access discovery is available." },
    };
  } catch (error) {
    if (experimental && [401, 403].includes(error.status)) {
      return {
        devices: [],
        status: {
          state: "permission-required",
          message: "This account cannot read Access devices.",
        },
      };
    }
    throw error;
  }
}

async function protectDevicesFor(client) {
  const protect = new (getNetworkRuntime().ProtectClient)(client);
  const devices = await protect.listDevices();
  activeProtectClient = protect;
  return devices;
}

async function connect(host, username, password, options = {}) {
  const client = new (getNetworkRuntime().UniFiClient)(host);
  const profile = await client.login(username, password);
  activeClient = client;
  activeProtectClient = null;
  const experimental = Boolean(options.experimentalScreenDevices);
  const access = await accessDevicesFor(client, experimental);
  let protect = [];
  let protectStatus = {
    state: experimental ? "not-connected" : "disabled",
    message: experimental
      ? "Protect discovery has not been checked."
      : "Experimental screen discovery is disabled.",
  };
  if (experimental) {
    try {
      protect = await protectDevicesFor(client);
      protectStatus = {
        state: "connected",
        message: "Protect discovery is available with this account.",
      };
    } catch (error) {
      try {
        const settings = await store.readSettings();
        const protectClient = await ensureProtectClient(settings);
        protect = protectClient ? await protectClient.listDevices() : [];
        protectStatus = {
          state: "connected",
          message: "Protect discovery is available.",
        };
      } catch (fallbackError) {
        activeProtectClient = null;
        protectStatus = {
          state: [401, 403].includes(fallbackError.status)
            ? "permission-required"
            : "error",
          message: [401, 403].includes(fallbackError.status)
            ? "This account does not have Protect access. Add a Protect sign in in Settings."
            : fallbackError.message,
        };
      }
    }
  }
  const devices = mergeDiscoveredDevices(access.devices, protect);
  if (!devices.length && access.status.state === "connected") {
    throw new Error("No compatible Access or Protect screen device was found.");
  }
  return {
    profile: profileSummary(profile),
    devices,
    accessStatus: access.status,
    protectStatus,
  };
}

async function ensureClient() {
  if (activeClient) return activeClient;
  const settings = await store.readSettings();
  const password = await store.readPassword();
  if (!settings.host || !settings.username || !password) {
    throw new Error("Open setup and sign in to the console first.");
  }
  await connect(
    settings.host,
    settings.username,
    password,
    { experimentalScreenDevices: settings.experimentalScreenDevices },
  );
  return activeClient;
}

async function ensureProtectClient(settings, { allowAccessSession = true } = {}) {
  if (activeProtectClient) return activeProtectClient;
  let sessionError = null;
  if (allowAccessSession && activeClient) {
    try {
      const protect = new (getNetworkRuntime().ProtectClient)(activeClient);
      await protect.getBootstrap();
      activeProtectClient = protect;
      return protect;
    } catch (error) {
      sessionError = error;
    }
  }
  let consoleClient = null;
  if (settings.protectHost && settings.protectUsername) {
    const password = await store.readProtectPassword();
    if (password) {
      consoleClient = new (getNetworkRuntime().UniFiClient)(settings.protectHost);
      await consoleClient.login(settings.protectUsername, password);
    }
  }
  if (!consoleClient) {
    if (sessionError) throw sessionError;
    return null;
  }
  const protect = new (getNetworkRuntime().ProtectClient)(consoleClient);
  await protect.getBootstrap();
  activeProtectClient = protect;
  return protect;
}

async function discoverSavedDevices() {
  const settings = await store.readSettings();
  const client = await ensureClient();
  const experimental = Boolean(settings.experimentalScreenDevices);
  const access = await accessDevicesFor(client, experimental);
  let protect = [];
  let protectStatus = {
    state: experimental ? "not-connected" : "disabled",
    message: experimental
      ? "Protect discovery is not connected."
      : "Experimental screen discovery is disabled.",
  };
  if (experimental) {
    try {
      const protectClient = await ensureProtectClient(settings);
      if (protectClient) {
        protect = await protectClient.listDevices();
        protectStatus = {
          state: "connected",
          message: "Protect discovery is available.",
        };
      }
    } catch (error) {
      activeProtectClient = null;
      protectStatus = {
        state: [401, 403].includes(error.status) ? "permission-required" : "error",
        message: [401, 403].includes(error.status)
          ? "This account cannot read Protect devices. Add a separate Protect sign in in Settings."
          : error.message,
      };
    }
  }
  return {
    profile: profileSummary(await client.getProfile()),
    devices: mergeDiscoveredDevices(access.devices, protect),
    accessStatus: access.status,
    protectStatus,
  };
}

async function connectProtect(credentials) {
  const { normalizeConsoleAddress } = getNetworkRuntime();
  const settings = await store.readSettings();
  const host = normalizeConsoleAddress(credentials.host || settings.host);
  if (!settings.host) {
    throw new Error("Connect the Access console first.");
  }
  if (host !== normalizeConsoleAddress(settings.host)) {
    throw new Error("Protect must use the same UniFi console address.");
  }
  const client = new (getNetworkRuntime().UniFiClient)(host);
  await client.login(credentials.username, credentials.password);
  const protect = new (getNetworkRuntime().ProtectClient)(client);
  const devices = await protect.listDevices();
  activeProtectClient = protect;
  await store.saveProtectConnection({
    host,
    username: credentials.username,
    password: credentials.password,
    rememberSignIn: Boolean(credentials.rememberSignIn),
  });
  return {
    devices,
    protectStatus: {
      state: "connected",
      message: "Protect discovery is available.",
    },
  };
}

function assertPreparedPath(filePath) {
  if (!preparedDirectory) {
    throw new Error("Prepare an image before publishing.");
  }
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(preparedDirectory) + path.sep)) {
    throw new Error("The prepared image path is outside the application workspace.");
  }
  return resolved;
}

async function clearArtworkCache() {
  await fs.rm(artworkCacheDirectory, { recursive: true, force: true });
  await fs.mkdir(artworkCacheDirectory, { recursive: true });
}

async function readCachedArtwork(cacheKey, artworkUrl) {
  const digest = crypto.createHash("sha256").update(String(cacheKey)).digest("hex");
  const cachePath = path.join(artworkCacheDirectory, `${digest}.json`);
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (cached.url === artworkUrl && cached.dataUrl) return cached;
  } catch {
    // A missing or stale cache entry is rebuilt from the authenticated console.
  }
  return null;
}

async function writeCachedArtwork(cacheKey, artwork) {
  const digest = crypto.createHash("sha256").update(String(cacheKey)).digest("hex");
  const cachePath = path.join(artworkCacheDirectory, `${digest}.json`);
  await fs.mkdir(artworkCacheDirectory, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(artwork), "utf8");
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

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow?.isDestroyed()) mainWindow.show();
  });
  await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
  }
}

function registerHandlers() {
  ipcMain.handle("settings:get", () => store.readSettings());
  ipcMain.handle("settings:save", async (_event, settings) => store.saveSettings(settings));
  ipcMain.handle("settings:set-experimental", async (_event, enabled) => {
    if (!enabled) activeProtectClient = null;
    return store.setExperimentalScreenDevices(Boolean(enabled));
  });
  ipcMain.handle("settings:remove-connection", async () => {
    activeClient = null;
    activeProtectClient = null;
    await clearArtworkCache();
    return store.removeConnection();
  });
  ipcMain.handle("settings:remove-all", async () => {
    activeClient = null;
    activeProtectClient = null;
    await clearArtworkCache();
    return store.removeAll();
  });
  ipcMain.handle("history:list", () => store.listHistory());
  ipcMain.handle("donation:get", () => readDonation());

  ipcMain.handle("console:connect", async (_event, credentials) => {
    const settings = await store.readSettings();
    const result = await connect(
      credentials.host,
      credentials.username,
      credentials.password,
      { experimentalScreenDevices: settings.experimentalScreenDevices },
    );
    return result;
  });

  ipcMain.handle("console:refresh-devices", () => discoverSavedDevices());

  ipcMain.handle("console:test-saved", async () => {
    await ensureClient();
    return { ok: true };
  });

  ipcMain.handle("protect:connect", async (_event, credentials) => {
    return connectProtect(credentials);
  });

  ipcMain.handle("device:artwork", async (_event, artworkUrl, cacheKey) => {
    const cached = await readCachedArtwork(cacheKey || artworkUrl, artworkUrl);
    if (cached) return { dataUrl: cached.dataUrl, bytes: cached.bytes };
    let artwork;
    if (activeProtectClient) {
      artwork = await activeProtectClient.getDeviceArtwork(artworkUrl);
    } else {
      const client = await ensureClient();
      artwork = await client.getDeviceArtwork(artworkUrl);
    }
    await writeCachedArtwork(cacheKey || artworkUrl, {
      url: artworkUrl,
      dataUrl: artwork.dataUrl,
      bytes: artwork.bytes,
    });
    return artwork;
  });

  ipcMain.handle("image:inspect", async (_event, sourcePath) => {
    if (!sourcePath) throw new Error("Choose an image first.");
    const extension = path.extname(sourcePath).toLowerCase();
    if (!allowedImageExtensions.has(extension)) {
      throw new Error("Choose a GIF, PNG, JPEG, WebP, AVIF, or TIFF image.");
    }
    const stat = await fs.stat(sourcePath);
    if (stat.size > 80 * 1024 * 1024) {
      throw new Error("The selected image is larger than 80 MB.");
    }
    return getImageProcessor().inspectImage(sourcePath);
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
    const outputDirectory = await ensurePreparedDirectory();
    const outputPath = path.join(outputDirectory, `loopframe-${stamp}.gif`);
    const result = await getImageProcessor().processImage(
      payload.sourcePath,
      payload.options || {},
    );
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
    const preparedPath = assertPreparedPath(payload.preparedPath);
    const settings = await store.readSettings();
    const deviceId = payload.deviceId;
    if (!deviceId) throw new Error("Choose a compatible device first.");
    let record;
    if (payload.transport === "protect-lcd") {
      const protect = await ensureProtectClient(settings);
      if (!protect) throw new Error("Connect Protect in Settings before publishing this device.");
      const backup = await protect.captureWelcome(deviceId);
      const uploaded = await protect.publish(deviceId, preparedPath, backup);
      record = {
        ...backup,
        transport: "protect-lcd",
        uploadedAsset: uploaded.uploadedAsset,
        preparedDigest: payload.digest,
        sourceName: payload.sourceName || path.basename(preparedPath),
        preview: payload.preview || "",
      };
    } else if (payload.transport === "access-background") {
      const client = await ensureClient();
      const backup = await client.captureBackground(deviceId);
      const uploaded = await client.publish(deviceId, preparedPath, backup);
      record = {
        ...backup,
        transport: "access-background",
        uploadedPath: uploaded.uploadedPath,
        preparedDigest: payload.digest,
        sourceName: payload.sourceName || path.basename(preparedPath),
        preview: payload.preview || "",
      };
    } else {
      throw new Error("This device does not expose a supported upload path.");
    }
    const backupPath = await store.saveBackup(record);
    await store.addHistory({
      deviceId,
      deviceName: record.deviceName,
      sourceName: record.sourceName,
      digest: record.preparedDigest,
      status: "published",
    });
    return { ...record, backupPath };
  });

  ipcMain.handle("publish:restore", async (_event, backup) => {
    if (!backup?.deviceId || !backup?.backupPath) {
      throw new Error("The rollback record is incomplete.");
    }
    let restored;
    if (backup.transport === "protect-lcd") {
      const settings = await store.readSettings();
      const protect = await ensureProtectClient(settings);
      if (!protect) throw new Error("Connect Protect before restoring this display.");
      restored = await protect.restore(backup.deviceId, backup.previousLcdMessage);
    } else {
      const client = await ensureClient();
      restored = await client.restore(backup.deviceId, backup, backup.uploadedPath);
    }
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
  artworkCacheDirectory = path.join(app.getPath("userData"), "artwork-cache");
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
