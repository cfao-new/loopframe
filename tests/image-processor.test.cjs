const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");
const {
  FIT_MODES,
  TEMPLATES,
  TARGET_WIDTH,
  TARGET_HEIGHT,
  inspectImage,
  processImage,
} = require("../src/image-processor.cjs");

sharp.cache(false);

let temporaryDirectory;
let animatedGif;

function rgbaFrame(width, height, color, accent = false) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const active = accent && y > height / 2;
      data[index] = active ? 240 : color[0];
      data[index + 1] = active ? 214 : color[1];
      data[index + 2] = active ? 93 : color[2];
      data[index + 3] = 255;
    }
  }
  return data;
}

async function createAnimatedGif(filePath, width = 120, height = 240) {
  const encoder = GIFEncoder();
  const colors = [
    [24, 110, 82],
    [37, 82, 125],
    [180, 94, 60],
    [92, 74, 132],
  ];
  colors.forEach((color, index) => {
    const rgba = rgbaFrame(width, height, color, index % 2 === 0);
    const palette = quantize(rgba, 32);
    const indexed = applyPalette(rgba, palette);
    encoder.writeFrame(indexed, width, height, {
      palette,
      delay: 120 + index * 10,
      repeat: 0,
    });
  });
  encoder.finish();
  await fs.writeFile(filePath, Buffer.from(encoder.bytes()));
}

async function createStatic(filePath, format, width = 320, height = 180) {
  let image = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 32, g: 108, b: 84, alpha: 1 },
    },
  }).composite([
    {
      input: Buffer.from(
        `<svg width="${width}" height="${height}">
          <rect x="${width * 0.15}" y="${height * 0.2}" width="${width * 0.7}" height="${height * 0.6}"
            rx="18" fill="#dce9a5"/>
          <circle cx="${width * 0.5}" cy="${height * 0.5}" r="${height * 0.18}" fill="#f6f2df"/>
        </svg>`,
      ),
    },
  ]);
  if (format === "jpeg") image = image.jpeg({ quality: 90 });
  else if (format === "webp") image = image.webp({ quality: 90 });
  else if (format === "tiff") image = image.tiff();
  else if (format === "avif") image = image.avif({ quality: 70 });
  else image = image.png();
  await image.toFile(filePath);
}

test.before(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "loopframe-test-"));
  animatedGif = path.join(temporaryDirectory, "animated.gif");
  await createAnimatedGif(animatedGif);
});

test.after(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("every fit mode and template renders a valid target GIF", async () => {
  for (const fit of Object.keys(FIT_MODES)) {
    for (const template of Object.keys(TEMPLATES)) {
      const result = await processImage(animatedGif, {
        fit,
        template,
        zoom: 100,
        offsetX: 0,
        offsetY: 0,
        background: "#111612",
      });
      assert.equal(result.output.width, TARGET_WIDTH, `${fit}/${template} width`);
      assert.equal(result.output.height, TARGET_HEIGHT, `${fit}/${template} height`);
      assert.equal(result.output.pages, 4, `${fit}/${template} frame count`);
      assert.equal(result.output.durationMs, 540, `${fit}/${template} duration`);
      assert.match(result.digest, /^[0-9a-f]{64}$/);
      assert.ok(result.buffer.length > 100, `${fit}/${template} output bytes`);
    }
  }
});

test("all fit modes render and produce the expected framing variants", async () => {
  const digests = new Set();
  for (const fit of Object.keys(FIT_MODES)) {
    const result = await processImage(animatedGif, {
      fit,
      template: "none",
      zoom: 100,
      background: "#111612",
    });
    digests.add(result.digest);
  }
  assert.ok(digests.size >= 4);
});

test("all templates alter the final frames", async () => {
  const noTemplate = await processImage(animatedGif, {
    fit: "fill",
    template: "none",
    zoom: 100,
  });
  const baseFrame = await sharp(noTemplate.buffer, { page: 0, pages: 1 }).ensureAlpha().raw().toBuffer();
  const center = (TARGET_HEIGHT / 2) * TARGET_WIDTH * 4 + (TARGET_WIDTH / 2) * 4;
  assert.ok(baseFrame[center] + baseFrame[center + 1] + baseFrame[center + 2] > 90);
  for (const template of Object.keys(TEMPLATES).filter((key) => key !== "none")) {
    const result = await processImage(animatedGif, {
      fit: "fill",
      template,
      zoom: 100,
    });
    for (let page = 0; page < 4; page += 1) {
      const noOverlayFrame = await sharp(noTemplate.buffer, { page, pages: 1 }).raw().toBuffer();
      const frame = await sharp(result.buffer, { page, pages: 1 }).raw().toBuffer();
      assert.notEqual(Buffer.compare(frame, noOverlayFrame), 0, `${template} must change frame ${page}`);
    }
  }
});

test("zoom, horizontal position, vertical position, and background affect output", async () => {
  const baseline = await processImage(animatedGif, {
    fit: "contain",
    template: "none",
    zoom: 100,
    offsetX: 0,
    offsetY: 0,
    background: "#111612",
  });
  const containVariants = [
    { zoom: 140 },
    { offsetX: 60 },
    { background: "#f4d06f" },
  ];
  for (const variant of containVariants) {
    const result = await processImage(animatedGif, {
      fit: "contain",
      template: "none",
      zoom: 100,
      offsetX: 0,
      offsetY: 0,
      background: "#111612",
      ...variant,
    });
    assert.notEqual(result.digest, baseline.digest, JSON.stringify(variant));
  }

  const fillBaseline = await processImage(animatedGif, {
    fit: "fill",
    template: "none",
    zoom: 150,
    offsetY: 0,
  });
  const fillMoved = await processImage(animatedGif, {
    fit: "fill",
    template: "none",
    zoom: 150,
    offsetY: -60,
  });
  assert.notEqual(fillMoved.digest, fillBaseline.digest, "vertical offset");
});

test("supported still image formats render to GIF", async () => {
  const formats = ["png", "jpeg", "webp", "avif", "tiff"];
  for (const format of formats) {
    const source = path.join(temporaryDirectory, `source.${format}`);
    await createStatic(source, format);
    const result = await processImage(source, {
      fit: "fill",
      template: "focus-frame",
      zoom: 100,
    });
    assert.ok(
      result.source.format === format || (format === "avif" && result.source.format === "heif"),
      `${format} source format`,
    );
    assert.equal(result.output.format, "gif");
    assert.equal(result.output.width, TARGET_WIDTH);
    assert.equal(result.output.height, TARGET_HEIGHT);
    assert.equal(result.output.pages, 1);
    assert.ok(result.buffer.length > 100);
  }
});

test("the preview is generated from the same rendered GIF", async () => {
  const result = await processImage(animatedGif, {
    fit: "width",
    template: "soft-top",
    zoom: 110,
    offsetX: -20,
    offsetY: 15,
  });
  assert.match(result.preview, /^data:image\/gif;base64,/);
  const preview = Buffer.from(result.preview.split(",")[1], "base64");
  const metadata = await sharp(preview).metadata();
  const stats = await sharp(preview).stats();
  assert.equal(metadata.width, TARGET_WIDTH);
  assert.equal(metadata.height, TARGET_HEIGHT);
  assert.equal(metadata.pages, 4);
  assert.equal(Buffer.compare(preview, result.buffer), 0);
  assert.ok(stats.channels[0].mean + stats.channels[1].mean + stats.channels[2].mean > 30);
});

test("the source is inspected without rendering a replacement file", async () => {
  const metadata = await inspectImage(animatedGif);
  assert.equal(metadata.width, 120);
  assert.equal(metadata.height, 240);
  assert.equal(metadata.frames, 4);
  assert.equal(metadata.durationMs, 540);
  assert.equal(metadata.format, "gif");
});

test("every catalog display renders at its exact panel dimensions", async () => {
  const catalog = require("../src/device-screen-catalog.json");
  for (const entry of catalog.screenDevices) {
    const result = await processImage(animatedGif, {
      fit: "contain",
      template: "none",
      zoom: 100,
      targetWidth: entry.screen.width,
      targetHeight: entry.screen.height,
    });
    assert.equal(result.output.width, entry.screen.width, entry.name);
    assert.equal(result.output.height, entry.screen.height, entry.name);
    assert.equal(result.options.targetWidth, entry.screen.width, entry.name);
    assert.equal(result.options.targetHeight, entry.screen.height, entry.name);
  }
});

test("option values are bounded before rendering", async () => {
  const result = await processImage(animatedGif, {
    fit: "unknown",
    template: "unknown",
    zoom: 900,
    offsetX: -900,
    offsetY: 900,
    background: "not-a-color",
  });
  assert.equal(result.options.fit, "fill");
  assert.equal(result.options.template, "none");
  assert.equal(result.options.zoom, 250);
  assert.equal(result.options.offsetX, -100);
  assert.equal(result.options.offsetY, 100);
  assert.equal(result.options.background, "#000000");
});
