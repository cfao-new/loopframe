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

module.exports = {
  FIT_MODES,
  TEMPLATES,
};
