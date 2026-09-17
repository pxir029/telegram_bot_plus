import { execSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";

if (!existsSync("public")) mkdirSync("public", { recursive: true });

execSync("npx tailwindcss -i ./styles/input.css -o ./public/app.css --minify", {
  stdio: "inherit",
});

console.log("PX Bot build complete.");
