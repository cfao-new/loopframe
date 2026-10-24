import { configureDonationLink } from "../../shared/donation-link.mjs";

const api = window.loopframe;

const state = {
  view: "setup",
  meta: null,
  settings: null,
  donation: null,
  profile: null,
  devices: [],
  selectedDeviceId: "",
  source: null,
  prepared: null,
  processing: false,
  processVersion: 0,
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

function selectedOptions() {
  return {
    fit: elements.fitGrid.querySelector(".is-selected")?.dataset.fit || "fill",
    template: elements.templateGrid.querySelector(".is-selected")?.dataset.template || "none",
    zoom: Number(elements.zoom.value),
    offsetX: Number(elements.offsetX.value),
    offsetY: Number(elements.offsetY.value),
    background: elements.backgroundColor.value,
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
  if (name === "studio" && state.source) scheduleProcess(80);
}

function populateControls() {
  elements.fitGrid.innerHTML = Object.entries(state.meta.fits).map(([key, value]) => `
    <button class="fit-option${key === "fill" ? " is-selected" : ""}" type="button" data-fit="${key}" title="${value.description}">
      <span class="fit-glyph" aria-hidden="true"></span>
      <strong>${value.label}</strong>
      <span>${value.description}</span>
    </button>
  `).join("");

  elements.templateGrid.innerHTML = Object.entries(state.meta.templates).map(([key, value]) => `
    <button class="template-option${key === "none" ? " is-selected" : ""}" type="button" data-template="${key}" title="${value.description}">
      <strong>${value.label}</strong>
      <span>${value.description}</span>
    </button>
  `).join("");
  refreshIcons();
}

function renderDevices() {
  elements.deviceList.innerHTML = state.devices.map((device) => `
    <button class="device-option${device.id === state.selectedDeviceId ? " is-selected" : ""}" type="button" role="radio" aria-checked="${device.id === state.selectedDeviceId}" data-device-id="${device.id}">
      <span class="device-option-icon">${icon("door-open")}</span>
      <span><strong>${device.name}</strong><span>${device.model || device.type}${device.firmware ? ` / ${device.firmware}` : ""}</span></span>
      <span class="status"><span class="status-dot"></span>${device.connected ? "Online" : "Offline"}</span>
    </button>
  `).join("");
  elements.deviceSelect.innerHTML = state.devices.map((device) => `
    <option value="${device.id}"${device.id === state.selectedDeviceId ? " selected" : ""}>${device.name} / ${device.model || device.type}</option>
  `).join("");
  elements.deviceCount.textContent = `${state.devices.length} found`;
  elements.deviceSection.hidden = !state.devices.length;
  elements.setupOptions.hidden = !state.devices.length;
  const device = selectedDevice();
  elements.asideDeviceName.textContent = device?.name || "No device selected";
  elements.asideDeviceMeta.textContent = device
    ? `${device.model || device.type}${device.firmware ? ` / firmware ${device.firmware}` : ""}`
    : "Connect to list compatible Access hardware.";
  elements.asideHost.textContent = normalizeHost(elements.setupHost.value) || "Not connected";
  elements.asideAccount.textContent = elements.setupUser.value.trim() || "Not signed in";
  elements.studioDeviceCopy.textContent = device
    ? `Preparing a background for ${device.name}. The final file is rendered before upload.`
    : "Choose an image, frame it, then review the generated GIF.";
  elements.deviceConnection.textContent = device
    ? `${device.name} is ${device.connected ? "online" : "offline"}.`
    : "Connect to select a device.";
  refreshIcons();
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
    state.selectedDeviceId = state.devices[0]?.id || "";
    renderDevices();
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

async function openSource(filePath, dataUrl, name, size) {
  state.source = { path: filePath, dataUrl, name, size };
  elements.fileName.textContent = name;
  elements.fileDetail.textContent = `${formatBytes(size)} / local file`;
  elements.sourceSize.textContent = formatBytes(size);
  elements.sourceThumbnail.innerHTML = `<img src="${dataUrl}" alt="Selected source image">`;
  elements.outputEmpty.hidden = false;
  elements.outputPreview.hidden = true;
  elements.previewDigest.textContent = "Preparing output";
  scheduleProcess(50);
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

let processTimer;
function scheduleProcess(delay = 380) {
  if (!state.source?.path) return;
  window.clearTimeout(processTimer);
  elements.previewStatus.classList.add("is-busy");
  elements.previewStatus.innerHTML = `<span class="status-dot"></span><span>Rendering</span>`;
  elements.previewDigest.textContent = "Preparing output";
  elements.reviewPublish.disabled = true;
  processTimer = window.setTimeout(processSource, delay);
}

async function processSource() {
  if (!state.source?.path) return;
  const version = ++state.processVersion;
  state.processing = true;
  elements.previewStatus.classList.add("is-busy");
  elements.previewStatus.innerHTML = `<span class="status-dot"></span><span>Rendering</span>`;
  elements.reviewPublish.disabled = true;
  try {
    const result = await api.processImage({
      sourcePath: state.source.path,
      options: selectedOptions(),
    });
    if (version !== state.processVersion) return;
    state.prepared = {
      ...result,
      sourceName: state.source.name,
    };
    elements.outputPreview.src = result.preview;
    elements.outputPreview.hidden = false;
    elements.outputEmpty.hidden = true;
    elements.sourceFrames.textContent = `${result.source.pages} frame${result.source.pages === 1 ? "" : "s"}`;
    elements.sourceDuration.textContent = formatDuration(result.output.durationMs);
    elements.previewDigest.textContent = `SHA-256 ${result.digest.slice(0, 16)}`;
    elements.previewStatus.classList.remove("is-busy");
    elements.previewStatus.innerHTML = `<span class="status-dot"></span><span>Ready to review</span>`;
    elements.reviewPublish.disabled = false;
  } catch (error) {
    if (version !== state.processVersion) return;
    state.prepared = null;
    elements.previewStatus.classList.remove("is-busy");
    elements.previewStatus.classList.add("is-error");
    elements.previewStatus.innerHTML = `<span class="status-dot"></span><span>Render failed</span>`;
    toast(messageFromError(error), "error");
  } finally {
    if (version === state.processVersion) state.processing = false;
  }
}

function selectTransform(selector, attribute, value) {
  for (const button of elements[selector].querySelectorAll(`[data-${attribute}]`)) {
    button.classList.toggle("is-selected", button.dataset[attribute] === value);
  }
  scheduleProcess();
}

function resetTransform() {
  elements.zoom.value = "100";
  elements.offsetX.value = "0";
  elements.offsetY.value = "0";
  elements.backgroundColor.value = "#111612";
  elements.backgroundValue.textContent = "#111612";
  elements.zoomValue.textContent = "100%";
  selectTransform("fitGrid", "fit", "fill");
  selectTransform("templateGrid", "template", "none");
}

function openPublishDialog() {
  if (!state.prepared) {
    toast("Prepare a GIF before reviewing the upload.", "error");
    return;
  }
  const device = selectedDevice();
  const template = state.meta.templates[state.prepared.options.template]?.label || "No overlay";
  elements.dialogPreview.src = state.prepared.preview;
  elements.dialogDevice.textContent = device?.name || "Not selected";
  elements.dialogOutput.textContent = `${state.prepared.output.width} by ${state.prepared.output.height} / ${state.prepared.output.pages} frames`;
  elements.dialogTemplate.textContent = template;
  elements.dialogDigest.textContent = state.prepared.digest.slice(0, 20);
  elements.publishDialog.showModal();
  refreshIcons();
}

async function publishPrepared() {
  if (!state.prepared || !state.selectedDeviceId) return;
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
      deviceId: state.selectedDeviceId,
    });
    state.lastBackup = backup;
    elements.publishDialog.close();
    toast("The GIF is active on the selected device.");
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
}

async function attemptSavedConnection() {
  if (!state.settings?.host || !state.settings?.passwordStored) return false;
  try {
    const result = await api.refreshDevices();
    state.profile = result.profile;
    state.devices = result.devices;
    state.selectedDeviceId = state.settings.deviceId || state.devices[0]?.id || "";
    renderDevices();
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
    if (!state.selectedDeviceId || !state.devices.some((item) => item.id === state.selectedDeviceId)) {
      state.selectedDeviceId = state.settings?.deviceId || state.devices[0]?.id || "";
    }
    renderDevices();
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
  elements.settingsConnectionCopy.textContent = state.settings.host
    ? `${state.settings.username} at ${state.settings.host}`
    : "Not configured";
  await refreshBackups();
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
  state.devices = [];
  showView("setup");
  await loadSettingsForm();
  toast("Saved connection removed.");
}

async function removeAll() {
  if (!window.confirm("Delete every Loopframe setting and rollback record on this computer?")) return;
  await api.removeAll();
  state.settings = null;
  state.source = null;
  state.prepared = null;
  state.backups = [];
  showView("setup");
  await loadSettingsForm();
  toast("All local Loopframe data was deleted.");
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
    state.selectedDeviceId = option.dataset.deviceId;
    renderDevices();
  });
  elements.deviceSelect.addEventListener("change", () => {
    state.selectedDeviceId = elements.deviceSelect.value;
    renderDevices();
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
    if (button) selectTransform("fitGrid", "fit", button.dataset.fit);
  });
  elements.templateGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-template]");
    if (button) selectTransform("templateGrid", "template", button.dataset.template);
  });
  for (const control of [elements.zoom, elements.offsetX, elements.offsetY]) {
    control.addEventListener("input", () => {
      elements.zoomValue.textContent = `${elements.zoom.value}%`;
      scheduleProcess();
    });
  }
  elements.backgroundColor.addEventListener("input", () => {
    elements.backgroundValue.textContent = elements.backgroundColor.value;
    scheduleProcess();
  });
  elements.showGrid.addEventListener("change", () => {
    elements.safeGrid.hidden = !elements.showGrid.checked;
  });
  elements.centerImage.addEventListener("click", () => {
    elements.offsetX.value = "0";
    elements.offsetY.value = "0";
    scheduleProcess();
  });
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
    fitGrid: $("#fit-grid"),
    templateGrid: $("#template-grid"),
    zoom: $("#zoom"),
    zoomValue: $("#zoom-value"),
    offsetX: $("#offset-x"),
    offsetY: $("#offset-y"),
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
    dialogPreview: $("#dialog-preview"),
    dialogDevice: $("#dialog-device"),
    dialogOutput: $("#dialog-output"),
    dialogTemplate: $("#dialog-template"),
    dialogDigest: $("#dialog-digest"),
    confirmPublish: $("#confirm-publish"),
    settingsHost: $("#settings-host"),
    settingsUser: $("#settings-user"),
    settingsDevice: $("#settings-device"),
    settingsSecret: $("#settings-secret"),
    settingsConnectionCopy: $("#settings-connection-copy"),
    testConnection: $("#test-connection"),
    editConnection: $("#edit-connection"),
    removeConnection: $("#remove-connection"),
    removeAll: $("#remove-all"),
    backupList: $("#backup-list"),
    donationLink: $("#donation-link"),
    repoLink: $("#repo-link"),
    versionLabel: $("#version-label"),
  });

  state.meta = await api.getMeta();
  state.donation = await api.getDonation();
  populateControls();
  setupEventHandlers();
  await loadSettingsForm();
  elements.versionLabel.textContent = `Loopframe ${state.meta.version}`;
  if (!state.meta.credentialVault) {
    elements.rememberSignin.disabled = true;
    elements.rememberSignin.closest(".check-row").querySelector("small").textContent =
      "No protected credential service is available on this computer. The password stays in memory for this run.";
  }
  if (state.donation?.enabled && state.donation.url) {
    configureDonationLink(
      elements.donationLink,
      state.donation,
      (url) => api.openExternal(url).catch((error) => toast(messageFromError(error), "error")),
    );
  } else {
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
