#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { V16Engine } from "./engine/V16Engine.js";

async function main() {
  const file = process.argv[2];
  const source = file
    ? await readFile(file, "utf8")
    : [
        "let x = 1 + 2 * 3;",
        "console.log(x);",
        "x = x + 4;",
        "print(x);"
      ].join("\n");

  const engine = new V16Engine();
  const result = await engine.execute(source);
  if (process.argv.includes("--debug") || process.argv.includes("-d")) {
    console.log("--- V16 Pipeline Metrics ---");
    console.log(JSON.stringify(result.stages, null, 2));
    console.log("--- Runtime Env ---");
    console.log(JSON.stringify(result.runtime.env, null, 2));
  }
  
}

main().catch((error) => {
  console.error("[V16] execution failed:", error);
  process.exitCode = 1;
});
