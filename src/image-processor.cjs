const crypto = require("node:crypto");
const path = require("node:path");
const sharp = require("sharp");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");

const TARGET_WIDTH = 225;
const TARGET_HEIGHT = 400;

const FIT_MODES = Object.freeze({
  fill: {
    label: "Fill screen",
    description: "Cover the screen and crop anything outside it.",
  },
  contain: {
    label: "Show all",
    description: "Keep the full image visible and use the background color for empty space.",
  },
  width: {
    label: "Fit width",
    description: "Match the image width to the screen and crop or pad the height.",
  },
  height: {
    label: "Fit height",
    description: "Match the image height to the screen and crop or pad the width.",
  },
  original: {
    label: "Original size",
    description: "Keep source pixels at their current size.",
  },
  stretch: {
    label: "Stretch",
    description: "Force the image to the screen shape.",
  },
});

const TEMPLATES = Object.freeze({
  none: {
    label: "No overlay",
    description: "Keep the framed image unchanged.",
  },
  "soft-bottom": {
    label: "Bottom fade",
    description: "Add a restrained dark fade toward the lower edge.",
  },
  "soft-top": {
    label: "Top fade",
    description: "Add a restrained dark fade toward the upper edge.",
  },
  vignette: {
    label: "Soft vignette",
    description: "Darken the outer edges while keeping the center clear.",
  },
  "focus-frame": {
    label: "Focus frame",
    description: "Add a quiet frame around the usable display area.",
  },
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#000000";
}

function normalizeOptions(options = {}) {
  const fit = Object.hasOwn(FIT_MODES, options.fit) ? options.fit : "fill";
  const template = Object.hasOwn(TEMPLATES, options.template) ? options.template : "none";
  return {
    fit,
    template,
    zoom: clamp(Number(options.zoom) || 100, 25, 250),
    offsetX: clamp(Number(options.offsetX) || 0, -100, 100),
    offsetY: clamp(Number(options.offsetY) || 0, -100, 100),
    background: normalizedColor(options.background),
  };
}

function baseDimensions(sourceWidth, sourceHeight, options) {
  const zoom = options.zoom / 100;
  if (options.fit === "stretch") {
    return { width: TARGET_WIDTH, height: TARGET_HEIGHT };
  }

  let scale;
  if (options.fit === "fill") {
    scale = Math.max(TARGET_WIDTH / sourceWidth, TARGET_HEIGHT / sourceHeight);
  } else if (options.fit === "contain") {
    scale = Math.min(TARGET_WIDTH / sourceWidth, TARGET_HEIGHT / sourceHeight);
  } else if (options.fit === "width") {
    scale = TARGET_WIDTH / sourceWidth;
  } else if (options.fit === "height") {
    scale = TARGET_HEIGHT / sourceHeight;
  } else {
    scale = 1;
  }

  return {
    width: Math.max(1, Math.round(sourceWidth * scale * zoom)),
    height: Math.max(1, Math.round(sourceHeight * scale * zoom)),
  };
}

function placementFor(size, targetSize, position) {
  if (size > targetSize) {
    const range = size - targetSize;
    const midpoint = range / 2;
    return {
      crop: clamp(Math.round(midpoint * (1 + position / 100)), 0, range),
      padBefore: 0,
      padAfter: 0,
    };
  }

  const available = targetSize - size;
  const before = clamp(Math.round((available / 2) * (1 + position / 100)), 0, available);
  return { crop: 0, padBefore: before, padAfter: available - before };
}

function backgroundColor(value) {
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
    a: 255,
  };
}

function frameIntoCanvas(sourceFrame, sourceWidth, sourceHeight, horizontal, vertical, background) {
  const target = Buffer.alloc(TARGET_WIDTH * TARGET_HEIGHT * 4);
  for (let index = 0; index < target.length; index += 4) {
    target[index] = background.r;
    target[index + 1] = background.g;
    target[index + 2] = background.b;
    target[index + 3] = 255;
  }

  const sourceX = sourceWidth > TARGET_WIDTH ? horizontal.crop : 0;
  const sourceY = sourceHeight > TARGET_HEIGHT ? vertical.crop : 0;
  const destinationX = sourceWidth < TARGET_WIDTH ? horizontal.padBefore : 0;
  const destinationY = sourceHeight < TARGET_HEIGHT ? vertical.padBefore : 0;
  const copyWidth = Math.min(sourceWidth, TARGET_WIDTH);
  const copyHeight = Math.min(sourceHeight, TARGET_HEIGHT);

  for (let y = 0; y < copyHeight; y += 1) {
    for (let x = 0; x < copyWidth; x += 1) {
      const sourceIndex = ((sourceY + y) * sourceWidth + sourceX + x) * 4;
      const targetIndex = ((destinationY + y) * TARGET_WIDTH + destinationX + x) * 4;
      const alpha = sourceFrame[sourceIndex + 3] / 255;
      if (alpha >= 1) {
        target[targetIndex] = sourceFrame[sourceIndex];
        target[targetIndex + 1] = sourceFrame[sourceIndex + 1];
        target[targetIndex + 2] = sourceFrame[sourceIndex + 2];
      } else if (alpha > 0) {
        const inverse = 1 - alpha;
        target[targetIndex] = Math.round(sourceFrame[sourceIndex] * alpha + target[targetIndex] * inverse);
        target[targetIndex + 1] = Math.round(sourceFrame[sourceIndex + 1] * alpha + target[targetIndex + 1] * inverse);
        target[targetIndex + 2] = Math.round(sourceFrame[sourceIndex + 2] * alpha + target[targetIndex + 2] * inverse);
      }
      target[targetIndex + 3] = 255;
    }
  }
  return target;
}

function overlaySvg(template) {
  const opening = `<svg width="${TARGET_WIDTH}" height="${TARGET_HEIGHT}" xmlns="http://www.w3.org/2000/svg">`;
  const closing = "</svg>";
  if (template === "soft-bottom") {
    return Buffer.from(`${opening}
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stop-color="#000000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0.72"/>
        </linearGradient>
      </defs>
      <rect width="225" height="400" fill="url(#g)"/>
    ${closing}`);
  }
  if (template === "soft-top") {
    return Buffer.from(`${opening}
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000000" stop-opacity="0.68"/>
          <stop offset="0.46" stop-color="#000000" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="225" height="400" fill="url(#g)"/>
    ${closing}`);
  }
  if (template === "vignette") {
    return Buffer.from(`${opening}
      <defs>
        <radialGradient id="g" cx="50%" cy="46%" r="72%">
          <stop offset="0.45" stop-color="#000000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0.58"/>
        </radialGradient>
      </defs>
      <rect width="225" height="400" fill="url(#g)"/>
    ${closing}`);
  }
  if (template === "focus-frame") {
    return Buffer.from(`${opening}
      <rect x="10.5" y="10.5" width="204" height="379" rx="18"
        fill="none" stroke="#ffffff" stroke-opacity="0.38" stroke-width="1.5"/>
      <path d="M22 42V28a6 6 0 0 1 6-6h14 M183 22h14a6 6 0 0 1 6 6v14
        M203 358v14a6 6 0 0 1-6 6h-14 M42 378H28a6 6 0 0 1-6-6v-14"
        fill="none" stroke="#ffffff" stroke-opacity="0.76" stroke-width="2"
        stroke-linecap="round"/>
    ${closing}`);
  }
  return null;
}

function blendOverlay(frame, overlay, pageOffset) {
  for (let index = 0; index < frame.length; index += 4) {
    const overlayIndex = pageOffset + index;
    const alpha = overlay[overlayIndex + 3] / 255;
    if (alpha <= 0) continue;
    const inverse = 1 - alpha;
    frame[index] = Math.round(frame[index] * inverse + overlay[overlayIndex] * alpha);
    frame[index + 1] = Math.round(frame[index + 1] * inverse + overlay[overlayIndex + 1] * alpha);
    frame[index + 2] = Math.round(frame[index + 2] * inverse + overlay[overlayIndex + 2] * alpha);
    frame[index + 3] = 255;
  }
}

async function encodeAnimatedGif(raw, pageSize, pages, delays, repeat) {
  const encoder = GIFEncoder();
  for (let page = 0; page < pages; page += 1) {
    const frame = Buffer.from(raw.subarray(page * pageSize, (page + 1) * pageSize));
    const palette = quantize(frame, 256, { format: "rgb565" });
    const indexed = applyPalette(frame, palette, "rgb565");
    encoder.writeFrame(indexed, TARGET_WIDTH, TARGET_HEIGHT, {
      palette,
      delay: delays[page] || 80,
      repeat: page === 0 ? repeat : undefined,
      dispose: 2,
    });
  }
  encoder.finish();
  return Buffer.from(encoder.bytes());
}

async function sourceMetadata(inputPath) {
  const metadata = await sharp(inputPath, { animated: true }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("The selected file does not contain a readable image.");
  }
  return {
    ...metadata,
    totalHeight: metadata.height,
    height: metadata.pageHeight || metadata.height,
  };
}

async function framePreview(buffer) {
  const preview = await sharp(buffer, { page: 0, pages: 1 })
    .resize(450, 800, { fit: "fill" })
    .png()
    .toBuffer();
  return `data:image/png;base64,${preview.toString("base64")}`;
}

async function processImage(inputPath, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const metadata = await sourceMetadata(inputPath);
  const dimensions = baseDimensions(metadata.width, metadata.height, options);
  const horizontal = placementFor(dimensions.width, TARGET_WIDTH, options.offsetX);
  const vertical = placementFor(dimensions.height, TARGET_HEIGHT, options.offsetY);

  let image = sharp(inputPath, { animated: true });
  if (options.fit === "stretch") {
    image = image.resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: "fill" });
  } else {
    image = image.resize(dimensions.width, dimensions.height, { fit: "fill" });
  }

  const { data: raw, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pages = info.pages || metadata.pages || 1;
  const sourcePageSize = dimensions.width * dimensions.height * 4;
  const pageSize = TARGET_WIDTH * TARGET_HEIGHT * 4;
  const canvas = Buffer.alloc(pageSize * pages);
  const background = backgroundColor(options.background);
  for (let page = 0; page < pages; page += 1) {
    const sourceFrame = raw.subarray(page * sourcePageSize, (page + 1) * sourcePageSize);
    const frame = frameIntoCanvas(
      sourceFrame,
      dimensions.width,
      dimensions.height,
      horizontal,
      vertical,
      background,
    );
    frame.copy(canvas, page * pageSize);
  }

  const svg = overlaySvg(options.template);
  if (svg) {
    const overlay = await sharp(svg).ensureAlpha().raw().toBuffer();
    for (let page = 0; page < pages; page += 1) {
      const pageFrame = canvas.subarray(page * pageSize, (page + 1) * pageSize);
      blendOverlay(pageFrame, overlay, 0);
    }
  }
  const sourceDelays = metadata.delay || [];
  const delays = Array.from({ length: pages }, (_, index) => sourceDelays[index] || 80);
  const data = await encodeAnimatedGif(canvas, pageSize, pages, delays, metadata.loop ?? 0);
  const digest = crypto.createHash("sha256").update(data).digest("hex");
  const preview = await framePreview(data);

  return {
    buffer: data,
    digest,
    preview,
    options,
    source: {
      width: metadata.width,
      height: metadata.height,
      pages: metadata.pages || 1,
      format: metadata.format,
    },
    output: {
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT,
      pages,
      bytes: data.length,
      durationMs: delays.reduce((total, value) => total + value, 0),
      format: "gif",
    },
  };
}

async function writeProcessedImage(inputPath, outputPath, options) {
  const result = await processImage(inputPath, options);
  await require("node:fs/promises").writeFile(outputPath, result.buffer);
  return {
    ...result,
    buffer: undefined,
    path: path.resolve(outputPath),
  };
}

module.exports = {
  FIT_MODES,
  TEMPLATES,
  TARGET_WIDTH,
  TARGET_HEIGHT,
  normalizeOptions,
  processImage,
  writeProcessedImage,
};
