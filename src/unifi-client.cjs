const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const FormData = require("form-data");

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
  if (node.unique_id && (node.is_camera === true || hasBackgroundControls)) {
    devices.push(node);
  }
  for (const value of Object.values(node)) collectDevices(value, devices);
  return devices;
}

function configValue(device, key) {
  const item = (device?.configs || []).find((entry) => entry.key === key);
  return item ? item.value : null;
}

function publicDevice(device) {
  return {
    id: device.unique_id,
    name: device.name || device.alias || device.device_type || "Access device",
    type: device.device_type || "",
    model: device.model || device.model_name || "",
    firmware: device.firmware || device.firmware_version || "",
    connected: Boolean(device.is_connected),
    hasBackground: Boolean(configValue(device, "bg")),
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

  async listDevices() {
    const devices = await this.getTopology();
    return devices.map(publicDevice);
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
  collectDevices,
  configValue,
};
