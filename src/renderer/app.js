import { configureDonationLink } from "../../shared/donation-link.mjs";

const api = window.loopframe;

const state = {
  view: "setup",
  meta: null,
  settings: null,
  donation: null,
  profile: null,
  protectStatus: null,
  devices: [],
  selectedDeviceId: "",
  source: null,
  prepared: null,
  preparedStale: true,
  processing: false,
  processVersion: 0,
  transform: {
    fit: "contain",
    template: "none",
    zoom: 100,
    offsetX: 0,
    offsetY: 0,
    background: "#111612",
  },
  drag: null,
  artworkCache: new Map(),
  artworkPending: new Set(),
  backups: [],
  lastBackup: null,
};

const elements = {};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function icon(name) {
  return `<i data-lucide="${name}"></i>`;
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function toast(message, tone = "success") {
  elements.toastRegion.replaceChildren();
  const item = document.createElement("div");
  item.className = `toast${tone === "error" ? " is-error" : ""}`;
  item.innerHTML = `${icon(tone === "error" ? "circle-alert" : "circle-check")}<span></span>`;
  item.querySelector("span").textContent = message;
  elements.toastRegion.append(item);
  refreshIcons();
  window.setTimeout(() => item.remove(), 4200);
}

function messageFromError(error) {
  const text = String(error?.message || error || "Something went wrong.");
  return text.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "");
}

function setStatus(element, text, tone = "") {
  element.classList.toggle("is-success", tone === "success");
  element.classList.toggle("is-error", tone === "error");
  element.textContent = text;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(milliseconds) {
  if (!milliseconds) return "Still image";
  return `${(milliseconds / 1000).toFixed(milliseconds % 1000 ? 1 : 0)} seconds`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeHost(value) {
  const text = value.trim();
  if (!text) return "";
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

function adminPageUrl() {
  const host = normalizeHost(elements.setupHost.value);
  return host ? `${host}/network/default/admins` : "";
}

function updatePeopleLink() {
  const url = adminPageUrl();
  elements.openPeople.setAttribute("aria-disabled", String(!url));
  elements.openPeople.dataset.url = url;
}

function selectedDevice() {
  return state.devices.find((device) => device.id === state.selectedDeviceId) || null;
}

function uploadStatus(device) {
  return device?.upload?.status || "unsupported";
}

function isPublishable(device) {
  return Boolean(
    device &&
    device.connected &&
    device.upload?.transport &&
    uploadStatus(device) !== "unsupported",
  );
}

function uploadLabel(device) {
  const status = uploadStatus(device);
  if (status === "verified") return "Verified upload";
  if (status === "experimental") return "Experimental upload";
  return "Preview only";
}

function screenConfidenceLabel(device) {
  const confidence = device?.screen?.confidence;
  if (confidence === "detected") return "Detected panel";
  if (confidence === "verified") return "Official panel";
  return "Unverified panel";
}

function sourceLabel(device) {
  return device?.upload?.transport === "protect-lcd" ? "Protect" : "Access";
}

function selectedOptions() {
  const screen = selectedDevice()?.screen || { width: 225, height: 400 };
  return {
    ...state.transform,
    targetWidth: screen.width,
    targetHeight: screen.height,
  };
}

function currentView() {
  return elements.views.find((view) => view.classList.contains("is-active"))?.id.replace("-view", "") || "setup";
}

function showView(name) {
  if (name === "studio" && !state.devices.length) name = "setup";
  for (const view of elements.views) {
    view.classList.toggle("is-active", view.id === `${name}-view`);
  }
  state.view = name;
  for (const button of elements.navButtons) {
    button.classList.toggle("is-active", button.dataset.viewTarget === name);
  }
  if (name === "settings") refreshSettings();
  if (name === "studio" && state.source) {
    applyDeviceScreen(selectedDevice());
    applyLivePreview();
  }
}

function populateControls() {
  elements.fitGrid.innerHTML = Object.entries(state.meta.fits).map(([key, value]) => `
    <button class="fit-option${key === state.transform.fit ? " is-selected" : ""}" type="button" data-fit="${key}" title="${value.description}">
      <span class="fit-glyph" aria-hidden="true"></span>
      <strong>${value.label}</strong>
      <span>${value.description}</span>
    </button>
  `).join("");

  elements.templateGrid.innerHTML = Object.entries(state.meta.templates).map(([key, value]) => `
    <button class="template-option${key === state.transform.template ? " is-selected" : ""}" type="button" data-template="${key}" title="${value.description}">
      <strong>${value.label}</strong>
      <span>${value.description}</span>
    </button>
  `).join("");
  refreshIcons();
}

function renderDevices() {
  elements.deviceList.innerHTML = state.devices.map((device) => `
    <button class="device-option${device.id === state.selectedDeviceId ? " is-selected" : ""}" type="button" role="radio" aria-checked="${device.id === state.selectedDeviceId}" data-device-id="${device.id}">
      <span class="device-option-icon">
        <img alt="" data-device-artwork="${escapeHtml(device.id)}" hidden>
        <span class="device-art-fallback">${icon("door-open")}</span>
      </span>
      <span>
        <strong>${escapeHtml(device.name)}</strong>
        <span>${escapeHtml(device.model || device.type)}${device.firmware ? ` / ${escapeHtml(device.firmware)}` : ""}${device.screen ? ` / ${device.screen.width} x ${device.screen.height}` : ""}</span>
        <span class="device-tags">
          <span class="source-badge">${sourceLabel(device)}</span>
          <span class="capability-badge is-${uploadStatus(device)}">${uploadLabel(device)}</span>
          <span class="confidence-label">${screenConfidenceLabel(device)}</span>
        </span>
      </span>
      <span class="status"><span class="status-dot"></span>${device.connected ? "Online" : "Offline"}</span>
    </button>
  `).join("");
  elements.deviceSelect.innerHTML = state.devices.map((device) => `
    <option value="${escapeHtml(device.id)}"${device.id === state.selectedDeviceId ? " selected" : ""}>${escapeHtml(device.name)} / ${sourceLabel(device)} / ${device.screen?.width} x ${device.screen?.height}</option>
  `).join("");
  elements.deviceCount.textContent = `${state.devices.length} found`;
  elements.deviceSection.hidden = !state.devices.length;
  elements.setupOptions.hidden = !state.devices.length;
  const device = selectedDevice();
  applyDeviceScreen(device);
  elements.asideDeviceName.textContent = device?.name || "No device selected";
  elements.asideDeviceMeta.textContent = device
    ? `${sourceLabel(device)} / ${device.model || device.type}${device.screen ? ` / ${device.screen.width} x ${device.screen.height}` : ""}`
    : "Connect to list compatible Access hardware.";
  elements.asideHost.textContent = normalizeHost(elements.setupHost.value) || "Not connected";
  elements.asideAccount.textContent = elements.setupUser.value.trim() || "Not signed in";
  elements.studioDeviceCopy.textContent = device
    ? `Preparing a background for ${device.name}. The final file is rendered before upload.`
    : "Choose an image, frame it, then review the generated GIF.";
  elements.deviceConnection.textContent = device
    ? `${device.name} is ${device.connected ? "online" : "offline"}. ${uploadLabel(device)}.`
    : "Connect to select a device.";
  elements.deviceCapabilityCopy.textContent = device?.upload?.reason || "";
  elements.deviceCapabilityCopy.className = `capability-copy is-${uploadStatus(device)}`;
  applyLivePreview();
  hydrateDeviceArtwork();
  refreshIcons();
}

function setArtworkImage(image, artwork, alt) {
  if (!image) return;
  const fallback = image.parentElement.querySelector(".device-art-fallback");
  if (!artwork) {
    image.hidden = true;
    image.removeAttribute("src");
    if (fallback) fallback.hidden = false;
    return;
  }
  image.src = artwork;
  image.alt = alt;
  image.hidden = false;
  if (fallback) fallback.hidden = true;
}

function applySelectedArtwork() {
  const device = selectedDevice();
  const artwork = device ? state.artworkCache.get(device.id) : "";
  setArtworkImage(elements.selectedDeviceArtwork, artwork, device ? `${device.name} device` : "");
  setArtworkImage(elements.asideDeviceArtwork, artwork, device ? `${device.name} device` : "");
  setArtworkImage(elements.studioDeviceArtwork, artwork, device ? `${device.name} device` : "");
  for (const image of elements.deviceList.querySelectorAll("[data-device-artwork]")) {
    const item = state.devices.find((candidate) => candidate.id === image.dataset.deviceArtwork);
    setArtworkImage(image, item ? state.artworkCache.get(item.id) : "", item ? `${item.name} device` : "");
  }
}

async function hydrateDeviceArtwork() {
  const pending = state.devices.filter(
    (device) =>
      device.artworkUrl &&
      !state.artworkCache.has(device.id) &&
      !state.artworkPending.has(device.id),
  );
  await Promise.all(pending.map(async (device) => {
    state.artworkPending.add(device.id);
    try {
      const artwork = await api.getDeviceArtwork(device.artworkUrl, device.id);
      if (artwork?.dataUrl) state.artworkCache.set(device.id, artwork.dataUrl);
    } catch {
      state.artworkCache.set(device.id, "");
    } finally {
      state.artworkPending.delete(device.id);
    }
  }));
  applySelectedArtwork();
  refreshIcons();
}

function applyDeviceScreen(device) {
  const screen = device?.screen;
  const width = screen?.width || 225;
  const height = screen?.height || 400;
  const ratio = width / height;
  document.documentElement.style.setProperty("--screen-ratio", String(ratio));
  document.documentElement.style.setProperty("--screen-width", String(width));
  document.documentElement.style.setProperty("--screen-height", String(height));
  document.documentElement.style.setProperty(
    "--device-art-ratio",
    String(device?.artworkAspectRatio || 0.35),
  );
  elements.previewScreen.style.aspectRatio = `${width} / ${height}`;
  elements.dialogScreen.style.aspectRatio = `${width} / ${height}`;
  elements.screenSizeLabel.textContent = device
    ? `${device.name} display / ${width} x ${height}`
    : "Device screen";
  elements.studioDeviceName.textContent = device?.name || "Detected device";
  elements.studioDeviceSpec.textContent = device
    ? `${sourceLabel(device)} / ${width} x ${height} / ${screenConfidenceLabel(device)}`
    : "Waiting for a device";
  setCapabilityBadge(
    elements.studioDeviceCapability,
    device,
    device ? uploadLabel(device) : "Preview only",
  );
  applySelectedArtwork();
  updatePublishAvailability();
}

function setCapabilityBadge(element, device, label) {
  const status = uploadStatus(device);
  element.className = `capability-badge is-${status}`;
  element.textContent = label;
}

function updatePublishAvailability() {
  if (!elements.reviewPublish) return;
  const device = selectedDevice();
  const canPublish = isPublishable(device);
  elements.reviewPublish.disabled = !state.source?.path || !canPublish;
  const label = elements.reviewPublish.querySelector("span");
  if (label) label.textContent = canPublish ? "Review upload" : "Preview only";
}

function setConnectionBusy(busy, label) {
  elements.findDevices.disabled = busy;
  elements.connectionStatus.classList.toggle("is-busy", busy);
  elements.connectionStatus.textContent = label;
}

async function findDevices() {
  const host = normalizeHost(elements.setupHost.value);
  const username = elements.setupUser.value.trim();
  const password = elements.setupPassword.value;
  if (!host || !username || !password) {
    toast("Enter the console address, local account, and password.", "error");
    return;
  }
  setConnectionBusy(true, "Connecting");
  try {
    const result = await api.connect({ host, username, password });
    state.profile = result.profile;
    state.devices = result.devices;
    state.protectStatus = result.protectStatus;
    state.selectedDeviceId = state.devices[0]?.id || "";
    renderDevices();
    renderExperimentalSettings();
    setStatus(elements.connectionStatus, `${state.devices.length} compatible device${state.devices.length === 1 ? "" : "s"} found`, "success");
    elements.globalStatus.innerHTML = `<span class="status-dot"></span><span>${result.profile.name || "Connected"}</span>`;
    toast("Console connected. Choose a device and open the studio.");
  } catch (error) {
    state.devices = [];
    state.selectedDeviceId = "";
    renderDevices();
    setStatus(elements.connectionStatus, messageFromError(error), "error");
    toast(messageFromError(error), "error");
  } finally {
    elements.findDevices.disabled = false;
  }
}

async function finishSetup() {
  if (!state.devices.length || !state.selectedDeviceId) {
    toast("Find and select a compatible device first.", "error");
    return;
  }
  const device = selectedDevice();
  try {
    state.settings = await api.saveSettings({
      host: normalizeHost(elements.setupHost.value),
      username: elements.setupUser.value.trim(),
      password: elements.setupPassword.value,
      deviceId: state.selectedDeviceId,
      deviceName: device?.name || "",
      rememberController: elements.rememberController.checked,
      rememberSignIn: elements.rememberSignin.checked,
      keepHistory: true,
    });
    elements.asidePassword.textContent = state.settings.passwordStored ? "Stored securely" : "Not stored";
    showView("studio");
    toast("Connection saved.");
  } catch (error) {
    toast(messageFromError(error), "error");
  }
}

function previewPlacement(size, targetSize, position) {
  if (size > targetSize) {
    const range = size - targetSize;
    return {
      padBefore: 0,
      crop: clamp((range / 2) * (1 - position / 100), 0, range),
    };
  }
  const available = targetSize - size;
  return {
    padBefore: clamp((available / 2) * (1 + position / 100), 0, available),
    crop: 0,
  };
}

function applyLivePreview() {
  if (!state.source?.dataUrl || !elements.outputPreview) return;
  const screen = selectedDevice()?.screen || { width: 225, height: 400 };
  const displayWidth = elements.previewScreen.clientWidth || screen.width;
  const displayScale = displayWidth / screen.width;
  const zoom = state.transform.zoom / 100;
  const sourceWidth = state.source.width || screen.width;
  const sourceHeight = state.source.height || screen.height;
  let baseWidth;
  let baseHeight;

  if (state.transform.fit === "stretch") {
    baseWidth = screen.width * zoom;
    baseHeight = screen.height * zoom;
  } else {
    let scale = 1;
    if (state.transform.fit === "fill") {
      scale = Math.max(screen.width / sourceWidth, screen.height / sourceHeight);
    } else if (state.transform.fit === "contain") {
      scale = Math.min(screen.width / sourceWidth, screen.height / sourceHeight);
    } else if (state.transform.fit === "width") {
      scale = screen.width / sourceWidth;
    } else if (state.transform.fit === "height") {
      scale = screen.height / sourceHeight;
    }
    baseWidth = sourceWidth * scale * zoom;
    baseHeight = sourceHeight * scale * zoom;
  }

  const horizontal = previewPlacement(baseWidth, screen.width, state.transform.offsetX);
  const vertical = previewPlacement(baseHeight, screen.height, state.transform.offsetY);
  elements.outputPreview.alt = `Animated preview for ${selectedDevice()?.name || "the selected device"}`;
  elements.outputPreview.hidden = false;
  elements.outputPreview.style.width = `${baseWidth * displayScale}px`;
  elements.outputPreview.style.height = `${baseHeight * displayScale}px`;
  elements.outputPreview.style.left = `${(horizontal.padBefore - horizontal.crop) * displayScale}px`;
  elements.outputPreview.style.top = `${(vertical.padBefore - vertical.crop) * displayScale}px`;
  elements.previewScreen.style.backgroundColor = state.transform.background;
  elements.templateOverlay.className = state.transform.template === "none"
    ? "template-overlay"
    : `template-overlay is-${state.transform.template}`;
  elements.outputEmpty.hidden = true;
  elements.dragHint.hidden = false;
}

function setPreviewStatus(text, tone = "") {
  elements.previewStatus.classList.toggle("is-busy", tone === "busy");
  elements.previewStatus.classList.toggle("is-error", tone === "error");
  elements.previewStatus.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(text)}</span>`;
}

function markPreviewChanged() {
  state.processVersion += 1;
  state.preparedStale = true;
  setPreviewStatus("Live preview", "busy");
  elements.previewDigest.textContent = "The final GIF will render when you review it";
  updatePublishAvailability();
  applyLivePreview();
}

function imageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    image.onerror = () => reject(new Error("The selected image could not be opened."));
    image.src = dataUrl;
  });
}

async function openSource(filePath, dataUrl, name, size) {
  const currentSource = {
    path: filePath,
    dataUrl,
    name,
    size,
    width: 0,
    height: 0,
  };
  state.source = currentSource;
  state.prepared = null;
  state.preparedStale = true;
  elements.fileName.textContent = name;
  elements.fileDetail.textContent = `${formatBytes(size)} / local file`;
  elements.sourceSize.textContent = formatBytes(size);
  elements.sourceFrames.textContent = "Reading source";
  elements.sourceDuration.textContent = "Reading source";
  elements.sourceThumbnail.innerHTML = "";
  const thumbnail = new Image();
  thumbnail.src = dataUrl;
  thumbnail.alt = "Selected source image";
  elements.sourceThumbnail.append(thumbnail);
  elements.outputEmpty.hidden = true;
  elements.outputPreview.src = dataUrl;
  elements.outputPreview.hidden = false;
  elements.reviewPublish.disabled = true;
  elements.previewDigest.textContent = "Reading the selected image";
  setPreviewStatus("Loading preview", "busy");

  try {
    const [dimensions, metadata] = await Promise.all([
      imageDimensions(dataUrl),
      api.inspectImage(filePath),
    ]);
    if (state.source !== currentSource) return;
    currentSource.width = metadata.width || dimensions.width;
    currentSource.height = metadata.height || dimensions.height;
    elements.sourceSize.textContent = `${currentSource.width} x ${currentSource.height}`;
    elements.sourceFrames.textContent = `${metadata.frames} frame${metadata.frames === 1 ? "" : "s"}`;
    elements.sourceDuration.textContent = formatDuration(metadata.durationMs);
    updatePublishAvailability();
    setPreviewStatus("Live preview", "busy");
    elements.previewDigest.textContent = "The final GIF will render when you review it";
    applyLivePreview();
  } catch (error) {
    if (state.source !== currentSource) return;
    state.source = null;
    elements.outputPreview.hidden = true;
    elements.outputEmpty.hidden = false;
    updatePublishAvailability();
    setPreviewStatus("Preview failed", "error");
    toast(messageFromError(error), "error");
  }
}

async function chooseImage() {
  elements.fileInput.click();
}

async function sourceFromFile(file) {
  try {
    const filePath = api.getPathForFile(file);
    if (!filePath) throw new Error("The selected file path is unavailable.");
    const reader = new FileReader();
    reader.onload = () => openSource(filePath, reader.result, file.name, file.size);
    reader.onerror = () => toast("The image could not be read.", "error");
    reader.readAsDataURL(file);
  } catch (error) {
    toast(messageFromError(error), "error");
  }
}

async function processSource() {
  if (!state.source?.path) return null;
  const version = ++state.processVersion;
  const requestedOptions = selectedOptions();
  state.processing = true;
  setPreviewStatus("Rendering final GIF", "busy");
  elements.previewDigest.textContent = "Preparing the exact upload";
  elements.reviewPublish.disabled = true;
  try {
    const result = await api.processImage({
      sourcePath: state.source.path,
      options: requestedOptions,
    });
    if (version !== state.processVersion) return null;
    state.prepared = {
      ...result,
      sourceName: state.source.name,
    };
    state.preparedStale = false;
    elements.sourceFrames.textContent = `${result.source.pages} frame${result.source.pages === 1 ? "" : "s"}`;
    elements.sourceDuration.textContent = formatDuration(result.output.durationMs);
    elements.previewDigest.textContent = `SHA-256 ${result.digest.slice(0, 16)}`;
    setPreviewStatus("Ready to review");
    updatePublishAvailability();
    return state.prepared;
  } catch (error) {
    if (version !== state.processVersion) return null;
    state.prepared = null;
    state.preparedStale = true;
    setPreviewStatus("Render failed", "error");
    updatePublishAvailability();
    toast(messageFromError(error), "error");
    return null;
  } finally {
    if (version === state.processVersion) state.processing = false;
  }
}

function selectTransform(selector, attribute, value) {
  for (const button of elements[selector].querySelectorAll(`[data-${attribute}]`)) {
    button.classList.toggle("is-selected", button.dataset[attribute] === value);
  }
  state.transform[attribute] = value;
  markPreviewChanged();
}

function selectFit(value) {
  state.transform.zoom = 100;
  elements.zoom.value = "100";
  elements.zoomValue.textContent = "100%";
  selectTransform("fitGrid", "fit", value);
}

function resetTransform() {
  elements.zoom.value = "100";
  elements.backgroundColor.value = "#111612";
  elements.backgroundValue.textContent = "#111612";
  elements.zoomValue.textContent = "100%";
  state.transform = {
    fit: "contain",
    template: "none",
    zoom: 100,
    offsetX: 0,
    offsetY: 0,
    background: "#111612",
  };
  elements.fitGrid.querySelectorAll("[data-fit]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.fit === "contain");
  });
  elements.templateGrid.querySelectorAll("[data-template]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.template === "none");
  });
  markPreviewChanged();
}

function showPublishDialog() {
  if (!state.prepared || state.preparedStale) {
    toast("The final GIF is not ready yet.", "error");
    return;
  }
  const device = selectedDevice();
  const template = state.meta.templates[state.prepared.options.template]?.label || "No overlay";
  elements.dialogPreview.src = state.prepared.preview;
  elements.dialogDevice.textContent = device?.name || "Not selected";
  elements.dialogOutput.textContent = `${state.prepared.output.width} by ${state.prepared.output.height} / ${state.prepared.output.pages} frames`;
  elements.dialogTemplate.textContent = template;
  elements.dialogDigest.textContent = state.prepared.digest.slice(0, 20);
  elements.dialogUploadStatus.textContent = `${sourceLabel(device)} / ${uploadLabel(device)}`;
  elements.dialogScreen.style.aspectRatio = `${state.prepared.output.width} / ${state.prepared.output.height}`;
  elements.publishDialog.showModal();
  refreshIcons();
}

async function openPublishDialog() {
  if (!state.source?.path) {
    toast("Choose an image before reviewing the upload.", "error");
    return;
  }
  const button = elements.reviewPublish;
  const priorHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${icon("loader-circle")}<span>Preparing GIF</span>`;
  refreshIcons();
  try {
    const prepared = !state.preparedStale && state.prepared
      ? state.prepared
      : await processSource();
    if (!prepared) return;
    showPublishDialog();
  } finally {
    updatePublishAvailability();
    button.innerHTML = priorHtml;
    refreshIcons();
  }
}

async function publishPrepared() {
  const device = selectedDevice();
  if (!state.prepared || !device || !isPublishable(device)) return;
  const button = elements.confirmPublish;
  button.disabled = true;
  button.innerHTML = `${icon("loader-circle")}<span>Publishing</span>`;
  refreshIcons();
  try {
    const backup = await api.publish({
      preparedPath: state.prepared.path,
      digest: state.prepared.digest,
      sourceName: state.prepared.sourceName,
      preview: state.prepared.preview,
      deviceId: device.deviceId,
      transport: device.upload.transport,
      sourceApp: device.sourceApp,
    });
    state.lastBackup = backup;
    elements.publishDialog.close();
    toast(
      device.upload.transport === "protect-lcd"
        ? "The image was sent to the Protect welcome display."
        : "The GIF is active on the selected device.",
    );
    await refreshBackups();
    await refreshSettings();
  } catch (error) {
    toast(messageFromError(error), "error");
  } finally {
    button.disabled = false;
    button.innerHTML = `${icon("upload")}<span>Publish GIF</span>`;
    refreshIcons();
  }
}

async function loadSettingsForm() {
  state.settings = await api.getSettings();
  elements.setupHost.value = state.settings.host || "";
  elements.setupUser.value = state.settings.username || "";
  elements.rememberController.checked = state.settings.rememberController !== false;
  elements.rememberSignin.checked = Boolean(state.settings.rememberSignIn);
  elements.asideHost.textContent = state.settings.host || "Not connected";
  elements.asideAccount.textContent = state.settings.username || "Not signed in";
  elements.asidePassword.textContent = state.settings.passwordStored ? "Stored securely" : "Not stored";
  updatePeopleLink();
  renderExperimentalSettings();
}

async function attemptSavedConnection() {
  if (!state.settings?.host || !state.settings?.passwordStored) return false;
  try {
    const result = await api.refreshDevices();
    state.profile = result.profile;
    state.devices = result.devices;
    state.protectStatus = result.protectStatus;
    state.selectedDeviceId = state.devices.some((device) => device.id === state.settings.deviceId)
      ? state.settings.deviceId
      : state.devices[0]?.id || "";
    renderDevices();
    renderExperimentalSettings();
    elements.globalStatus.innerHTML = `<span class="status-dot"></span><span>${result.profile.name || "Connected"}</span>`;
    return true;
  } catch {
    return false;
  }
}

async function refreshDevices() {
  const button = elements.refreshDevices;
  button.disabled = true;
  try {
    const result = await api.refreshDevices();
    state.profile = result.profile;
    state.devices = result.devices;
    state.protectStatus = result.protectStatus;
    if (!state.selectedDeviceId || !state.devices.some((item) => item.id === state.selectedDeviceId)) {
      state.selectedDeviceId = state.devices.some((device) => device.id === state.settings?.deviceId)
        ? state.settings.deviceId
        : state.devices[0]?.id || "";
    }
    renderDevices();
    renderExperimentalSettings();
    toast("Device list refreshed.");
  } catch (error) {
    toast(messageFromError(error), "error");
  } finally {
    button.disabled = false;
  }
}

async function refreshSettings() {
  state.settings = await api.getSettings();
  elements.settingsHost.textContent = state.settings.host || "Not configured";
  elements.settingsUser.textContent = state.settings.username || "Not configured";
  elements.settingsDevice.textContent = state.settings.deviceName || "Not selected";
  elements.settingsSecret.textContent = state.settings.passwordStored ? "Stored securely" : "Not stored";
  elements.settingsProtectSecret.textContent = state.settings.protectPasswordStored
    ? "Stored securely"
    : state.protectStatus?.state === "connected"
      ? "Using current sign in"
    : state.settings.protectRememberSignIn
      ? "Not stored"
      : "Not requested";
  elements.settingsConnectionCopy.textContent = state.settings.host
    ? `${state.settings.username} at ${state.settings.host}`
    : "Not configured";
  renderExperimentalSettings();
  await refreshBackups();
}

function renderExperimentalSettings() {
  const enabled = Boolean(state.settings?.experimentalScreenDevices);
  elements.experimentalScreenDevices.checked = enabled;
  elements.protectConnection.hidden = !enabled;
  const status = state.protectStatus?.state || "not-connected";
  const connected = status === "connected";
  elements.protectConnectControls.hidden = connected;
  elements.protectUser.value = state.settings?.protectUsername || state.settings?.username || "";
  elements.protectRememberSignin.checked = Boolean(state.settings?.protectRememberSignIn);
  const message = state.protectStatus?.message || (
    enabled ? "Protect discovery has not been checked." : "Not enabled"
  );
  elements.protectStatusCopy.textContent = message;
  elements.protectStatusCopy.className = connected
    ? "is-success"
    : status === "error" || status === "permission-required"
      ? "is-error"
      : "";
  elements.protectConnectionStatus.textContent = message;
  setStatus(
    elements.protectConnectionStatus,
    elements.protectConnectionStatus.textContent,
    connected ? "success" : status === "error" || status === "permission-required" ? "error" : "",
  );
}

async function refreshBackups() {
  state.backups = await api.listBackups();
  if (!state.backups.length) {
    elements.backupList.innerHTML = '<p class="muted">No pending rollback records.</p>';
    return;
  }
  elements.backupList.innerHTML = state.backups.map((backup, index) => `
    <div class="backup-item">
      <div><strong>${backup.deviceName || "Access device"}</strong><span>${backup.sourceName || "Background"} / ${new Date(backup.createdAt || Date.now()).toLocaleDateString()}</span></div>
      <button class="button" type="button" data-restore-index="${index}">${icon("undo-2")}<span>Restore</span></button>
    </div>
  `).join("");
  refreshIcons();
}

async function restoreBackup(index) {
  const backup = state.backups[index];
  if (!backup) return;
  try {
    await api.restore(backup);
    toast("The previous background was restored.");
    await refreshBackups();
  } catch (error) {
    toast(messageFromError(error), "error");
  }
}

async function removeConnection() {
  if (!window.confirm("Remove the saved console and sign in from this computer?")) return;
  await api.removeConnection();
  state.settings = null;
  state.profile = null;
  state.protectStatus = null;
  state.devices = [];
  showView("setup");
  await loadSettingsForm();
  toast("Saved connection removed.");
}

async function removeAll() {
  if (!window.confirm("Delete every Loopframe setting and rollback record on this computer?")) return;
  await api.removeAll();
  state.settings = null;
  state.protectStatus = null;
  state.source = null;
  state.prepared = null;
  state.backups = [];
  showView("setup");
  await loadSettingsForm();
  toast("All local Loopframe data was deleted.");
}

function selectDevice(deviceId) {
  const changed = state.selectedDeviceId !== deviceId;
  state.selectedDeviceId = deviceId;
  renderDevices();
  if (changed && state.source) markPreviewChanged();
}

let dragFrame = 0;
function queueDragPreview() {
  if (dragFrame) return;
  dragFrame = window.requestAnimationFrame(() => {
    dragFrame = 0;
    applyLivePreview();
  });
}

function startDrag(event) {
  if (!state.source?.path || event.button !== 0) return;
  state.drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: state.transform.offsetX,
    offsetY: state.transform.offsetY,
    width: Math.max(1, elements.previewScreen.clientWidth),
    height: Math.max(1, elements.previewScreen.clientHeight),
  };
  state.processVersion += 1;
  state.preparedStale = true;
  elements.previewScreen.setPointerCapture(event.pointerId);
  elements.previewScreen.classList.add("is-dragging");
  setPreviewStatus("Live drag", "busy");
  elements.previewDigest.textContent = "Release to keep this position";
}

function moveDrag(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return;
  event.preventDefault();
  const deltaX = ((event.clientX - state.drag.startX) / state.drag.width) * 200;
  const deltaY = ((event.clientY - state.drag.startY) / state.drag.height) * 200;
  state.transform.offsetX = clamp(state.drag.offsetX + deltaX, -100, 100);
  state.transform.offsetY = clamp(state.drag.offsetY + deltaY, -100, 100);
  queueDragPreview();
}

function endDrag(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return;
  if (elements.previewScreen.hasPointerCapture(event.pointerId)) {
    elements.previewScreen.releasePointerCapture(event.pointerId);
  }
  state.drag = null;
  elements.previewScreen.classList.remove("is-dragging");
  markPreviewChanged();
}

function nudgePreview(event) {
  if (!state.source?.path) return;
  const step = event.shiftKey ? 10 : 2;
  let handled = true;
  if (event.key === "ArrowLeft") state.transform.offsetX -= step;
  else if (event.key === "ArrowRight") state.transform.offsetX += step;
  else if (event.key === "ArrowUp") state.transform.offsetY -= step;
  else if (event.key === "ArrowDown") state.transform.offsetY += step;
  else if (event.key === "Home") {
    state.transform.offsetX = 0;
    state.transform.offsetY = 0;
  } else {
    handled = false;
  }
  if (!handled) return;
  event.preventDefault();
  state.transform.offsetX = clamp(state.transform.offsetX, -100, 100);
  state.transform.offsetY = clamp(state.transform.offsetY, -100, 100);
  markPreviewChanged();
}

function setupEventHandlers() {
  for (const button of elements.viewButtons) {
    button.addEventListener("click", () => showView(button.dataset.viewTarget));
  }
  elements.brandHome.addEventListener("click", () => showView(state.devices.length ? "studio" : "setup"));
  elements.setupHost.addEventListener("input", updatePeopleLink);
  elements.setupUser.addEventListener("input", renderDevices);
  elements.openPeople.addEventListener("click", () => {
    const url = elements.openPeople.dataset.url;
    if (url) api.openExternal(url).catch((error) => toast(messageFromError(error), "error"));
  });
  elements.showPassword.addEventListener("click", () => {
    const reveal = elements.setupPassword.type === "password";
    elements.setupPassword.type = reveal ? "text" : "password";
    elements.showPassword.innerHTML = icon(reveal ? "eye-off" : "eye");
    elements.showPassword.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    refreshIcons();
  });
  elements.findDevices.addEventListener("click", findDevices);
  elements.finishSetup.addEventListener("click", finishSetup);
  elements.deviceList.addEventListener("click", (event) => {
    const option = event.target.closest("[data-device-id]");
    if (!option) return;
    selectDevice(option.dataset.deviceId);
  });
  elements.deviceSelect.addEventListener("change", () => {
    selectDevice(elements.deviceSelect.value);
  });
  elements.refreshDevices.addEventListener("click", refreshDevices);
  elements.chooseFile.addEventListener("click", chooseImage);
  elements.chooseFileTop.addEventListener("click", chooseImage);
  elements.dropZone.addEventListener("click", chooseImage);
  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files[0];
    if (file) sourceFromFile(file);
    elements.fileInput.value = "";
  });
  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
  elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("is-dragging"));
  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
    const file = event.dataTransfer.files[0];
    if (file) sourceFromFile(file);
  });
  elements.fitGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-fit]");
    if (button) selectFit(button.dataset.fit);
  });
  elements.templateGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-template]");
    if (button) selectTransform("templateGrid", "template", button.dataset.template);
  });
  elements.zoom.addEventListener("input", () => {
    state.transform.zoom = Number(elements.zoom.value);
    elements.zoomValue.textContent = `${elements.zoom.value}%`;
    markPreviewChanged();
  });
  elements.backgroundColor.addEventListener("input", () => {
    state.transform.background = elements.backgroundColor.value;
    elements.backgroundValue.textContent = elements.backgroundColor.value;
    markPreviewChanged();
  });
  elements.showGrid.addEventListener("change", () => {
    elements.safeGrid.hidden = !elements.showGrid.checked;
  });
  elements.centerImage.addEventListener("click", () => {
    state.transform.offsetX = 0;
    state.transform.offsetY = 0;
    markPreviewChanged();
  });
  elements.previewScreen.addEventListener("pointerdown", startDrag);
  elements.previewScreen.addEventListener("pointermove", moveDrag);
  elements.previewScreen.addEventListener("pointerup", endDrag);
  elements.previewScreen.addEventListener("pointercancel", endDrag);
  elements.previewScreen.addEventListener("keydown", nudgePreview);
  elements.resetTransform.addEventListener("click", resetTransform);
  elements.reviewPublish.addEventListener("click", openPublishDialog);
  elements.confirmPublish.addEventListener("click", publishPrepared);
  elements.testConnection.addEventListener("click", async () => {
    try {
      await api.testSavedConnection();
      toast("Connection verified.");
    } catch (error) {
      toast(messageFromError(error), "error");
    }
  });
  elements.experimentalScreenDevices.addEventListener("change", async () => {
    const enabled = elements.experimentalScreenDevices.checked;
    elements.experimentalScreenDevices.disabled = true;
    try {
      state.settings = await api.setExperimentalScreenDevices(enabled);
      state.protectStatus = enabled
        ? { state: "not-connected", message: "Checking Protect access." }
        : { state: "disabled", message: "Experimental screen discovery is disabled." };
      renderExperimentalSettings();
      await refreshDevices();
      toast(enabled
        ? "Experimental screen discovery is on."
        : "Experimental screen discovery is off.");
    } catch (error) {
      elements.experimentalScreenDevices.checked = !enabled;
      toast(messageFromError(error), "error");
    } finally {
      elements.experimentalScreenDevices.disabled = false;
    }
  });
  elements.connectProtect.addEventListener("click", async () => {
    const username = elements.protectUser.value.trim();
    const password = elements.protectPassword.value;
    if (!username || !password) {
      toast("Enter the Protect account and password.", "error");
      return;
    }
    elements.connectProtect.disabled = true;
    try {
      const result = await api.connectProtect({
        host: state.settings.host,
        username,
        password,
        rememberSignIn: elements.protectRememberSignin.checked,
      });
      state.protectStatus = result.protectStatus;
      elements.protectPassword.value = "";
      await refreshSettings();
      await refreshDevices();
      toast("Protect discovery is connected.");
    } catch (error) {
      toast(messageFromError(error), "error");
    } finally {
      elements.connectProtect.disabled = false;
    }
  });
  elements.editConnection.addEventListener("click", () => showView("setup"));
  elements.removeConnection.addEventListener("click", removeConnection);
  elements.removeAll.addEventListener("click", removeAll);
  elements.backupList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-restore-index]");
    if (button) restoreBackup(Number(button.dataset.restoreIndex));
  });
  elements.repoLink.addEventListener("click", (event) => {
    event.preventDefault();
    api.openExternal(elements.repoLink.href).catch((error) => toast(messageFromError(error), "error"));
  });
}

async function initialize() {
  Object.assign(elements, {
    views: $$(".view"),
    navButtons: $$("[data-view-target]"),
    viewButtons: $$("[data-view-target]"),
    toastRegion: $("#toast-region"),
    globalStatus: $("#global-status"),
    brandHome: $("#brand-home"),
    refreshDevices: $("#refresh-devices"),
    setupHost: $("#setup-host"),
    setupUser: $("#setup-user"),
    setupPassword: $("#setup-password"),
    showPassword: $("#show-password"),
    openPeople: $("#open-people"),
    findDevices: $("#find-devices"),
    connectionStatus: $("#connection-status"),
    deviceSection: $("#device-section"),
    deviceList: $("#device-list"),
    deviceCount: $("#device-count"),
    setupOptions: $("#setup-options"),
    rememberController: $("#remember-controller"),
    rememberSignin: $("#remember-signin"),
    finishSetup: $("#finish-setup"),
    asideDeviceName: $("#aside-device-name"),
    asideDeviceMeta: $("#aside-device-meta"),
    asideHost: $("#aside-host"),
    asideAccount: $("#aside-account"),
    asidePassword: $("#aside-password"),
    studioDeviceCopy: $("#studio-device-copy"),
    chooseFile: $("#choose-file"),
    chooseFileTop: $("#choose-file-top"),
    fileInput: $("#file-input"),
    dropZone: $("#drop-zone"),
    fileName: $("#file-name"),
    fileDetail: $("#file-detail"),
    sourceThumbnail: $("#source-thumbnail"),
    sourceSize: $("#source-size"),
    sourceFrames: $("#source-frames"),
    sourceDuration: $("#source-duration"),
    outputEmpty: $("#output-empty"),
    outputPreview: $("#output-preview"),
    previewStatus: $("#preview-status"),
    previewDigest: $("#preview-digest"),
    previewScreen: $("#preview-screen"),
    screenSizeLabel: $("#screen-size-label"),
    templateOverlay: $("#template-overlay"),
    dragHint: $("#drag-hint"),
    fitGrid: $("#fit-grid"),
    templateGrid: $("#template-grid"),
    zoom: $("#zoom"),
    zoomValue: $("#zoom-value"),
    backgroundColor: $("#background-color"),
    backgroundValue: $("#background-value"),
    showGrid: $("#show-grid"),
    safeGrid: $("#safe-grid"),
    centerImage: $("#center-image"),
    resetTransform: $("#reset-transform"),
    deviceSelect: $("#device-select"),
    deviceConnection: $("#device-connection"),
    reviewPublish: $("#review-publish"),
    publishDialog: $("#publish-dialog"),
    dialogScreen: $("#dialog-screen"),
    dialogPreview: $("#dialog-preview"),
    dialogDevice: $("#dialog-device"),
    dialogOutput: $("#dialog-output"),
    dialogTemplate: $("#dialog-template"),
    dialogDigest: $("#dialog-digest"),
    dialogUploadStatus: $("#dialog-upload-status"),
    confirmPublish: $("#confirm-publish"),
    settingsHost: $("#settings-host"),
    settingsUser: $("#settings-user"),
    settingsDevice: $("#settings-device"),
    settingsSecret: $("#settings-secret"),
    settingsProtectSecret: $("#settings-protect-secret"),
    settingsConnectionCopy: $("#settings-connection-copy"),
    experimentalScreenDevices: $("#experimental-screen-devices"),
    protectConnection: $("#protect-connection"),
    protectCredentials: $("#protect-credentials"),
    protectConnectControls: $("#protect-connect-controls"),
    protectStatusCopy: $("#protect-status-copy"),
    protectUser: $("#protect-user"),
    protectPassword: $("#protect-password"),
    protectRememberSignin: $("#protect-remember-signin"),
    protectConnectionStatus: $("#protect-connection-status"),
    connectProtect: $("#connect-protect"),
    testConnection: $("#test-connection"),
    editConnection: $("#edit-connection"),
    removeConnection: $("#remove-connection"),
    removeAll: $("#remove-all"),
    backupList: $("#backup-list"),
    donationLink: $("#donation-link"),
    headerDonationLink: $("#header-donation-link"),
    repoLink: $("#repo-link"),
    versionLabel: $("#version-label"),
    selectedDeviceArtwork: $("#selected-device-artwork"),
    asideDeviceArtwork: $("#aside-device-artwork"),
    studioDeviceArtwork: $("#studio-device-artwork"),
    studioDeviceName: $("#studio-device-name"),
    studioDeviceSpec: $("#studio-device-spec"),
    studioDeviceCapability: $("#studio-device-capability"),
    deviceCapabilityCopy: $("#device-capability-copy"),
  });

  state.meta = await api.getMeta();
  state.donation = await api.getDonation();
  populateControls();
  setupEventHandlers();
  new ResizeObserver(() => applyLivePreview()).observe(elements.previewScreen);
  await loadSettingsForm();
  elements.versionLabel.textContent = `Loopframe ${state.meta.version}`;
  if (!state.meta.credentialVault) {
    elements.rememberSignin.disabled = true;
    elements.rememberSignin.closest(".check-row").querySelector("small").textContent =
      "No protected credential service is available on this computer. The password stays in memory for this run.";
  }
  if (state.donation?.enabled && state.donation.url) {
    for (const link of [elements.headerDonationLink, elements.donationLink]) {
      configureDonationLink(
        link,
        state.donation,
        (url) => api.openExternal(url).catch((error) => toast(messageFromError(error), "error")),
      );
    }
  } else {
    elements.headerDonationLink.hidden = true;
    elements.donationLink.hidden = true;
  }

  const connected = await attemptSavedConnection();
  if (connected) {
    showView("studio");
  } else {
    showView("setup");
  }
  refreshIcons();
}

initialize().catch((error) => {
  toast(messageFromError(error), "error");
});
