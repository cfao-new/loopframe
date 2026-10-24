const catalog = require("./device-screen-catalog.json");

function identityFor(device) {
  return [
    device?.model,
    device?.model_name,
    device?.marketName,
    device?.device_type,
    device?.type,
    device?.name,
  ].filter(Boolean).join(" ");
}

function findScreenDevice(device) {
  const identity = identityFor(device).toLowerCase();
  const matches = catalog.screenDevices
    .map((entry) => ({
      entry,
      length: Math.max(
        0,
        ...entry.modelAliases
          .filter((alias) => identity.includes(alias.toLowerCase()))
          .map((alias) => alias.length),
      ),
    }))
    .filter((match) => match.length > 0)
    .sort((left, right) => right.length - left.length);
  return matches[0]?.entry || null;
}

function screenForDevice(device, detectedScreen = null) {
  const entry = findScreenDevice(device);
  if (!entry && !detectedScreen) return null;
  const fallback = entry?.screen || {};
  const detected = detectedScreen
    ? {
        ...detectedScreen,
        nativeWidth: detectedScreen.nativeWidth || detectedScreen.width,
        nativeHeight: detectedScreen.nativeHeight || detectedScreen.height,
      }
    : null;
  const screen = { ...fallback, ...(detected || {}) };
  const orientation = String(
    detected?.orientation || fallback.orientation || "landscape",
  ).toLowerCase();
  const nativeWidth = Number(screen.nativeWidth || screen.width);
  const nativeHeight = Number(screen.nativeHeight || screen.height);
  let width = Number(screen.width || nativeWidth);
  let height = Number(screen.height || nativeHeight);
  if (orientation === "portrait" && width > height) {
    [width, height] = [height, width];
  }
  return {
    ...screen,
    width,
    height,
    nativeWidth,
    nativeHeight,
    orientation,
    source: detected ? "device" : fallback.source,
    confidence: detected ? "detected" : fallback.confidence,
    ...(entry
      ? {
          catalogId: entry.id,
          sourceUrl: entry.sourceUrl,
        }
      : {}),
  };
}

module.exports = {
  catalog,
  findScreenDevice,
  screenForDevice,
};
