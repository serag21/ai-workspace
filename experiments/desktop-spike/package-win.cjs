// Portable, UNSIGNED experimental Windows package. Not an installer or public release.
const packager = require("@electron/packager");
const path = require("node:path");

(async () => {
  const out = path.join(__dirname, "dist");
  const builds = await packager({
    dir: __dirname,
    name: "AI Workspace Preview",
    appVersion: "0.1.0",
    platform: "win32",
    arch: "x64",
    overwrite: true,
    asar: true,
    prune: true,
    out,
    // Keep generated output and test suites out of the packaged executable.
    ignore: [
      /^\/dist(\/|$)/,
      /(^|\/)[^/]+\.test\.mjs$/,
      /(^|\/)regression-(report|status)(\.mjs|\.md)$/,
      /(^|\/)package-win\.cjs$/,
      /(^|\/)build-assets\.cjs$/,
    ],
  });
  if (!builds.length) throw new Error("Electron packager did not produce any builds.");
  console.log("Packaged Windows preview in:\n" + builds.join("\n"));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
