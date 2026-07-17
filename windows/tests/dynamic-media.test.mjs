import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transferVideoToSession } from "../scripts/injector.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const injectorPath = path.resolve(here, "../scripts/injector.mjs");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dream-skin-video-"));
const themeDirectory = path.join(temporary, "theme");
const videoPath = path.join(themeDirectory, "loop.mp4");

const runInjector = (directory) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    injectorPath,
    "--check-payload",
    "--theme-dir", directory,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject);
  child.once("close", (code) => resolve({ code, stdout, stderr }));
});

try {
  await fs.mkdir(themeDirectory, { recursive: true });
  const videoBytes = Buffer.alloc(900_000, 0x2a);
  videoBytes.writeUInt32BE(24, 0);
  videoBytes.write("ftyp", 4, "ascii");
  videoBytes.write("isom", 8, "ascii");
  await fs.writeFile(videoPath, videoBytes);
  await fs.writeFile(path.join(themeDirectory, "theme.json"), JSON.stringify({
    schemaVersion: 2,
    id: "video-fixture",
    name: "Video Fixture",
    image: "loop.mp4",
    appearance: "dark",
    media: { type: "video", playbackRate: 1.25 },
    art: { focusX: 0.5, focusY: 0.5, safeArea: "center", taskMode: "ambient" },
  }));

  const checked = await runInjector(themeDirectory);
  assert.equal(checked.code, 0, checked.stderr);
  const summary = JSON.parse(checked.stdout);
  assert.equal(summary.media.type, "video");
  assert.equal(summary.media.mime, "video/mp4");
  assert.equal(summary.media.size, videoBytes.length);
  assert.ok(summary.payloadBytes < videoBytes.length,
    "The CDP bootstrap payload must not embed the complete video.");

  const expressions = [];
  const session = {
    async evaluate(expression) {
      expressions.push(expression);
      return true;
    },
  };
  const transferred = await transferVideoToSession(session, {
    mediaPath: videoPath,
    mediaMime: "video/mp4",
    mediaSize: videoBytes.length,
  });
  assert.equal(transferred.bytes, videoBytes.length);
  assert.ok(transferred.chunks >= 2, "The fixture should exercise chunked CDP transfer.");
  assert.match(expressions[0], /\.beginMedia\(/);
  assert.match(expressions.at(-1), /\.commitMedia\(\)/);
  assert.ok(expressions.slice(1, -1).every((expression) => expression.includes(".appendMedia(")));
  assert.ok(expressions.every((expression) => Buffer.byteLength(expression) < 1024 * 1024));

  const invalidDirectory = path.join(temporary, "invalid");
  await fs.mkdir(invalidDirectory);
  await fs.writeFile(path.join(invalidDirectory, "fake.mp4"), Buffer.from("not an mp4"));
  await fs.writeFile(path.join(invalidDirectory, "theme.json"), JSON.stringify({
    id: "invalid-video",
    image: "fake.mp4",
    media: { type: "video" },
  }));
  const rejected = await runInjector(invalidDirectory);
  assert.notEqual(rejected.code, 0);
  assert.match(rejected.stderr, /signature|container/i);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("PASS: video themes stay out of bootstrap payloads and transfer in bounded CDP chunks.");
