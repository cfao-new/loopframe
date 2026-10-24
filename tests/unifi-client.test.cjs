const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { UniFiClient } = require("../src/unifi-client.cjs");

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function createMockConsole() {
  const calls = [];
  let currentBg = "backgrounds/original.png";
  let currentBgs = "backgrounds/original.png,backgrounds/second.png";
  let failNextSettings = false;
  let origin;

  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url, "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.search, body });

    const send = (status, value, headers = {}) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        ...headers,
      });
      response.end(JSON.stringify(value));
    };

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      send(200, {
        unique_id: "session-user",
        full_name: "Loopframe Test",
        username: "loopframe-test",
      }, {
        "Set-Cookie": "TOKEN=test-token; Path=/",
        "X-CSRF-Token": "test-csrf",
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/users/self") {
      send(200, {
        unique_id: "session-user",
        full_name: "Loopframe Test",
        username: "loopframe-test",
        roles: [{ name: "Loopframe" }],
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/proxy/access/api/v2/devices/topology4") {
      send(200, {
        code: 1,
        data: [
          {
            unique_id: "doorbell-1",
            name: "Front door",
            device_type: "UVC G6 Pro Entry",
            model: "G6 Pro Entry",
            firmware: "5.5.43",
            is_camera: true,
            is_connected: true,
            configs: [
              { key: "bg", value: currentBg },
              { key: "bgs", value: currentBgs },
            ],
            images: {
              l: `${origin}/device-artwork.png`,
              xxl: `${origin}/device-artwork.png`,
            },
          },
          {
            unique_id: "intercom-1",
            name: "Side entrance",
            device_type: "UA G3 Intercom",
            model: "G3 Intercom",
            is_camera: true,
            is_connected: true,
            configs: [
              { key: "bg", value: "backgrounds/intercom.png" },
              { key: "bgs", value: "backgrounds/intercom.png" },
            ],
            images: {
              xxl: `${origin}/device-artwork.png`,
            },
          },
          {
            unique_id: "camera-without-screen",
            name: "Camera only",
            device_type: "UVC G6 Entry",
            model: "G6 Entry",
            is_camera: true,
            is_connected: true,
            configs: [
              { key: "bg", value: "backgrounds/camera.png" },
              { key: "bgs", value: "backgrounds/camera.png" },
            ],
          },
          {
            unique_id: "reader-no-background-route",
            name: "Staff door reader",
            device_type: "UA-G2-Pro",
            model: "G2 Reader Pro",
            is_camera: false,
            is_connected: true,
            configs: [],
          },
          {
            unique_id: "hub-1",
            name: "Door hub",
            device_type: "UA-Hub-Door-Mini",
            is_camera: false,
            is_connected: true,
            configs: [{ key: "alias", value: "Door hub" }],
          },
        ],
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/proxy/access/api/v2/device/doorbell-1/resources"
    ) {
      assert.match(request.headers["content-type"], /^multipart\/form-data;/);
      assert.match(body.toString("utf8"), /name="type"\r\n\r\nbgs/);
      assert.match(body.toString("utf8"), /filename="prepared.gif"/);
      send(200, { code: 1, data: { filepath: "backgrounds/loopframe.gif" } });
      return;
    }

    if (
      request.method === "PUT" &&
      url.pathname === "/proxy/access/api/v2/device/doorbell-1/settings"
    ) {
      if (failNextSettings) {
        failNextSettings = false;
        send(500, { code: 0, msg: "simulated settings failure" });
        return;
      }
      const settings = JSON.parse(body.toString("utf8"));
      currentBg = settings.find((item) => item.key === "bg").value;
      currentBgs = settings.find((item) => item.key === "bgs").value;
      send(200, { code: 1 });
      return;
    }

    if (
      request.method === "DELETE" &&
      url.pathname === "/proxy/access/api/v2/device/doorbell-1/resources/bgs"
    ) {
      const filename = url.searchParams.get("filename");
      currentBgs = currentBgs.split(",").filter((item) => item !== filename).join(",");
      send(200, { code: 1 });
      return;
    }

    if (request.method === "GET" && url.pathname === "/device-artwork.png") {
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(onePixelPng);
      return;
    }

    send(404, { code: 0, msg: "not found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    calls,
    setFailure: () => {
      failNextSettings = true;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("the client discovers only compatible devices and restores the exact background", async () => {
  const mock = await createMockConsole();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "loopframe-unifi-"));
  const prepared = path.join(directory, "prepared.gif");
  await fs.writeFile(prepared, Buffer.from("GIF89a-test"));

  try {
    const client = new UniFiClient(mock.origin);
    const profile = await client.login("loopframe-test", "test-password");
    assert.equal(profile.username, "loopframe-test");
    const stableDevices = await client.listDevices();
    assert.equal(stableDevices.length, 1);
    assert.equal(stableDevices[0].id, "access:doorbell-1");
    const devices = await client.listDevices({ experimental: true });
    assert.equal(devices.length, 3);
    assert.equal(devices[0].id, "access:doorbell-1");
    assert.equal(devices[0].deviceId, "doorbell-1");
    assert.equal(devices[0].upload.status, "verified");
    assert.equal(devices[0].screen.width, 480);
    assert.equal(devices[0].screen.height, 854);
    assert.equal(
      devices[0].artworkUrl,
      `${mock.origin}/device-artwork.png`,
    );
    assert.equal(devices[1].id, "access:intercom-1");
    assert.equal(devices[1].upload.status, "experimental");
    assert.equal(devices[1].screen.width, 600);
    assert.equal(devices[1].screen.height, 1024);
    assert.equal(devices[2].id, "access:reader-no-background-route");
    assert.equal(devices[2].screen.width, 286);
    assert.equal(devices[2].screen.height, 1280);
    assert.equal(devices[2].upload.status, "unsupported");
    assert.ok(!devices.some((device) => device.id === "camera-without-screen"));

    const artwork = await client.getDeviceArtwork(devices[0].artworkUrl);
    assert.match(artwork.dataUrl, /^data:image\/png;base64,/);
    assert.equal(artwork.bytes, onePixelPng.length);

    const backup = await client.captureBackground("doorbell-1");
    assert.equal(backup.previousBg, "backgrounds/original.png");
    const published = await client.publish("doorbell-1", prepared, backup);
    assert.equal(published.uploadedPath, "backgrounds/loopframe.gif");
    const active = await client.captureBackground("doorbell-1");
    assert.equal(active.previousBg, "backgrounds/loopframe.gif");
    assert.match(active.previousBgs, /backgrounds\/loopframe.gif/);

    const restored = await client.restore("doorbell-1", backup, published.uploadedPath);
    assert.equal(restored, true);
    const finalState = await client.captureBackground("doorbell-1");
    assert.equal(finalState.previousBg, backup.previousBg);
    assert.equal(finalState.previousBgs, backup.previousBgs);
    assert.ok(mock.calls.some((call) => call.method === "DELETE"));
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
    await mock.close();
  }
});

test("a failed settings update removes the newly uploaded resource", async () => {
  const mock = await createMockConsole();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "loopframe-unifi-"));
  const prepared = path.join(directory, "prepared.gif");
  await fs.writeFile(prepared, Buffer.from("GIF89a-test"));

  try {
    const client = new UniFiClient(mock.origin);
    await client.login("loopframe-test", "test-password");
    const backup = await client.captureBackground("doorbell-1");
    mock.setFailure();
    await assert.rejects(() => client.publish("doorbell-1", prepared, backup), /simulated settings failure/);
    const deletes = mock.calls.filter((call) => call.method === "DELETE");
    assert.equal(deletes.length, 1);
    assert.equal(deletes[0].search, "?filename=backgrounds%2Floopframe.gif");
    const state = await client.captureBackground("doorbell-1");
    assert.equal(state.previousBg, backup.previousBg);
    assert.equal(state.previousBgs, backup.previousBgs);
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
    await mock.close();
  }
});
