import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
fs.mkdirSync(path.join(dist, "data"), { recursive: true });
for (const file of ["index.html", "styles.css", "app.js"]) fs.copyFileSync(path.join(root, file), path.join(dist, file));
fs.copyFileSync(path.join(root, "assets", "logo-pista.jpg"), path.join(dist, "assets", "logo-pista.jpg"));
fs.copyFileSync(path.join(root, "data", "dashboard.json"), path.join(dist, "data", "dashboard.json"));
fs.writeFileSync(path.join(dist, ".nojekyll"), "");
console.log("Static dashboard built in dist/");
