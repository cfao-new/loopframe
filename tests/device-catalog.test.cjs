const assert = require("node:assert/strict");
const test = require("node:test");
const {
  catalog,
  findScreenDevice,
  screenForDevice,
} = require("../src/device-catalog.cjs");

test("the catalog contains the six confirmed screen models", () => {
  assert.deepEqual(
    catalog.screenDevices.map((entry) => entry.name).sort(),
    [
      "UniFi Access G2 Reader Pro",
      "UniFi Access G3 Intercom",
      "UniFi Access Intercom Viewer",
      "UniFi Access Intercom previous generation",
      "UniFi G4 Doorbell Pro",
      "UniFi G6 Pro Entry",
    ],
  );
  for (const entry of catalog.screenDevices) {
    assert.match(entry.sourceUrl, /^https:\/\/techspecs\.ui\.com\//);
    assert.ok(entry.screen.width >= 240);
    assert.ok(entry.screen.height >= 240);
    assert.ok(["portrait", "square"].includes(entry.screen.orientation));
    assert.ok(["verified", "unverified"].includes(entry.screen.confidence));
    assert.ok(["verified", "experimental", "unsupported"].includes(entry.upload.status));
  }
});

test("official landscape pixel arrays resolve to portrait studio canvases", () => {
  const cases = [
    [{ model: "G6 Pro Entry" }, 480, 854, 480, 854],
    [{ model: "UA G3 Intercom" }, 600, 1024, 1024, 600],
    [{ model: "UniFi Access Intercom" }, 600, 1024, 1024, 600],
    [{ model: "Access Intercom Viewer" }, 720, 1280, 1280, 720],
    [{ model: "UA-G2-Pro" }, 286, 1280, 1280, 286],
    [{ model: "G4 Doorbell Pro" }, 240, 240, 240, 240],
  ];
  for (const [device, width, height, nativeWidth, nativeHeight] of cases) {
    const screen = screenForDevice(device);
    assert.ok(screen, JSON.stringify(device));
    assert.equal(screen.width, width, JSON.stringify(device));
    assert.equal(screen.height, height, JSON.stringify(device));
    assert.equal(screen.nativeWidth, nativeWidth, JSON.stringify(device));
    assert.equal(screen.nativeHeight, nativeHeight, JSON.stringify(device));
  }
});

test("detected dimensions replace fallbacks and rotate when needed", () => {
  const g4 = screenForDevice(
    { model: "G4 Doorbell Pro" },
    { width: 320, height: 240, orientation: "portrait" },
  );
  assert.equal(g4.width, 240);
  assert.equal(g4.height, 320);
  assert.equal(g4.nativeWidth, 320);
  assert.equal(g4.nativeHeight, 240);
  assert.equal(g4.source, "device");
  assert.equal(g4.confidence, "detected");
});

test("the G4 community fallback stays visibly unverified", () => {
  const g4 = screenForDevice({ model: "G4 Doorbell Pro" });
  assert.equal(g4.width, 240);
  assert.equal(g4.height, 240);
  assert.equal(g4.source, "community");
  assert.equal(g4.confidence, "unverified");
  assert.match(g4.note, /does not publish its resolution/i);
});

test("doorbells without a display stay out of the screen catalog", () => {
  for (const model of ["G6 Entry", "Doorbell Lite"]) {
    assert.equal(findScreenDevice({ model }), null, model);
  }
});
