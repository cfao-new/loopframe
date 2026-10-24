const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { UniFiClient } = require("../src/unifi-client.cjs");
const { ProtectClient } = require("../src/protect-client.cjs");

async function createProtectConsole() {
  const calls = [];
  let lcdMessage = {
    type: "CUSTOM_MESSAGE",
    text: "Original",
    resetAt: null,
  };
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url, "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, body });

    const send = (status, value, headers = {}) => {
      response.writeHead(status, { "Content-Type": "application/json", ...headers });
      response.end(JSON.stringify(value));
    };

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      send(200, {
        unique_id: "protect-user",
        username: "protect-test",
      }, {
        "Set-Cookie": "TOKEN=protect-token; Path=/",
        "X-CSRF-Token": "protect-csrf",
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/users/self") {
      send(200, { unique_id: "protect-user", username: "protect-test" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/proxy/protect/api/bootstrap") {
      send(200, {
        cameras: [
          {
            id: "g4-pro",
            name: "Front bell",
            type: "UVC G4 Doorbell Pro",
            marketName: "G4 Doorbell Pro",
            state: "CONNECTED",
            featureFlags: { hasLcdScreen: true, hasColorLcdScreen: true },
            lcdMessage,
          },
          {
            id: "g4-instant",
            name: "Garden",
            type: "UVC G4 Instant",
            marketName: "G4 Instant",
            state: "CONNECTED",
            featureFlags: { hasLcdScreen: false, hasColorLcdScreen: false },
          },
          {
            id: "g2-pro",
            name: "Office reader",
            type: "UA-G2-Pro",
            marketName: "G2 Reader Pro",
            state: "CONNECTED",
            featureFlags: { hasLcdScreen: true, hasColorLcdScreen: true },
            lcdMessage: {},
          },
        ],
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/proxy/protect/api/cameras/g4-pro") {
      send(200, {
        id: "g4-pro",
        name: "Front bell",
        lcdMessage,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/proxy/protect/api/files/animations") {
      assert.match(request.headers["content-type"], /^multipart\/form-data;/);
      assert.match(body.toString("utf8"), /filename="prepared.gif"/);
      send(200, {
        name: "welcome.gif",
        type: "animations",
        path: "/data/animations/welcome.gif",
      });
      return;
    }

    if (request.method === "PATCH" && url.pathname === "/proxy/protect/api/cameras/g4-pro") {
      const value = JSON.parse(body.toString("utf8"));
      lcdMessage = value.lcdMessage;
      send(200, { id: "g4-pro", lcdMessage });
      return;
    }

    send(404, { message: "not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("Protect discovery keeps LCD devices and uses the G4 community fallback", async () => {
  const mock = await createProtectConsole();
  try {
    const access = new UniFiClient(mock.origin);
    await access.login("protect-test", "password");
    const protect = new ProtectClient(access);
    const devices = await protect.listDevices();
    assert.equal(devices.length, 2);
    assert.equal(devices[0].id, "protect:g4-pro");
    assert.equal(devices[0].sourceApp, "protect");
    assert.equal(devices[0].screen.width, 240);
    assert.equal(devices[0].screen.height, 240);
    assert.equal(devices[0].screen.confidence, "unverified");
    assert.equal(devices[0].upload.transport, "protect-lcd");
    assert.equal(devices[0].upload.status, "experimental");
    assert.equal(devices[0].upload.animated, "unverified");
    assert.equal(devices[1].id, "protect:g2-pro");
    assert.equal(devices[1].screen.width, 286);
    assert.equal(devices[1].screen.height, 1280);
    assert.equal(devices[1].artworkUrl, "");
  } finally {
    await mock.close();
  }
});

test("Protect uploads use the animation file and IMAGE LCD message route", async () => {
  const mock = await createProtectConsole();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "loopframe-protect-"));
  const prepared = path.join(directory, "prepared.gif");
  await fs.writeFile(prepared, Buffer.from("GIF89a-test"));
  try {
    const access = new UniFiClient(mock.origin);
    await access.login("protect-test", "password");
    const protect = new ProtectClient(access);
    const backup = await protect.captureWelcome("g4-pro");
    const published = await protect.publish("g4-pro", prepared, backup);
    assert.equal(published.uploadedAsset.name, "welcome.gif");
    assert.equal(
      mock.calls.some((call) =>
        call.method === "POST" &&
        call.path === "/proxy/protect/api/files/animations"
      ),
      true,
    );
    const patch = mock.calls.find((call) =>
      call.method === "PATCH" &&
      call.path === "/proxy/protect/api/cameras/g4-pro"
    );
    assert.deepEqual(JSON.parse(patch.body.toString("utf8")), {
      lcdMessage: {
        type: "IMAGE",
        text: "welcome.gif",
        resetAt: null,
      },
    });
    assert.equal(await protect.restore("g4-pro", backup.previousLcdMessage), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
    await mock.close();
  }
});

test("artwork downloads reject hosts that are not approved UniFi asset hosts", async () => {
  const mock = await createProtectConsole();
  try {
    const access = new UniFiClient(mock.origin);
    await access.login("protect-test", "password");
    await assert.rejects(
      () => access.getDeviceArtwork("https://example.com/device.png"),
      /not from UniFi/,
    );
  } finally {
    await mock.close();
  }
});
