const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const MACHO_MAGIC = new Set([
  "feedface",
  "cefaedfe",
  "feedfacf",
  "cffaedfe",
  "cafebabe",
  "bebafeca",
]);

function isMachO(file) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, "r");
    const header = Buffer.alloc(4);
    if (fs.readSync(descriptor, header, 0, 4, 0) !== 4) return false;
    return MACHO_MAGIC.has(header.toString("hex"));
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function codesign(args) {
  execFileSync("codesign", args, { stdio: "inherit" });
}

// Ad-hoc sign every Mach-O file and bundle inside the app so the bundle seal is
// valid. Without this macOS reports the repackaged app as damaged.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  const machoFiles = [];

  for (const relativePath of fs.readdirSync(resourcesPath, { recursive: true })) {
    const file = path.join(resourcesPath, relativePath);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    if (isMachO(file)) machoFiles.push(file);
  }

  for (const file of machoFiles) {
    codesign(["--force", "--sign", "-", "--timestamp=none", file]);
  }

  codesign(["--force", "--deep", "--sign", "-", "--timestamp=none", appPath]);
  codesign(["--verify", "--deep", "--strict", appPath]);

  console.log(`Ad-hoc signed ${path.basename(appPath)}`);
};
