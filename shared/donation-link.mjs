function secureDonationUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function configureDonationLink(link, config, openExternal) {
  if (!link) return false;
  const url = config?.enabled ? secureDonationUrl(config.url) : "";
  if (!url) {
    link.hidden = true;
    link.removeAttribute("href");
    return false;
  }

  link.hidden = false;
  link.href = url;
  link.setAttribute("aria-label", config.label || "Support this project");
  const label = link.querySelector("[data-donation-label]");
  if (label) label.textContent = config.label || "Support this project";

  link.addEventListener("click", (event) => {
    event.preventDefault();
    openExternal(url);
  });
  return true;
}
