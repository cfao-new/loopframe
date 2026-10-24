const fs = require("node:fs");
const path = require("node:path");

const value = process.argv[2] || "";
let url;
try {
  url = new URL(value);
} catch {
  console.error("Enter a complete HTTPS donation page address.");
  process.exit(1);
}

if (url.protocol !== "https:") {
  console.error("The donation page address must use HTTPS.");
  process.exit(1);
}

const service = url.hostname.includes("buymeacoffee")
  ? "Buy Me a Coffee"
  : url.hostname.includes("ko-fi")
    ? "Ko-fi"
    : url.hostname.includes("github")
      ? "GitHub Sponsors"
      : "Donation";

const filePath = path.resolve(__dirname, "..", "donation.json");
const current = JSON.parse(fs.readFileSync(filePath, "utf8"));
fs.writeFileSync(
  filePath,
  JSON.stringify({
    ...current,
    enabled: true,
    service,
    label: "Support this project",
    url: url.toString(),
    placement: "footer",
    promptOnLaunch: false,
  }, null, 2) + "\n",
  "utf8",
);

console.log(`Donation link configured for ${service}.`);
