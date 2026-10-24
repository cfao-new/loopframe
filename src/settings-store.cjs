const fs = require("node:fs/promises");
const path = require("node:path");

class SettingsStore {
  constructor(directory, safeStorage) {
    this.directory = directory;
    this.safeStorage = safeStorage;
    this.settingsPath = path.join(directory, "settings.json");
    this.secretPath = path.join(directory, "secret.bin");
    this.protectSecretPath = path.join(directory, "protect-secret.bin");
    this.historyPath = path.join(directory, "history.json");
    this.backupDirectory = path.join(directory, "backups");
  }

  async initialize() {
    await fs.mkdir(this.directory, { recursive: true });
    await fs.mkdir(this.backupDirectory, { recursive: true });
  }

  async readJson(filePath, fallback) {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
  }

  async writeJson(filePath, value) {
    const temporary = `${filePath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(temporary, filePath);
  }

  async readSettings() {
    const settings = await this.readJson(this.settingsPath, {
      host: "",
      username: "",
      deviceId: "",
      deviceName: "",
      rememberController: true,
      rememberSignIn: false,
      keepHistory: true,
      experimentalScreenDevices: false,
      protectHost: "",
      protectUsername: "",
      protectRememberSignIn: false,
    });
    return {
      ...settings,
      passwordStored: await this.hasStoredPassword(),
      protectPasswordStored: await this.hasStoredProtectPassword(),
    };
  }

  async saveSettings(value) {
    const current = await this.readJson(this.settingsPath, {});
    const settings = {
      host: String(value.host || "").trim(),
      username: String(value.username || "").trim(),
      deviceId: String(value.deviceId || "").trim(),
      deviceName: String(value.deviceName || "").trim(),
      rememberController: value.rememberController !== false,
      rememberSignIn: Boolean(value.rememberSignIn),
      keepHistory: value.keepHistory !== false,
      experimentalScreenDevices: Boolean(
        value.experimentalScreenDevices ?? current.experimentalScreenDevices,
      ),
      protectHost: String(value.protectHost ?? current.protectHost ?? "").trim(),
      protectUsername: String(
        value.protectUsername ?? current.protectUsername ?? "",
      ).trim(),
      protectRememberSignIn: Boolean(
        value.protectRememberSignIn ?? current.protectRememberSignIn,
      ),
    };
    await this.writeJson(this.settingsPath, settings);
    if (settings.rememberSignIn && value.password) {
      await this.storePassword(value.password);
    } else if (!settings.rememberSignIn) {
      await this.clearPassword();
    }
    return this.readSettings();
  }

  async setExperimentalScreenDevices(enabled) {
    const current = await this.readJson(this.settingsPath, {});
    await this.writeJson(this.settingsPath, {
      host: "",
      username: "",
      deviceId: "",
      deviceName: "",
      rememberController: true,
      rememberSignIn: false,
      keepHistory: true,
      protectHost: "",
      protectUsername: "",
      protectRememberSignIn: false,
      ...current,
      experimentalScreenDevices: Boolean(enabled),
    });
    return this.readSettings();
  }

  async saveProtectConnection(value) {
    const current = await this.readJson(this.settingsPath, {});
    const protectRememberSignIn = Boolean(value.rememberSignIn);
    await this.writeJson(this.settingsPath, {
      host: "",
      username: "",
      deviceId: "",
      deviceName: "",
      rememberController: true,
      rememberSignIn: false,
      keepHistory: true,
      experimentalScreenDevices: false,
      ...current,
      protectHost: String(value.host || current.host || "").trim(),
      protectUsername: String(value.username || "").trim(),
      protectRememberSignIn,
    });
    if (protectRememberSignIn && value.password) {
      await this.storeProtectPassword(value.password);
    } else if (!protectRememberSignIn) {
      await this.clearProtectPassword();
    }
    return this.readSettings();
  }

  async hasStoredPassword() {
    try {
      await fs.access(this.secretPath);
      return true;
    } catch {
      return false;
    }
  }

  async hasStoredProtectPassword() {
    try {
      await fs.access(this.protectSecretPath);
      return true;
    } catch {
      return false;
    }
  }

  async storePassword(password) {
    if (!this.safeStorage.isEncryptionAvailable()) {
      await this.clearPassword();
      return false;
    }
    const encrypted = this.safeStorage.encryptString(String(password));
    await fs.writeFile(this.secretPath, encrypted, { mode: 0o600 });
    return true;
  }

  async readPassword() {
    try {
      if (!this.safeStorage.isEncryptionAvailable()) return "";
      const encrypted = await fs.readFile(this.secretPath);
      return this.safeStorage.decryptString(encrypted);
    } catch {
      return "";
    }
  }

  async storeProtectPassword(password) {
    if (!this.safeStorage.isEncryptionAvailable()) {
      await this.clearProtectPassword();
      return false;
    }
    const encrypted = this.safeStorage.encryptString(String(password));
    await fs.writeFile(this.protectSecretPath, encrypted, { mode: 0o600 });
    return true;
  }

  async readProtectPassword() {
    try {
      if (!this.safeStorage.isEncryptionAvailable()) return "";
      const encrypted = await fs.readFile(this.protectSecretPath);
      return this.safeStorage.decryptString(encrypted);
    } catch {
      return "";
    }
  }

  async clearPassword() {
    await fs.rm(this.secretPath, { force: true });
  }

  async clearProtectPassword() {
    await fs.rm(this.protectSecretPath, { force: true });
  }

  async removeConnection() {
    await Promise.all([
      fs.rm(this.settingsPath, { force: true }),
      this.clearPassword(),
      this.clearProtectPassword(),
      fs.rm(this.historyPath, { force: true }),
    ]);
    return this.readSettings();
  }

  async removeAll() {
    await Promise.all([
      fs.rm(this.settingsPath, { force: true }),
      this.clearPassword(),
      this.clearProtectPassword(),
      fs.rm(this.historyPath, { force: true }),
      fs.rm(this.backupDirectory, { recursive: true, force: true }),
    ]);
    await fs.mkdir(this.backupDirectory, { recursive: true });
    return this.readSettings();
  }

  async listHistory() {
    return this.readJson(this.historyPath, []);
  }

  async addHistory(entry) {
    const settings = await this.readSettings();
    if (!settings.keepHistory) return;
    const history = await this.listHistory();
    history.unshift({
      ...entry,
      createdAt: new Date().toISOString(),
    });
    await this.writeJson(this.historyPath, history.slice(0, 50));
  }

  async saveBackup(backup) {
    const filename = `${backup.deviceId}-${Date.now()}.json`;
    const filePath = path.join(this.backupDirectory, filename);
    await this.writeJson(filePath, backup);
    return filePath;
  }

  async listBackups() {
    let names = [];
    try {
      names = await fs.readdir(this.backupDirectory);
    } catch {
      return [];
    }
    const backups = [];
    for (const name of names.filter((item) => item.endsWith(".json")).sort().reverse()) {
      const filePath = path.join(this.backupDirectory, name);
      const data = await this.readJson(filePath, null);
      if (data) backups.push({ ...data, backupPath: filePath });
    }
    return backups;
  }

  async removeBackup(backupPath) {
    const resolved = path.resolve(backupPath);
    if (!resolved.startsWith(path.resolve(this.backupDirectory) + path.sep)) {
      throw new Error("Invalid backup path.");
    }
    await fs.rm(resolved, { force: true });
  }
}

module.exports = { SettingsStore };
