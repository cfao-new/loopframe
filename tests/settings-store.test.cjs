const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SettingsStore } = require("../src/settings-store.cjs");

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^protected:/, ""),
  };
}

test("settings survive a reload and credentials use protected storage", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "loopframe-settings-"));
  try {
    const store = new SettingsStore(directory, fakeSafeStorage());
    await store.initialize();
    await store.saveSettings({
      host: "https://console.example",
      username: "loopframe-admin",
      password: "not-a-real-password",
      deviceId: "device-1",
      deviceName: "Front door",
      rememberController: true,
      rememberSignIn: true,
      keepHistory: true,
    });
    const reloaded = new SettingsStore(directory, fakeSafeStorage());
    await reloaded.initialize();
    const settings = await reloaded.readSettings();
    assert.equal(settings.host, "https://console.example");
    assert.equal(settings.username, "loopframe-admin");
    assert.equal(settings.passwordStored, true);
    assert.equal(await reloaded.readPassword(), "not-a-real-password");
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("connection removal deletes settings, secret, history, and rollback records", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "loopframe-settings-"));
  try {
    const store = new SettingsStore(directory, fakeSafeStorage());
    await store.initialize();
    await store.saveSettings({
      host: "https://console.example",
      username: "loopframe-admin",
      password: "not-a-real-password",
      deviceId: "device-1",
      rememberSignIn: true,
    });
    await store.addHistory({ status: "published" });
    await store.saveBackup({
      deviceId: "device-1",
      previousBg: "old.png",
      previousBgs: "old.png",
    });
    await store.saveProtectConnection({
      host: "https://console.example",
      username: "protect-user",
      password: "protect-password",
      rememberSignIn: true,
    });

    const settings = await store.removeAll();
    assert.equal(settings.host, "");
    assert.equal(settings.passwordStored, false);
    assert.equal(settings.protectPasswordStored, false);
    assert.deepEqual(await store.listHistory(), []);
    assert.deepEqual(await store.listBackups(), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("rollback records are limited to the application backup directory", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "loopframe-settings-"));
  try {
    const store = new SettingsStore(directory, fakeSafeStorage());
    await store.initialize();
    await assert.rejects(
      () => store.removeBackup(path.join(directory, "outside.json")),
      /Invalid backup path/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("experimental discovery and Protect credentials are persisted and removed", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "loopframe-settings-"));
  try {
    const store = new SettingsStore(directory, fakeSafeStorage());
    await store.initialize();
    await store.saveSettings({
      host: "https://console.example",
      username: "access-user",
      password: "access-password",
      rememberSignIn: true,
    });
    await store.setExperimentalScreenDevices(true);
    await store.saveProtectConnection({
      host: "https://console.example",
      username: "protect-user",
      password: "protect-password",
      rememberSignIn: true,
    });

    const reloaded = new SettingsStore(directory, fakeSafeStorage());
    await reloaded.initialize();
    const settings = await reloaded.readSettings();
    assert.equal(settings.experimentalScreenDevices, true);
    assert.equal(settings.protectUsername, "protect-user");
    assert.equal(settings.protectPasswordStored, true);
    assert.equal(await reloaded.readProtectPassword(), "protect-password");

    const removed = await reloaded.removeAll();
    assert.equal(removed.experimentalScreenDevices, false);
    assert.equal(removed.protectPasswordStored, false);
    assert.equal(await reloaded.readProtectPassword(), "");
    const raw = await reloaded.readJson(reloaded.settingsPath, {});
    assert.deepEqual(raw, {});
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
