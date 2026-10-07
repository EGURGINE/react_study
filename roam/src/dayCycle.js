export const HALF_CYCLE_SECONDS = 300;
export const DAY_CYCLE_SECONDS = HALF_CYCLE_SECONDS * 2;

/** A per-visitor clock: manual scrubbing holds still; auto resumes there. */
export function createLightingClock() {
  let automatic = true,
    manualTime = 0,
    anchorTime = 0,
    anchorElapsed = 0;
  const safe = (value) => (Number.isFinite(value) ? Math.max(0, value) : 0);
  return {
    set({ automatic: auto, time } = {}, elapsed = 0) {
      if (typeof auto !== "boolean") return;
      if (!auto) {
        manualTime = Math.min(HALF_CYCLE_SECONDS, safe(time));
      } else if (!automatic) {
        anchorTime = manualTime;
        anchorElapsed = safe(elapsed);
      }
      automatic = auto;
    },
    read(elapsed = 0) {
      return {
        automatic,
        seconds: automatic
          ? (anchorTime + Math.max(0, safe(elapsed) - anchorElapsed)) %
            DAY_CYCLE_SECONDS
          : manualTime,
      };
    },
  };
}

const COLOR_KEYS = [
  "sunColor",
  "ambientColor",
  "hemisphereSky",
  "hemisphereGround",
  "skyColor",
  "skyMidColor",
  "skyBottomColor",
];

// Palette positions follow the continuous night factor, not the phase label.
// The warm, muted middle frame appears at sunset and again during dawn.
const PALETTE = [
  {
    at: 0,
    sunColor: "#fff7dc",
    ambientColor: "#fff5e3",
    hemisphereSky: "#c8e8ec",
    hemisphereGround: "#c8a678",
    skyColor: "#83a6f5",
    skyMidColor: "#2698a5",
    skyBottomColor: "#155f73",
  },
  {
    at: 0.45,
    sunColor: "#ffd2a0",
    ambientColor: "#f1c9a6",
    hemisphereSky: "#eab992",
    hemisphereGround: "#b68153",
    skyColor: "#f3b374",
    skyMidColor: "#de895a",
    skyBottomColor: "#965b47",
  },
  {
    at: 0.72,
    sunColor: "#bac3e2",
    ambientColor: "#a1a3c1",
    hemisphereSky: "#6e7caa",
    hemisphereGround: "#786a82",
    skyColor: "#bc816d",
    skyMidColor: "#735569",
    skyBottomColor: "#343e58",
  },
  {
    at: 1,
    sunColor: "#a9c4f0",
    ambientColor: "#8296c1",
    hemisphereSky: "#526f9f",
    hemisphereGround: "#5a4c62",
    skyColor: "#292c53",
    skyMidColor: "#203e5e",
    skyBottomColor: "#102e3b",
  },
];

const DAY_UI = {
  background: "#efeee8",
  panel: "#f8f6ee",
  ink: "#354839",
  muted: "#7c8274",
  border: "#d8d9cf",
};
const NIGHT_UI = {
  background: "#141a35",
  panel: "#222c40",
  ink: "#e8e7d3",
  muted: "#a6b6c0",
  border: "#405468",
};

const mix = (a, b, amount) => a + (b - a) * amount;
const smooth = (value) => value * value * (3 - 2 * value);
const toLinear = (value) => {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (value) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

function blendColor(from, to, amount) {
  let result = "#";
  for (let offset = 1; offset < 7; offset += 2) {
    const a = toLinear(Number.parseInt(from.slice(offset, offset + 2), 16));
    const b = toLinear(Number.parseInt(to.slice(offset, offset + 2), 16));
    const channel = Math.round(255 * toSrgb(mix(a, b, amount)));
    result += channel.toString(16).padStart(2, "0");
  }
  return result;
}

function luminance(color) {
  return [1, 3, 5].reduce(
    (sum, offset, index) =>
      sum +
      toLinear(Number.parseInt(color.slice(offset, offset + 2), 16)) *
        [0.2126, 0.7152, 0.0722][index],
    0,
  );
}

function contrast(foreground, background) {
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Interpolating opposite foreground colors crosses the surface's luminance.
// Select a readable polarity instead, then preserve its tint where possible.
function readablePalette(surface) {
  const dark = contrast("#000000", surface) >= contrast("#ffffff", surface);
  const endpoint = dark ? "#000000" : "#ffffff";
  const palette = dark ? DAY_UI : NIGHT_UI;
  function readable(preferred) {
    if (contrast(preferred, surface) >= 4.5) return preferred;
    let low = 0,
      high = 1;
    for (let step = 0; step < 16; step++) {
      const middle = (low + high) / 2;
      if (contrast(blendColor(preferred, endpoint, middle), surface) >= 4.5)
        high = middle;
      else low = middle;
    }
    return blendColor(preferred, endpoint, high);
  }
  const accent = readable(dark ? "#3d6043" : "#b7d99a");
  const onAccent =
    contrast("#ffffff", accent) >= contrast("#000000", accent)
      ? "#ffffff"
      : "#000000";
  return {
    ink: readable(palette.ink),
    muted: readable(palette.muted),
    accent,
    onAccent,
    danger: readable(dark ? "#a6644e" : "#eab5a1"),
  };
}

/**
 * Lighting for seconds elapsed since this scene opened. One 600-second cycle
 * reaches full night at 300 seconds and returns to daylight at 600 seconds.
 * Colors are sRGB hex strings interpolated in linear light. sunAltitude is in
 * radians: +PI/3 at noon, -PI/3 at midnight; moon placement can use its magnitude.
 */
export function getLightingState(elapsedSeconds) {
  const elapsed =
    typeof elapsedSeconds === "number" && Number.isFinite(elapsedSeconds)
      ? Math.max(0, elapsedSeconds)
      : 0;
  const progress = (elapsed % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS;
  const night = (1 - Math.cos(progress * Math.PI * 2)) / 2;
  const blend = smooth(night);
  const darkening = progress < 0.5;
  const phase =
    night > 0.72
      ? "night"
      : night > 0.25
        ? darkening
          ? "sunset"
          : "dawn"
        : "day";
  const label = { day: "낮", sunset: "노을", night: "밤", dawn: "새벽" }[phase];

  const index = Math.min(
    PALETTE.findIndex(
      (frame, frameIndex) => frameIndex > 0 && night <= frame.at,
    ),
    PALETTE.length - 1,
  );
  const from = PALETTE[index - 1];
  const to = PALETTE[index];
  const paletteBlend = smooth((night - from.at) / (to.at - from.at));
  const colors = Object.fromEntries(
    COLOR_KEYS.map((key) => [
      key,
      blendColor(from[key], to[key], paletteBlend),
    ]),
  );
  const ui = Object.fromEntries(
    ["background", "panel", "border"].map((key) => [
      key,
      blendColor(DAY_UI[key], NIGHT_UI[key], blend),
    ]),
  );
  Object.assign(ui, readablePalette(ui.panel));
  const sceneUI = readablePalette(colors.skyColor);
  ui.sceneInk = sceneUI.ink;
  ui.sceneMuted = sceneUI.muted;
  ui.sceneAccent = sceneUI.accent;
  const footerUI = readablePalette(colors.skyBottomColor);
  ui.footerInk = footerUI.ink;
  ui.footerMuted = footerUI.muted;

  return {
    phase,
    label,
    night,
    progress,
    sunAltitude: ((1 - 2 * night) * Math.PI) / 3,
    ...colors,
    sunIntensity: mix(3.2, 0.6, blend),
    ambientIntensity: mix(1.4, 0.5, blend),
    hemiIntensity: mix(1.1, 0.55, blend),
    exposure: mix(1.05, 1.1, blend),
    bloomStrength: mix(0.12, 0.95, blend),
    ui,
  };
}
