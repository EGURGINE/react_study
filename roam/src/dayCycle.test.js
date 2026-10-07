import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY_CYCLE_SECONDS,
  HALF_CYCLE_SECONDS,
  getLightingState,
  createLightingClock,
} from "./dayCycle.js";

const colorFields = [
  "sunColor",
  "ambientColor",
  "hemisphereSky",
  "hemisphereGround",
  "skyColor",
  "skyMidColor",
  "skyBottomColor",
];

test("manual time holds any sunset value and auto resumes continuously through night and dawn", () => {
  const clock = createLightingClock();
  assert.deepEqual(clock.read(75), { automatic: true, seconds: 75 });
  clock.set({ automatic: false, time: 150 }, 75);
  assert.equal(getLightingState(clock.read(90).seconds).phase, "sunset");
  assert.deepEqual(clock.read(1000), { automatic: false, seconds: 150 });
  clock.set({ automatic: true, time: 0 }, 1000);
  assert.deepEqual(clock.read(1000), { automatic: true, seconds: 150 });
  assert.equal(clock.read(1150).seconds, 300);
  assert.equal(getLightingState(clock.read(1300).seconds).phase, "dawn");
  assert.equal(clock.read(1450).seconds, 0);
  clock.set({ automatic: false, time: 999 }, 1500);
  assert.equal(clock.read(1600).seconds, 300);
  clock.set({ automatic: false, time: NaN }, 1700);
  assert.equal(clock.read(1800).seconds, 0);
});
const numericFields = [
  "night",
  "sunAltitude",
  "sunIntensity",
  "ambientIntensity",
  "hemiIntensity",
  "exposure",
  "bloomStrength",
];
const channels = (hex) =>
  [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
const close = (actual, expected, tolerance = 1e-12) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`,
  );
const luminance = (hex) =>
  channels(hex)
    .map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    })
    .reduce(
      (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
      0,
    );
const contrast = (foreground, background) => {
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

test("lighting starts in the original daylight, reaches night in five minutes, and repeats in ten", () => {
  assert.equal(HALF_CYCLE_SECONDS, 300);
  assert.equal(DAY_CYCLE_SECONDS, 600);
  const day = getLightingState(0);
  assert.equal(day.phase, "day");
  assert.equal(day.label, "낮");
  assert.equal(day.night, 0);
  assert.equal(day.progress, 0);
  assert.equal(day.skyColor, "#83a6f5");
  assert.equal(day.skyBottomColor, "#155f73");
  assert.equal(day.sunColor, "#fff7dc");
  assert.equal(day.ambientColor, "#fff5e3");
  assert.equal(day.hemisphereSky, "#c8e8ec");
  assert.equal(day.hemisphereGround, "#c8a678");
  assert.equal(day.sunIntensity, 3.2);
  assert.equal(day.ambientIntensity, 1.4);
  assert.equal(day.hemiIntensity, 1.1);
  assert.equal(day.exposure, 1.05);
  const night = getLightingState(300);
  assert.equal(night.phase, "night");
  assert.equal(night.label, "밤");
  assert.equal(night.night, 1);
  assert.equal(night.progress, 0.5);
  assert.equal(night.skyColor, "#292c53");
  assert.equal(night.skyBottomColor, "#102e3b");
  close(night.sunIntensity, 0.6);
  close(night.ambientIntensity, 0.5);
  close(night.hemiIntensity, 0.55);
  assert.deepEqual(getLightingState(600), day);
  for (const seconds of [1, 100, 174.5, 300, 450, 599.5]) {
    const first = getLightingState(seconds),
      repeated = getLightingState(seconds + 6000);
    for (const key of numericFields) close(first[key], repeated[key]);
    assert.deepEqual(first.ui, repeated.ui);
    for (const key of colorFields) assert.equal(first[key], repeated[key]);
  }
});

test("the first half darkens monotonically and the second half returns through dawn", () => {
  let previous = getLightingState(0);
  for (let seconds = 1; seconds <= 300; seconds += 1) {
    const current = getLightingState(seconds);
    assert.ok(current.night >= previous.night);
    assert.ok(current.sunIntensity <= previous.sunIntensity);
    assert.ok(current.ambientIntensity <= previous.ambientIntensity);
    assert.ok(current.hemiIntensity <= previous.hemiIntensity);
    assert.ok(current.bloomStrength >= previous.bloomStrength);
    previous = current;
  }
  const sunset = getLightingState(150),
    dawn = getLightingState(450);
  assert.equal(sunset.phase, "sunset");
  assert.equal(sunset.label, "노을");
  for (const key of ["skyColor", "skyMidColor"]) {
    const [red, green, blue] = channels(sunset[key]);
    assert.ok(
      red > green && green > blue,
      "sunset remains orange/apricot instead of purple",
    );
  }
  assert.equal(dawn.phase, "dawn");
  assert.equal(dawn.label, "새벽");
  close(sunset.night, dawn.night);
  for (const key of colorFields) assert.equal(sunset[key], dawn[key]);
  for (let seconds = 301; seconds < 600; seconds += 1) {
    const current = getLightingState(seconds);
    assert.ok(current.night <= previous.night);
    previous = current;
  }
});

test("phase and palette boundaries keep lighting and UI surfaces continuous", () => {
  const secondsForNight = (night) =>
    (Math.acos(1 - 2 * night) * 600) / (2 * Math.PI);
  const points = [
    0,
    300,
    600,
    ...[0.25, 0.45, 0.72].flatMap((night) => {
      const seconds = secondsForNight(night);
      return [seconds, 600 - seconds];
    }),
  ];
  for (const seconds of points) {
    const before = getLightingState(seconds === 0 ? 599.999 : seconds - 0.001);
    const after = getLightingState(seconds + 0.001);
    for (const key of numericFields) close(before[key], after[key], 0.0001);
    const pairs = [
      ...colorFields.map((key) => [before[key], after[key]]),
      ...["background", "panel", "border"].map((key) => [
        before.ui[key],
        after.ui[key],
      ]),
    ];
    for (const [a, b] of pairs)
      channels(a).forEach((value, index) => {
        assert.ok(
          Math.abs(value - channels(b)[index]) <= 1,
          `${a} jumped to ${b}`,
        );
      });
  }
});

test("UI foregrounds stay readable on panels and the actual sky through the whole cycle", () => {
  for (let seconds = 0; seconds <= DAY_CYCLE_SECONDS; seconds += 0.25) {
    const { ui, skyColor, skyBottomColor } = getLightingState(seconds);
    for (const key of ["ink", "muted", "accent", "danger"]) {
      assert.ok(
        contrast(ui[key], ui.panel) >= 4.5,
        `${seconds}s: ${key} lost panel contrast`,
      );
    }
    for (const key of ["sceneInk", "sceneMuted", "sceneAccent"]) {
      assert.ok(
        contrast(ui[key], skyColor) >= 4.5,
        `${seconds}s: ${key} lost sky contrast`,
      );
    }
    assert.ok(
      contrast(ui.onAccent, ui.accent) >= 4.5,
      `${seconds}s: action label lost contrast`,
    );
    assert.ok(contrast(ui.footerInk, skyBottomColor) >= 4.5);
    assert.ok(contrast(ui.footerMuted, skyBottomColor) >= 4.5);
  }
  for (const seconds of [150, 450]) {
    const { ui, skyColor } = getLightingState(seconds);
    assert.ok(contrast(ui.ink, ui.panel) >= 4.5);
    assert.ok(contrast(ui.sceneInk, skyColor) >= 4.5);
  }
});

test("invalid elapsed input falls back to daylight and valid results stay finite and usable", () => {
  for (const invalid of [
    undefined,
    null,
    NaN,
    Infinity,
    -Infinity,
    -1,
    "300",
    {},
    true,
  ]) {
    assert.deepEqual(getLightingState(invalid), getLightingState(0));
  }
  for (let seconds = 0; seconds <= 1200; seconds += 0.5) {
    const state = getLightingState(seconds);
    assert.ok(state.night >= 0 && state.night <= 1);
    assert.ok(state.progress >= 0 && state.progress < 1);
    assert.ok(state.sunIntensity >= 0.59 && state.sunIntensity <= 3.2);
    assert.ok(state.ambientIntensity >= 0.49 && state.ambientIntensity <= 1.4);
    assert.ok(state.hemiIntensity >= 0.55 && state.hemiIntensity <= 1.1);
    assert.ok(state.exposure >= 1.05 && state.exposure <= 1.1);
    assert.ok(state.bloomStrength >= 0.12 && state.bloomStrength <= 0.95);
    for (const key of numericFields) assert.ok(Number.isFinite(state[key]));
    for (const color of [
      ...colorFields.map((key) => state[key]),
      ...Object.values(state.ui),
    ]) {
      assert.match(color, /^#[0-9a-f]{6}$/);
    }
  }
});

test("night surfaces retain readable primary and secondary UI text", () => {
  const { ui } = getLightingState(300);
  assert.equal(ui.panel, "#222c40");
  assert.equal(ui.ink, "#e8e7d3");
  assert.equal(ui.muted, "#a6b6c0");
  assert.equal(ui.border, "#405468");
  for (const surface of [ui.background, ui.panel]) {
    assert.ok(contrast(ui.ink, surface) >= 7);
    assert.ok(contrast(ui.muted, surface) >= 4.5);
  }
  const altered = getLightingState(300);
  altered.ui.ink = "#000000";
  assert.equal(getLightingState(300).ui.ink, "#e8e7d3");
});
