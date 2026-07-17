import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const windowsRoot = path.resolve(here, "..");
const template = await fs.readFile(path.join(windowsRoot, "assets", "renderer-inject.js"), "utf8");
const css = await fs.readFile(path.join(windowsRoot, "assets", "dream-skin.css"), "utf8");
const buildPayload = (config = {}, artDataUrl = "data:image/png;base64,AA==") => template
  .replace("__DREAM_CSS_JSON__", JSON.stringify(".fixture { color: blue; }"))
  .replace("__DREAM_ART_JSON__", JSON.stringify(artDataUrl))
  .replace("__DREAM_THEME_JSON__", JSON.stringify(config));
const payload = buildPayload();

assert.doesNotMatch(
  css,
  /main\.main-surface\s*>\s*header\.app-header-tint\s*\{[^}]*\b(?:position|z-index)\s*:/,
  "The skin must preserve Codex's native fixed header so the side-panel toggle remains reachable.",
);
assert.doesNotMatch(
  css,
  /\.dream-task\s*>\s*\*\s*\{[^}]*\bposition\s*:/,
  "Task styling must not turn the native fixed header into a positioned route child.",
);
assert.match(
  css,
  /main\.main-surface\.dream-task\s*>\s*header\.app-header-tint\s*\{[^}]*background:\s*transparent !important;/,
  "Fallback task routes must not paint a separate header band.",
);
assert.match(
  css,
  /main\.main-surface\.dream-task\s+\.app-shell-main-content-top-fade\s*\{[^}]*display:\s*none !important;/,
  "Fallback task routes must remove the native top fade seam.",
);

function createFixture({
  shellPresent,
  routeMainPresent = true,
  sidebarPresent = true,
  staleSkin = false,
  homePresent = false,
  utilityPresent = false,
  shellAppearance = "dark",
  computedColorScheme = "",
  osAppearance = "light",
  analysisFixture = null,
}) {
  const nodes = new Map();
  const rootClasses = new Set(staleSkin ? ["codex-dream-skin"] : []);
  const rootStyles = new Map(staleSkin ? [["--dream-art", "url(\"blob:stale\")"]] : []);
  const revokedUrls = [];
  const observers = [];
  const documentListeners = new Map();
  let objectUrlCount = 0;
  let hasShell = shellPresent;
  let documentHidden = false;
  let root;

  const queueRootClassMutation = () => {
    for (const observer of observers) {
      if (observer.target !== root || !observer.options?.attributes) continue;
      if (observer.options.attributeFilter && !observer.options.attributeFilter.includes("class")) continue;
      observer.records.push({ type: "attributes", attributeName: "class", target: root });
    }
  };
  const makeClassList = (classes = new Set(), onMutation = () => {}) => ({
    add(...values) {
      let changed = false;
      for (const value of values) {
        if (!classes.has(value)) { classes.add(value); changed = true; }
      }
      if (changed) onMutation();
    },
    remove(...values) {
      let changed = false;
      for (const value of values) changed = classes.delete(value) || changed;
      if (changed) onMutation();
    },
    toggle(value, enabled) {
      const changed = enabled ? !classes.has(value) : classes.has(value);
      if (enabled) classes.add(value);
      else classes.delete(value);
      if (changed) onMutation();
    },
    contains(value) { return classes.has(value); },
  });

  root = {
    className: shellAppearance,
    classList: makeClassList(rootClasses, queueRootClassMutation),
    getAttribute() { return null; },
    style: {
      setProperty(key, value) { rootStyles.set(key, value); },
      removeProperty(key) { rootStyles.delete(key); },
    },
    appendChild(node) {
      node.parentElement = root;
      nodes.set(node.id, node);
    },
  };
  const body = {
    className: "",
    getAttribute() { return null; },
    appendChild(node) {
      node.parentElement = body;
      nodes.set(node.id, node);
    },
  };
  const shellMainClasses = new Set();
  const shellMain = {
    classList: makeClassList(shellMainClasses),
    getBoundingClientRect() {
      return { left: 290, top: 36, width: 990, height: 784 };
    },
  };
  const routeClasses = new Set();
  const utilityClasses = new Set();
  const utilityNode = { classList: makeClassList(utilityClasses) };
  const routeMain = {
    classList: makeClassList(routeClasses),
    querySelectorAll(selector) {
      if (selector === '[class*="_homeUtilityBar_"]' && utilityPresent) return [utilityNode];
      return [];
    },
  };
  const staleHome = { classList: makeClassList(new Set(["dream-home"])) };
  const staleShell = { classList: makeClassList(new Set(["dream-home-shell"])) };

  const createElement = (tagName) => {
    if (tagName === "canvas" && analysisFixture) {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage() {},
            getImageData() { return { data: analysisFixture.pixels }; },
          };
        },
      };
    }
    return {
      id: "",
      dataset: {},
      style: {},
      classList: makeClassList(),
      parentElement: null,
      src: "",
      paused: true,
      textContent: "",
      innerHTML: "",
      setAttribute() {},
      removeAttribute(name) { if (name === "src") this.src = ""; },
      load() {},
      pause() { this.paused = true; },
      play() { this.paused = false; return Promise.resolve(); },
      remove() { nodes.delete(this.id); },
    };
  };
  if (staleSkin) {
    const style = createElement();
    style.id = "codex-dream-skin-style";
    nodes.set(style.id, style);
    const chrome = createElement();
    chrome.id = "codex-dream-skin-chrome";
    nodes.set(chrome.id, chrome);
  }

  const document = {
    documentElement: root,
    head: root,
    body,
    get hidden() { return documentHidden; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (documentListeners.get(type) === listener) documentListeners.delete(type);
    },
    createElement,
    getElementById(id) { return nodes.get(id) ?? null; },
    querySelector(selector) {
      if (selector === "main.main-surface") return hasShell ? shellMain : null;
      if (selector === "aside.app-shell-left-panel") return hasShell && sidebarPresent ? {} : null;
      if (selector === '[role="main"]:has([data-testid="home-icon"])') {
        return hasShell && homePresent ? routeMain : null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[role="main"]') return hasShell && routeMainPresent ? [routeMain] : [];
      if (selector === ".dream-task") {
        const candidates = [];
        if (routeClasses.has("dream-task")) candidates.push(routeMain);
        if (shellMainClasses.has("dream-task")) candidates.push(shellMain);
        return candidates;
      }
      if (selector === ".dream-home-utility") {
        return utilityClasses.has("dream-home-utility") ? [utilityNode] : [];
      }
      if (!staleSkin) return [];
      if (selector === ".dream-home") return [staleHome];
      if (selector === ".dream-home-shell") return [staleShell];
      return [];
    },
  };
  const context = {
    window: {
      matchMedia() { return { matches: osAppearance === "dark" }; },
    },
    document,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.records = [];
        this.target = null;
        this.options = null;
        observers.push(this);
      }
      observe(target, options = {}) {
        this.target = target;
        this.options = options;
      }
      disconnect() {
        this.target = null;
        this.records = [];
      }
      takeRecords() {
        const records = this.records;
        this.records = [];
        return records;
      }
    },
    URL: {
      createObjectURL() { objectUrlCount += 1; return `blob:fixture-${objectUrlCount}`; },
      revokeObjectURL(value) { revokedUrls.push(value); },
    },
    Blob,
    Uint8Array,
    atob,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 2,
    clearTimeout: () => {},
    getComputedStyle() { return { colorScheme: computedColorScheme }; },
  };
  if (analysisFixture) {
    context.Image = class {
      naturalWidth = analysisFixture.naturalWidth;
      naturalHeight = analysisFixture.naturalHeight;
      set src(_) { this.onload(); }
    };
  }

  return {
    context,
    nodes,
    observers,
    rootClasses,
    rootStyles,
    revokedUrls,
    routeClasses,
    shellMainClasses,
    utilityClasses,
    setShellPresent(value) { hasShell = value; },
    setDocumentHidden(value) {
      documentHidden = value;
      documentListeners.get("visibilitychange")?.();
    },
  };
}

const main = createFixture({ shellPresent: true });
const mainResult = vm.runInNewContext(payload, main.context);
assert.equal(mainResult.installed, true);
assert.equal(main.rootClasses.has("codex-dream-skin"), true);
assert.equal(main.rootStyles.get("--dream-art"), 'url("blob:fixture-1")');
assert.equal(main.nodes.has("codex-dream-skin-style"), true);
assert.equal(main.nodes.has("codex-dream-skin-chrome"), true);
assert.equal(main.rootClasses.has("dream-theme-dark"), true);
assert.equal(main.rootClasses.has("dream-art-standard"), true);
assert.equal(main.rootClasses.has("dream-task-ambient"), true);
assert.equal(main.routeClasses.has("dream-task"), true);
assert.equal(main.context.window.__CODEX_DREAM_SKIN_STATE__.cleanup(), true);
assert.equal(main.rootClasses.has("codex-dream-skin"), false);
assert.equal(main.rootClasses.has("dream-theme-dark"), false);
assert.equal(main.nodes.has("codex-dream-skin-style"), false);
assert.equal(main.nodes.has("codex-dream-skin-chrome"), false);
assert.deepEqual(main.revokedUrls, ["blob:fixture-1"]);

const currentShell = createFixture({
  shellPresent: true,
  routeMainPresent: false,
  sidebarPresent: false,
});
const currentShellResult = vm.runInNewContext(payload, currentShell.context);
assert.equal(currentShellResult.installed, true);
assert.equal(currentShell.rootClasses.has("codex-dream-skin"), true);
assert.equal(currentShell.shellMainClasses.has("dream-task"), true);
assert.equal(currentShell.context.window.__CODEX_DREAM_SKIN_STATE__.cleanup(), true);
assert.equal(currentShell.shellMainClasses.has("dream-task"), false);

const reinjected = createFixture({ shellPresent: true });
vm.runInNewContext(payload, reinjected.context);
const firstState = reinjected.context.window.__CODEX_DREAM_SKIN_STATE__;
vm.runInNewContext(payload, reinjected.context);
const secondState = reinjected.context.window.__CODEX_DREAM_SKIN_STATE__;
assert.notEqual(secondState.installToken, firstState.installToken);
assert.equal(secondState.artUrl, "blob:fixture-2");
assert.equal(reinjected.rootStyles.get("--dream-art"), 'url("blob:fixture-2")');
assert.deepEqual(reinjected.revokedUrls, ["blob:fixture-1"]);
assert.equal(firstState.cleanup(), false);
assert.equal(secondState.cleanup(), true);

const auxiliary = createFixture({ shellPresent: false, staleSkin: true });
const auxiliaryResult = vm.runInNewContext(payload, auxiliary.context);
assert.equal(auxiliaryResult.installed, true);
assert.equal(auxiliary.rootClasses.has("codex-dream-skin"), false);
assert.equal(auxiliary.rootStyles.has("--dream-art"), false);
assert.equal(auxiliary.nodes.has("codex-dream-skin-style"), false);
assert.equal(auxiliary.nodes.has("codex-dream-skin-chrome"), false);

auxiliary.setShellPresent(true);
auxiliary.context.window.__CODEX_DREAM_SKIN_STATE__.ensure();
assert.equal(auxiliary.rootClasses.has("codex-dream-skin"), true);
assert.equal(auxiliary.nodes.has("codex-dream-skin-style"), true);
assert.equal(auxiliary.nodes.has("codex-dream-skin-chrome"), true);

const configured = createFixture({
  shellPresent: true,
  homePresent: true,
  utilityPresent: true,
});
const configuredPayload = buildPayload({
  appearance: "light",
  palette: { accent: "#d45a70" },
  art: { focusX: .15, focusY: .8, safeArea: "right", taskMode: "off" },
});
const configuredResult = vm.runInNewContext(configuredPayload, configured.context);
assert.equal(configuredResult.adaptive, true);
assert.equal(configured.rootClasses.has("dream-theme-light"), true);
assert.equal(configured.rootClasses.has("dream-theme-dark"), false);
assert.equal(configured.rootClasses.has("dream-focus-left"), true);
assert.equal(configured.rootClasses.has("dream-safe-right"), true);
assert.equal(configured.rootClasses.has("dream-task-off"), true);
assert.equal(configured.rootStyles.get("--dream-art-position"), "15% 80%");
assert.equal(configured.rootStyles.get("--dream-accent"), "#d45a70");
assert.equal(configured.routeClasses.has("dream-home"), true);
assert.equal(configured.routeClasses.has("dream-task"), false);
assert.equal(configured.utilityClasses.has("dream-home-utility"), true);
assert.equal(configured.context.window.__CODEX_DREAM_SKIN_STATE__.cleanup(), true);
assert.equal(configured.utilityClasses.has("dream-home-utility"), false);

const analysisPixels = new Uint8ClampedArray(48 * 12 * 4);
for (let index = 0; index < 48 * 12; index += 1) {
  const offset = index * 4;
  const x = index % 48;
  const subject = x >= 34 && x <= 42;
  analysisPixels[offset] = subject ? 210 : 246;
  analysisPixels[offset + 1] = subject ? 84 : 239;
  analysisPixels[offset + 2] = subject ? 112 : 237;
  analysisPixels[offset + 3] = 255;
}
const analyzed = createFixture({
  shellPresent: true,
  analysisFixture: { naturalWidth: 1200, naturalHeight: 400, pixels: analysisPixels },
});
vm.runInNewContext(payload, analyzed.context);
await Promise.resolve();
assert.equal(analyzed.rootClasses.has("dream-theme-dark"), true);
assert.equal(analyzed.rootClasses.has("dream-theme-light"), false);
assert.equal(analyzed.rootClasses.has("dream-art-wide"), true);
assert.equal(analyzed.rootClasses.has("dream-task-banner"), true);
assert.equal(analyzed.rootClasses.has("dream-safe-left"), true);
assert.notEqual(analyzed.rootStyles.get("--dream-accent"), "rgb(216 104 119)");

const standardArt = createFixture({
  shellPresent: true,
  analysisFixture: { naturalWidth: 800, naturalHeight: 800, pixels: analysisPixels },
});
vm.runInNewContext(payload, standardArt.context);
await Promise.resolve();
assert.equal(standardArt.rootClasses.has("dream-art-standard"), true);
assert.equal(standardArt.rootClasses.has("dream-task-ambient"), true);
assert.equal(standardArt.rootClasses.has("dream-task-banner"), false);

const mediumWide = createFixture({
  shellPresent: true,
  analysisFixture: { naturalWidth: 2100, naturalHeight: 1000, pixels: analysisPixels },
});
vm.runInNewContext(payload, mediumWide.context);
await Promise.resolve();
assert.equal(mediumWide.rootClasses.has("dream-art-wide"), true);
assert.equal(mediumWide.rootClasses.has("dream-task-ambient"), true);
assert.equal(mediumWide.rootClasses.has("dream-task-banner"), false);

const nativeLight = createFixture({ shellPresent: true, shellAppearance: "light" });
vm.runInNewContext(payload, nativeLight.context);
assert.equal(nativeLight.rootClasses.has("dream-theme-light"), true);
assert.equal(nativeLight.rootClasses.has("dream-theme-dark"), false);

const nativeComputedDark = createFixture({
  shellPresent: true,
  shellAppearance: "",
  computedColorScheme: "dark",
  osAppearance: "light",
});
vm.runInNewContext(payload, nativeComputedDark.context);
assert.equal(nativeComputedDark.rootClasses.has("dream-theme-dark"), true);
assert.equal(nativeComputedDark.rootClasses.has("dream-theme-light"), false);
nativeComputedDark.context.window.__CODEX_DREAM_SKIN_STATE__.ensure();
assert.equal(nativeComputedDark.rootClasses.has("dream-theme-dark"), true);
const nativeObserver = nativeComputedDark.observers[0];
nativeObserver.takeRecords();
nativeComputedDark.context.window.__CODEX_DREAM_SKIN_STATE__.ensure();
assert.equal(nativeObserver.takeRecords().length, 0,
  "Sampling the native computed color-scheme must not queue a self-triggering root mutation pass.");

const metadataWide = createFixture({ shellPresent: true });
vm.runInNewContext(buildPayload({ artMetadata: { ratio: 16 / 9 } }), metadataWide.context);
assert.equal(metadataWide.rootClasses.has("dream-art-wide"), true);
assert.equal(metadataWide.rootClasses.has("dream-art-standard"), false);

const videoTheme = createFixture({ shellPresent: true });
vm.runInNewContext(buildPayload({
  media: { type: "video", mime: "video/mp4", size: 4, playbackRate: 1 },
  artMetadata: { ratio: 16 / 9 },
}, ""), videoTheme.context);
assert.equal(videoTheme.rootClasses.has("dream-art-video"), true);
const videoState = videoTheme.context.window.__CODEX_DREAM_SKIN_STATE__;
assert.equal(videoState.beginMedia({ mime: "video/mp4", size: 4 }), true);
assert.equal(videoState.appendMedia("AAECAw=="), true);
assert.equal(videoState.commitMedia(), true);
assert.equal(videoTheme.nodes.has("codex-dream-skin-media"), true);
assert.equal(videoTheme.nodes.get("codex-dream-skin-media").muted, true);
assert.equal(videoTheme.nodes.get("codex-dream-skin-media").loop, true);
assert.equal(videoTheme.nodes.get("codex-dream-skin-media").paused, false);
videoTheme.setDocumentHidden(true);
assert.equal(videoTheme.nodes.get("codex-dream-skin-media").paused, true);
videoTheme.setDocumentHidden(false);
assert.equal(videoTheme.nodes.get("codex-dream-skin-media").paused, false);
assert.equal(videoTheme.rootStyles.get("--dream-art"), "none");
assert.equal(videoState.cleanup(), true);
assert.equal(videoTheme.nodes.has("codex-dream-skin-media"), false);
assert.deepEqual(videoTheme.revokedUrls, ["blob:fixture-1"]);

console.log("PASS: renderer applies adaptive theme metadata and preserves transparent auxiliary windows.");
