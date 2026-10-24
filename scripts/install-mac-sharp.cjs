const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"));
const names = [
  "@img/sharp-darwin-arm64",
  "@img/sharp-libvips-darwin-arm64",
  "@img/sharp-darwin-x64",
  "@img/sharp-libvips-darwin-x64",
];

function installedVersion(name) {
  try {
    const manifest = path.join(projectRoot, "node_modules", name, "package.json");
    return JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  } catch {
    return null;
  }
}

const missing = [];
for (const name of names) {
  const entry = lock.packages[`node_modules/${name}`];
  if (!entry) {
    console.error(`${name} is missing from package-lock.json.`);
    process.exit(1);
  }
  if (installedVersion(name) !== entry.version) {
    missing.push(`${name}@${entry.version}`);
  }
}

if (missing.length > 0) {
  execFileSync("npm", ["install", "--no-save", "--force", ...missing], {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

console.log("Sharp binaries are ready for macOS x64 and arm64.");
