import assert from "node:assert/strict";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import gifenc from "gifenc";
import { request } from "playwright";
import sharp from "sharp";

sharp.cache(false);

const require = createRequire(import.meta.url);
const { FIT_MODES, TEMPLATES, processImage } = require("../src/image-processor.cjs");
const { UniFiClient } = require("../src/unifi-client.cjs");
const { ProtectClient } = require("../src/protect-client.cjs");
const { GIFEncoder, applyPalette, quantize } = gifenc;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidencePath = path.join(projectRoot, "evidence", "07-live-end-to-end.json");

function readConfig(envPath) {
  const config = {};
  for (const line of fsSync.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*unifi\.([^:]+):(.*)$/);
    if (match) config[match[1].trim()] = match[2].trim();
  }
  for (const key of ["api.host", "user", "password"]) {
    if (!config[key]) throw new Error(`Missing unifi.${key} in the environment file.`);
  }
  return config;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function frameData(width, height, color, alternate) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = x < width / 2 ? color[0] : alternate ? 238 : 205;
      data[offset + 1] = y < height / 2 ? color[1] : alternate ? 222 : 92;
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  return data;
}

async function createAnimatedSource(filePath) {
  const encoder = GIFEncoder();
  const colors = [
    [24, 110, 82],
    [38, 78, 126],
    [178, 92, 56],
    [92, 74, 132],
  ];
  colors.forEach((color, index) => {
    const pixels = frameData(120, 240, color, index % 2 === 0);
    const palette = quantize(pixels, 64);
    encoder.writeFrame(applyPalette(pixels, palette), 120, 240, {
      palette,
      delay: 120,
      repeat: 0,
    });
  });
  encoder.finish();
  await fs.writeFile(filePath, Buffer.from(encoder.bytes()));
}

async function createStaticSource(filePath, format) {
  let image = sharp({
    create: {
      width: 300,
      height: 180,
      channels: 4,
      background: { r: 34, g: 103, b: 78, alpha: 1 },
    },
  }).composite([
    {
      input: Buffer.from(
        `<svg width="300" height="180">
          <rect x="30" y="24" width="240" height="132" rx="22" fill="#dce9a5"/>
          <circle cx="150" cy="90" r="38" fill="#f4d06f"/>
        </svg>`,
      ),
    },
  ]);
  if (format === "jpeg") image = image.jpeg({ quality: 90 });
  else if (format === "webp") image = image.webp({ quality: 90 });
  else if (format === "avif") image = image.avif({ quality: 70 });
  else if (format === "tiff") image = image.tiff();
  else image = image.png();
  await image.toFile(filePath);
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return { body: JSON.parse(text), text };
  } catch {
    return { body: null, text };
  }
}

const envPath = process.env.LOOPFRAME_ENV_FILE || "C:/Userdata/casa/.env";
const config = readConfig(envPath);
const origin = `https://${config["api.host"]}`;
const suffix = Date.now().toString().slice(-10);
const roleName = `Loopframe Test ${suffix}`;
const localUsername = `loopframe-${suffix}`;
const localPassword = `Lf${suffix}Aa!`;
const temporaryDirectory = path.join(projectRoot, ".loopframe-test", `live-${suffix}`);
await fs.mkdir(temporaryDirectory, { recursive: true });
const result = {
  startedAt: new Date().toISOString(),
  status: "running",
  account: null,
  permissions: null,
  liveImages: 0,
  matrixCases: 0,
  staticFormatCases: 0,
  rollbackChecks: 0,
  experimentalDiscovery: null,
  fits: Object.keys(FIT_MODES),
  templates: Object.keys(TEMPLATES),
  failures: [],
};

let ownerApi;
let ownerAuth;
let ownerLogin;
let role;
let user;
let testClient;
let device;
let baseline;
let activeUploadPath = "";
let baselineUserCount;
let baselineRoleCount;

async function ownerRequest(pathname, options = {}) {
  return ownerApi.fetch(pathname, {
    ...options,
    headers: {
      ...ownerAuth,
      ...(options.headers || {}),
    },
  });
}

async function setBackground(client, deviceId, background, backgrounds) {
  await client.applyBackground(deviceId, background, backgrounds);
}

async function uploadCase(client, targetDevice, sourcePath, options, filename) {
  const preparedPath = path.join(temporaryDirectory, filename);
  const processed = await processImage(sourcePath, {
    ...options,
    targetWidth: targetDevice.screen.width,
    targetHeight: targetDevice.screen.height,
  });
  await fs.writeFile(preparedPath, processed.buffer);
  const preparedBytes = await fs.readFile(preparedPath);
  assert.equal(sha256(preparedBytes), processed.digest);
  assert.equal(processed.output.width, targetDevice.screen.width);
  assert.equal(processed.output.height, targetDevice.screen.height);
  assert.equal(processed.options.fit, options.fit);
  assert.equal(processed.options.template, options.template);

  const backup = await client.captureBackground(targetDevice.deviceId);
  const published = await client.publish(targetDevice.deviceId, preparedPath, backup);
  activeUploadPath = published.uploadedPath;
  const active = await client.captureBackground(targetDevice.deviceId);
  assert.equal(active.previousBg, published.uploadedPath);
  assert.ok((active.previousBgs || "").split(",").includes(published.uploadedPath));

  const restored = await client.restore(targetDevice.deviceId, backup, published.uploadedPath);
  assert.equal(restored, true);
  activeUploadPath = "";
  const finalState = await client.captureBackground(targetDevice.deviceId);
  assert.equal(finalState.previousBg, baseline.previousBg);
  assert.equal(finalState.previousBgs, baseline.previousBgs);

  result.liveImages += 1;
  result.rollbackChecks += 1;
  return {
    digest: processed.digest,
    fit: processed.options.fit,
    template: processed.options.template,
    bytes: preparedBytes.length,
  };
}

try {
  await createAnimatedSource(path.join(temporaryDirectory, "matrix.gif"));
  ownerApi = await request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const ownerLoginResponse = await ownerApi.post("/api/auth/login", {
    data: { username: config.user, password: config.password },
  });
  if (!ownerLoginResponse.ok()) throw new Error(`Owner login failed with HTTP ${ownerLoginResponse.status()}.`);
  ownerLogin = await ownerLoginResponse.json();
  ownerAuth = {
    "X-CSRF-Token": ownerLoginResponse.headers()["x-csrf-token"] || "",
    "X-UserId": ownerLogin.unique_id,
  };

  const usersBeforeResponse = await ownerRequest(
    "/proxy/users/api/v2/users/admin/uos?page_num=1&page_size=999",
  );
  const usersBefore = await usersBeforeResponse.json();
  const owner = usersBefore.data.find((entry) =>
    entry.roles?.some((roleEntry) => roleEntry.name === "Owner"),
  );
  if (!owner?.email) throw new Error("The owner email could not be resolved.");
  baselineUserCount = usersBefore.data.length;

  const rolesBeforeResponse = await ownerRequest("/proxy/users/api/v2/custom_roles");
  const rolesBefore = await rolesBeforeResponse.json();
  baselineRoleCount = rolesBefore.data.length;

  const [emailName, emailDomain] = owner.email.split("@");
  const testEmail = `${emailName}+loopframe-${suffix}@${emailDomain}`;

  const roleResponse = await ownerRequest("/proxy/users/api/v2/custom_role", {
    method: "POST",
    data: {
      name: roleName,
      is_private: false,
      permissions: [{ manifest_unique_key: "access.management", formulas: ["admin"] }],
      permission_resources: [],
    },
  });
  const roleBody = await readJsonResponse(roleResponse);
  if (!roleResponse.ok() || !roleBody.body?.data?.unique_id) {
    throw new Error(`Role creation failed with HTTP ${roleResponse.status()}.`);
  }
  role = roleBody.body.data;
  assert.deepEqual(role.permissions, [
    { manifest_unique_key: "access.management", formulas: ["admin"] },
  ]);

  const userResponse = await ownerRequest("/proxy/users/api/v2/user", {
    method: "POST",
    data: {
      user_email: testEmail,
      first_name: "Loopframe",
      last_name: "Test",
      username: localUsername,
      password: localPassword,
      only_local_account: true,
      role_id: role.unique_id,
    },
  });
  const userBody = await readJsonResponse(userResponse);
  if (!userResponse.ok() || !userBody.body?.data?.unique_id) {
    throw new Error(`Account creation failed with HTTP ${userResponse.status()}.`);
  }
  user = userBody.body.data;
  result.account = {
    created: true,
    localOnly: true,
    applicationPermissions: { access: "Full Admin", others: "None" },
  };

  testClient = new UniFiClient(config["api.host"]);
  const profile = await testClient.login(localUsername, localPassword);
  assert.equal(profile.unique_id, user.unique_id);
  assert.ok(profile.roles?.some((entry) => entry.name === roleName));

  const profilePermissions = await testClient.getProfile();
  assert.ok(profilePermissions.roles.some((entry) => entry.name === roleName));

  const devices = await testClient.listDevices();
  assert.ok(devices.length >= 1);
  device = devices.find((entry) => /G6 Pro Entry/i.test(`${entry.model} ${entry.type}`)) || devices[0];
  assert.equal(device.connected, true);
  const experimentalDevices = await testClient.listDevices({ experimental: true });
  assert.ok(experimentalDevices.some((entry) => entry.deviceId === device.deviceId));
  await assert.rejects(
    () => new ProtectClient(testClient).listDevices(),
    (error) => error.status === 403,
    "An Access only account must not gain Protect access",
  );
  result.experimentalDiscovery = {
    accessOnlyProtectDenied: true,
    detectedAccessScreenDevices: experimentalDevices.length,
  };
  baseline = await testClient.captureBackground(device.deviceId);
  assert.ok(baseline.previousBg);

  for (const pathname of [
    "/proxy/protect/integration/v1/meta/info",
    "/proxy/network/api/s/default/stat/device",
  ]) {
    await assert.rejects(
      () => testClient.request(pathname),
      (error) => error.status === 403,
      `${pathname} should be denied`,
    );
  }
  result.permissions = {
    accessTopology: "allowed",
    protectAdministration: "denied",
    networkAdministration: "denied",
  };

  const animatedSource = path.join(temporaryDirectory, "matrix.gif");
  const fitNames = Object.keys(FIT_MODES);
  const templateNames = Object.keys(TEMPLATES);
  for (const [fitIndex, fit] of fitNames.entries()) {
    for (const [templateIndex, template] of templateNames.entries()) {
      const options = {
        fit,
        template,
        zoom: [72, 100, 125, 145][(fitIndex + templateIndex) % 4],
        offsetX: [-60, -25, 0, 25, 60][templateIndex],
        offsetY: [-45, -15, 20, 50, 0][fitIndex],
        background: fitIndex % 2 ? "#23362c" : "#111612",
      };
      const filename = `matrix-${fit}-${template}.gif`;
      await uploadCase(testClient, device, animatedSource, options, filename);
      result.matrixCases += 1;
      console.log(`live ${result.matrixCases}/${fitNames.length * templateNames.length}: ${fit} / ${template}`);
    }
  }

  const formats = ["png", "jpeg", "webp", "avif", "tiff"];
  for (const [index, format] of formats.entries()) {
    const sourcePath = path.join(temporaryDirectory, `static.${format}`);
    await createStaticSource(sourcePath, format);
    await uploadCase(testClient, device, sourcePath, {
      fit: fitNames[index % fitNames.length],
      template: templateNames[index % templateNames.length],
      zoom: 90 + index * 10,
      offsetX: index % 2 ? 30 : -30,
      offsetY: index % 3 ? 20 : -20,
      background: "#151d18",
    }, `static-${format}.gif`);
    result.staticFormatCases += 1;
    console.log(`live static ${result.staticFormatCases}/${formats.length}: ${format}`);
  }

  const finalState = await testClient.captureBackground(device.deviceId);
  assert.equal(finalState.previousBg, baseline.previousBg);
  assert.equal(finalState.previousBgs, baseline.previousBgs);
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.failures.push(error.message);
  throw error;
} finally {
  if (testClient && device && baseline) {
    try {
      if (activeUploadPath) {
        await testClient.restore(device.deviceId, baseline, activeUploadPath);
      } else {
        await setBackground(testClient, device.deviceId, baseline.previousBg, baseline.previousBgs);
      }
      const restored = await testClient.captureBackground(device.deviceId);
      result.restoredExactBaseline =
        restored.previousBg === baseline.previousBg &&
        restored.previousBgs === baseline.previousBgs;
    } catch (error) {
      result.restoredExactBaseline = false;
      result.failures.push(`Device rollback failed: ${error.message}`);
    }
  }

  if (ownerApi && ownerAuth && user?.unique_id) {
    const deactivateResponse = await ownerRequest(
      `/proxy/users/api/v2/user/${user.unique_id}/deactivate?isULP=1`,
      { method: "PUT" },
    );
    const deactivateBody = await readJsonResponse(deactivateResponse);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const response = await ownerRequest(`/proxy/users/api/v2/user/${user.unique_id}`, {
      method: "DELETE",
    });
    const deleteBody = await readJsonResponse(response);
    result.accountDeleted = deactivateBody.body?.code === 1 && deleteBody.body?.code === 1;
  }
  if (ownerApi && ownerAuth && role?.unique_id) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const response = await ownerRequest(`/proxy/users/api/v2/custom_role/${role.unique_id}`, {
      method: "DELETE",
    });
    const deleteBody = await readJsonResponse(response);
    result.roleDeleted = deleteBody.body?.code === 1;
  }
  if (ownerApi && ownerAuth) {
    const usersAfter = await ownerRequest(
      "/proxy/users/api/v2/users/admin/uos?page_num=1&page_size=999",
    ).then((response) => response.json());
    const rolesAfter = await ownerRequest("/proxy/users/api/v2/custom_roles").then((response) =>
      response.json(),
    );
    result.usersRestored = usersAfter.data.length === baselineUserCount;
    result.rolesRestored = rolesAfter.data.length === baselineRoleCount;
  }
  if (ownerApi) await ownerApi.dispose();
  result.temporaryDirectory = path.relative(projectRoot, temporaryDirectory);
  result.completedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
}
