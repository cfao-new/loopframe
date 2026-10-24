const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const FormData = require("form-data");
const { findScreenDevice, screenForDevice } = require("./device-catalog.cjs");

function normalizeConsoleAddress(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("Enter the UniFi console address.");
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Enter a valid UniFi console address.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("The console address must use HTTP or HTTPS.");
  }
  return url.origin;
}

function responseText(response) {
  const decoder = new TextDecoder();
  return decoder.decode(response.body);
}

function responseJson(response) {
  if (!response.body.length) return null;
  const text = responseText(response);
  try {
    return JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw new Error(`The console returned HTTP ${response.status}.`);
    }
    throw new Error("The console returned an unexpected response.");
  }
}

function requestRaw(origin, pathname, options = {}) {
  const base = new URL(origin);
  const transport = base.protocol === "https:" ? https : http;
  const requestUrl = new URL(pathname, base);
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Length"] && !headers["content-length"]) {
    headers["Content-Length"] = Buffer.byteLength(options.body);
  }

  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: requestUrl.protocol,
        hostname: requestUrl.hostname,
        port: requestUrl.port || undefined,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        method: options.method || "GET",
        headers,
        rejectUnauthorized: false,
        timeout: options.timeout || 30000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: response.statusCode || 0,
            ok: (response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300,
            headers: response.headers,
            body,
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("The console request timed out.")));
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function requestMultipart(origin, pathname, form, options = {}) {
  const base = new URL(origin);
  const transport = base.protocol === "https:" ? https : http;
  const requestUrl = new URL(pathname, base);
  const headers = { ...form.getHeaders(), ...(options.headers || {}) };

  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: requestUrl.protocol,
        hostname: requestUrl.hostname,
        port: requestUrl.port || undefined,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        method: options.method || "POST",
        headers,
        rejectUnauthorized: false,
        timeout: options.timeout || 120000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: response.statusCode || 0,
            ok: (response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300,
            headers: response.headers,
            body,
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("The upload timed out.")));
    request.on("error", reject);
    form.pipe(request);
  });
}

function collectDevices(node, devices = []) {
  if (!node) return devices;
  if (Array.isArray(node)) {
    for (const item of node) collectDevices(item, devices);
    return devices;
  }
  if (typeof node !== "object") return devices;
  const configKeys = (node.configs || []).map((entry) => entry.key);
  const hasBackgroundControls = configKeys.includes("bg") && configKeys.includes("bgs");
  const hasCatalogScreen = Boolean(findScreenDevice(node));
  const hasDetectedScreen = Boolean(screenFromValue(node));
  if (
    node.unique_id &&
    (
      node.is_camera === true ||
      hasBackgroundControls ||
      hasCatalogScreen ||
      hasDetectedScreen
    )
  ) {
    devices.push(node);
  }
  for (const value of Object.values(node)) collectDevices(value, devices);
  return devices;
}

function configValue(device, key) {
  const item = (device?.configs || []).find((entry) => entry.key === key);
  return item ? item.value : null;
}

function screenFromValue(value, depth = 0) {
  if (!value || depth > 5) return null;
  if (typeof value === "string") {
    const match = value.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/i);
    return match
      ? { width: Number(match[1]), height: Number(match[2]), source: "device" }
      : null;
  }
  if (typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = screenFromValue(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const widthKey = Object.keys(value).find((key) =>
    /^(screen|display).*width$/i.test(key),
  );
  const heightKey = Object.keys(value).find((key) =>
    /^(screen|display).*height$/i.test(key),
  );
  if (widthKey && heightKey) {
    const width = Number(value[widthKey]);
    const height = Number(value[heightKey]);
    if (width >= 32 && height >= 32) {
      return { width, height, source: "device" };
    }
  }
  if (value.screen && typeof value.screen === "object") {
    const width = Number(value.screen.width);
    const height = Number(value.screen.height);
    if (width >= 32 && height >= 32) {
      return { width, height, source: "device" };
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (/camera|video/i.test(key)) continue;
    if (/screen|display/i.test(key)) {
      const found = screenFromValue(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function knownScreen(device) {
  return screenForDevice(device);
}

function artworkUrlFor(device) {
  const images = device?.images;
  if (!images || typeof images !== "object") return "";
  for (const size of ["xxl", "xl", "l", "m", "s", "xs"]) {
    const value = images[size];
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  }
  return "";
}

function highResolutionArtworkUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return "";
  return value.replace(/_(\d+)x(\d+)(\.(?:png|jpe?g|webp))$/i, "_512x512$3");
}

function artworkUrlsFor(device) {
  const images = device?.images;
  if (!images || typeof images !== "object") return [];
  const original = ["xxl", "xl", "l", "m", "s", "xs"]
    .map((size) => images[size])
    .find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) || "";
  const highResolution = highResolutionArtworkUrl(original);
  return [...new Set([highResolution, original].filter(Boolean))];
}

function accessUploadFor(entry, device) {
  const configKeys = new Set((device?.configs || []).map((item) => item.key));
  const required = entry?.upload?.requiredConfigKeys || [];
  const hasRequiredControls = required.every((key) => configKeys.has(key));
  if (!entry || !hasRequiredControls) {
    return {
      transport: "access-background",
      status: "unsupported",
      animated: "unsupported",
      reason: "This detected screen does not expose the Access background controls, so Loopframe can preview it but cannot publish it.",
    };
  }
  return { ...entry.upload };
}

function publicDevice(device) {
  const detectedScreen = screenFromValue(device);
  const entry = findScreenDevice(device);
  const screen = screenForDevice(device, detectedScreen);
  const artworkUrls = artworkUrlsFor(device);
  return {
    id: `access:${device.unique_id}`,
    deviceId: device.unique_id,
    sourceApp: "access",
    name: device.name || device.alias || device.device_type || "Access device",
    type: device.device_type || "",
    model: device.model || device.model_name || "",
    firmware: device.firmware || device.firmware_version || "",
    connected: Boolean(device.is_connected),
    hasBackground: Boolean(configValue(device, "bg")),
    screen,
    catalogId: entry?.id || null,
    artworkAspectRatio: entry?.artworkAspectRatio || 0.35,
    upload: accessUploadFor(entry, device),
    artworkUrl: artworkUrls[0] || artworkUrlFor(device),
    artworkFallbackUrl: artworkUrls[1] || "",
  };
}

class UniFiClient {
  constructor(host) {
    this.origin = normalizeConsoleAddress(host);
    this.session = null;
  }

  async login(username, password) {
    if (!username || !password) {
      throw new Error("Enter the local account name and password.");
    }
    const body = JSON.stringify({ username, password });
    const response = await requestRaw(this.origin, "/api/auth/login", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? "The console rejected the local account or password."
          : `Sign in failed with HTTP ${response.status}.`,
      );
    }

    const profile = responseJson(response);
    const cookies = response.headers["set-cookie"] || [];
    const tokenCookie = cookies.find((value) => /^TOKEN=/i.test(value));
    const token = tokenCookie?.match(/^TOKEN=([^;]+)/i)?.[1];
    if (!profile?.unique_id || !token) {
      throw new Error("The console did not return a usable local session.");
    }

    this.session = {
      token,
      csrf: response.headers["x-csrf-token"] || "",
      userId: profile.unique_id,
    };
    return this.getProfile();
  }

  headers(extra = {}) {
    if (!this.session) throw new Error("Sign in to the console first.");
    return {
      Cookie: `TOKEN=${this.session.token}`,
      "X-Token": this.session.token,
      "X-UserId": this.session.userId,
      "X-CSRF-Token": this.session.csrf,
      ...extra,
    };
  }

  async request(pathname, options = {}) {
    const response = await requestRaw(this.origin, pathname, {
      ...options,
      headers: this.headers(options.headers || {}),
    });
    const body = responseJson(response);
    if (!response.ok) {
      const message = body?.msg || body?.message || `HTTP ${response.status}`;
      const error = new Error(`UniFi request failed: ${message}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  async getProfile() {
    return this.request("/api/users/self");
  }

  async getTopology() {
    const body = await this.request("/proxy/access/api/v2/devices/topology4");
    return collectDevices(body?.data);
  }

  async listDevices(options = {}) {
    const devices = await this.getTopology();
    return devices
      .map(publicDevice)
      .filter((device) =>
        device.screen &&
        (options.experimental ||
          (device.hasBackground && device.upload?.status === "verified")),
      );
  }

  async getDeviceArtwork(value) {
    let target;
    try {
      target = new URL(value, this.origin);
    } catch {
      throw new Error("The device artwork address is invalid.");
    }
    const trustedStaticHost =
      target.protocol === "https:" &&
      target.hostname === "static.ui.com" &&
      target.pathname.startsWith("/fingerprint/ui/");
    const trustedConsole = target.origin === this.origin;
    if (!trustedStaticHost && !trustedConsole) {
      throw new Error("The device artwork address is not from UniFi.");
    }

    const response = await requestRaw(
      target.origin,
      `${target.pathname}${target.search}`,
      {
        timeout: 15000,
        headers: trustedConsole ? this.headers() : {},
      },
    );
    if (!response.ok) {
      throw new Error(`Device artwork download failed with HTTP ${response.status}.`);
    }
    const contentType = String(response.headers["content-type"] || "").split(";")[0].trim();
    if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(contentType)) {
      throw new Error("The console returned an invalid device artwork file.");
    }
    if (!response.body.length || response.body.length > 2 * 1024 * 1024) {
      throw new Error("The device artwork file is empty or too large.");
    }
    return {
      dataUrl: `data:${contentType};base64,${response.body.toString("base64")}`,
      bytes: response.body.length,
    };
  }

  async findDevice(deviceId) {
    const devices = await this.getTopology();
    const device = devices.find((item) => item.unique_id === deviceId);
    if (!device) throw new Error("The selected Access device was not found.");
    return device;
  }

  async captureBackground(deviceId) {
    const device = await this.findDevice(deviceId);
    return {
      deviceId,
      deviceName: device.name || "",
      previousBg: configValue(device, "bg"),
      previousBgs: configValue(device, "bgs"),
    };
  }

  async uploadBackground(deviceId, filePath) {
    if (!fs.existsSync(filePath)) throw new Error("The prepared GIF no longer exists.");
    const form = new FormData();
    form.append("type", "bgs");
    form.append("file", fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: "image/gif",
    });
    const response = await requestMultipart(
      this.origin,
      `/proxy/access/api/v2/device/${encodeURIComponent(deviceId)}/resources`,
      form,
      { headers: this.headers() },
    );
    const body = responseJson(response);
    if (!response.ok || body?.code !== 1 || !body?.data?.filepath) {
      throw new Error(body?.msg || `The console rejected the upload with HTTP ${response.status}.`);
    }
    return body.data.filepath;
  }

  async applyBackground(deviceId, background, backgrounds) {
    const payload = [
      { key: "bg", value: background, tag: "device_setting" },
      { key: "bgs", value: backgrounds, tag: "device_setting" },
    ];
    const body = await this.request(`/proxy/access/api/v2/device/${encodeURIComponent(deviceId)}/settings`, {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });
    if (body?.code !== 1) throw new Error(body?.msg || "The console rejected the background settings.");
  }

  async deleteBackground(deviceId, background) {
    const filename = encodeURIComponent(background);
    const body = await this.request(
      `/proxy/access/api/v2/device/${encodeURIComponent(deviceId)}/resources/bgs?filename=${filename}`,
      { method: "DELETE" },
    );
    if (body?.code !== 1) throw new Error(body?.msg || "The console rejected resource cleanup.");
  }

  async publish(deviceId, filePath, backup) {
    const uploadedPath = await this.uploadBackground(deviceId, filePath);
    const gallery = backup.previousBgs
      ? `${backup.previousBgs},${uploadedPath}`
      : uploadedPath;
    try {
      await this.applyBackground(deviceId, uploadedPath, gallery);
    } catch (error) {
      await this.deleteBackground(deviceId, uploadedPath).catch(() => {});
      throw error;
    }
    return { uploadedPath, backgrounds: gallery };
  }

  async restore(deviceId, backup, uploadedPath) {
    await this.applyBackground(deviceId, backup.previousBg, backup.previousBgs);
    if (uploadedPath) {
      await this.deleteBackground(deviceId, uploadedPath);
    }
    const current = await this.captureBackground(deviceId);
    return current.previousBg === backup.previousBg && current.previousBgs === backup.previousBgs;
  }
}

module.exports = {
  UniFiClient,
  normalizeConsoleAddress,
  requestRaw,
  requestMultipart,
  collectDevices,
  configValue,
  screenFromValue,
  knownScreen,
  artworkUrlFor,
  artworkUrlsFor,
  highResolutionArtworkUrl,
};
