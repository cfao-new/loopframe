const fs = require("node:fs");
const path = require("node:path");
const FormData = require("form-data");
const {
  requestMultipart,
  screenFromValue,
  artworkUrlsFor,
} = require("./unifi-client.cjs");
const { findScreenDevice, screenForDevice } = require("./device-catalog.cjs");

function protectUploadFor(entry, camera) {
  if (!camera?.featureFlags?.hasLcdScreen) {
    return {
      transport: null,
      status: "unsupported",
      animated: "unsupported",
      reason: "Protect does not report an LCD screen for this detected device.",
    };
  }
  if (entry?.upload?.transport !== "protect-lcd") {
    return {
      transport: null,
      status: "unsupported",
      animated: "unsupported",
      reason: "No supported Protect welcome display upload path is known for this model.",
    };
  }
  return { ...entry.upload };
}

function publicProtectDevice(camera) {
  const hasScreen = Boolean(
    camera?.featureFlags?.hasLcdScreen ||
    camera?.featureFlags?.hasColorLcdScreen,
  );
  if (!hasScreen) return null;
  const entry = findScreenDevice(camera);
  const detectedScreen = screenFromValue(camera.featureFlags) || screenFromValue(camera);
  const screen = screenForDevice(camera, detectedScreen);
  if (!screen) return null;
  const artworkUrls = artworkUrlsFor(camera);
  return {
    id: `protect:${camera.id}`,
    deviceId: camera.id,
    sourceApp: "protect",
    name: camera.name || camera.displayName || camera.marketName || "Protect device",
    type: camera.type || "",
    model: camera.marketName || camera.model || camera.type || "",
    firmware: camera.firmwareVersion || "",
    connected: camera.state === "CONNECTED",
    hasBackground: false,
    screen,
    catalogId: entry?.id || null,
    artworkAspectRatio: entry?.artworkAspectRatio || 0.35,
    upload: protectUploadFor(entry, camera),
    artworkUrl: artworkUrls[0] || "",
    artworkFallbackUrl: artworkUrls[1] || "",
    protectLcd: camera.lcdMessage || {},
  };
}

function uploadedFile(body) {
  const value = body?.data || body;
  if (!value?.name || !value?.path) {
    throw new Error("Protect did not return a usable device asset.");
  }
  return value;
}

class ProtectClient {
  constructor(consoleClient) {
    if (!consoleClient?.session) {
      throw new Error("Sign in to the console before connecting Protect.");
    }
    this.console = consoleClient;
    this.origin = consoleClient.origin;
  }

  async getBootstrap() {
    return this.console.request("/proxy/protect/api/bootstrap");
  }

  async listDevices() {
    const bootstrap = await this.getBootstrap();
    return (bootstrap?.cameras || [])
      .map(publicProtectDevice)
      .filter(Boolean);
  }

  async getCamera(deviceId) {
    return this.console.request(
      `/proxy/protect/api/cameras/${encodeURIComponent(deviceId)}`,
    );
  }

  async captureWelcome(deviceId) {
    const camera = await this.getCamera(deviceId);
    return {
      deviceId,
      deviceName: camera.name || camera.displayName || "",
      previousLcdMessage: camera.lcdMessage || {},
    };
  }

  async uploadAnimation(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error("The prepared GIF no longer exists.");
    }
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: "image/gif",
    });
    const response = await requestMultipart(
      this.origin,
      "/proxy/protect/api/files/animations",
      form,
      { headers: this.console.headers() },
    );
    let body = null;
    if (response.body.length) {
      try {
        body = JSON.parse(response.body.toString("utf8"));
      } catch {
        body = null;
      }
    }
    if (!response.ok) {
      throw new Error(body?.message || `Protect rejected the GIF with HTTP ${response.status}.`);
    }
    return uploadedFile(body);
  }

  async applyWelcomeImage(deviceId, filename) {
    return this.console.request(
      `/proxy/protect/api/cameras/${encodeURIComponent(deviceId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          lcdMessage: {
            type: "IMAGE",
            text: filename,
            resetAt: null,
          },
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  async publish(deviceId, filePath, backup) {
    const uploaded = await this.uploadAnimation(filePath);
    try {
      await this.applyWelcomeImage(deviceId, uploaded.name);
    } catch (error) {
      error.uploadedAsset = uploaded;
      throw error;
    }
    return {
      uploadedAsset: uploaded,
      previousLcdMessage: backup.previousLcdMessage,
    };
  }

  async restore(deviceId, previousLcdMessage) {
    const body = await this.console.request(
      `/proxy/protect/api/cameras/${encodeURIComponent(deviceId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ lcdMessage: previousLcdMessage || {} }),
        headers: { "Content-Type": "application/json" },
      },
    );
    return JSON.stringify(body?.lcdMessage || {}) === JSON.stringify(previousLcdMessage || {});
  }

  async getDeviceArtwork(value) {
    return this.console.getDeviceArtwork(value);
  }
}

module.exports = {
  ProtectClient,
  publicProtectDevice,
  protectUploadFor,
};
