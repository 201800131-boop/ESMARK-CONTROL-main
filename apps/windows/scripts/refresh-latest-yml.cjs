const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const appDir = path.resolve(__dirname, "..");
const releaseDir = path.join(appDir, "release");
const pkg = require(path.join(appDir, "package.json"));
const fileName = `ESMARK-Control-Setup-${pkg.version}.exe`;
const exePath = path.join(releaseDir, fileName);

if (!fs.existsSync(exePath)) {
  throw new Error(`No se encontro el instalador esperado: ${exePath}`);
}

const bytes = fs.readFileSync(exePath);
const sha512 = crypto.createHash("sha512").update(bytes).digest("base64");
const releaseDate = new Date().toISOString();

const yml = [
  `version: ${pkg.version}`,
  "files:",
  `  - url: ${fileName}`,
  `    sha512: ${sha512}`,
  `    size: ${bytes.length}`,
  `path: ${fileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  "",
].join("\n");

fs.writeFileSync(path.join(releaseDir, "latest.yml"), yml);
console.log(`latest.yml actualizado para ${fileName}`);
