#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { V16Engine } from "./engine/V16Engine.js";
import { createV16DocumentAPI } from "./v16-api/document.js";

async function main() {
  const options = await parseCli(process.argv.slice(2));

  const source = options.scriptPath
    ? await readFile(options.scriptPath, "utf8")
    : [
        "let x = 1 + 2 * 3;",
        "console.log(x);",
        "x = x + 4;",
        "print(x);"
      ].join("\n");

  const documentApi = createV16DocumentAPI(options.documentHtml ?? null);
  const globals = {
    input: options.input,
    document: {
      html: documentApi.getHTML(),
      getHTML: () => documentApi.getHTML(),
      setHTML: (html) => documentApi.setHTML(html),
      textIncludes: (text) => documentApi.textIncludes(text),
      findByTag: (tag) => documentApi.findByTag(tag)
    },
    v16doc: documentApi
  };

  const engine = new V16Engine();
  const result = await engine.execute(source, {
    globals,
    logger: (...args) => console.log(...args)
  });

  if (options.debug) {
    console.log("--- V16 Pipeline Metrics ---");
    console.log(JSON.stringify(result.stages, null, 2));
    console.log("--- Runtime Env ---");
    console.log(JSON.stringify(result.runtime.env, null, 2));
    console.log("--- Runtime Exports ---");
    console.log(JSON.stringify(result.runtime.exports, null, 2));
  }
}

async function parseCli(argv) {
  const options = {
    scriptPath: null,
    debug: false,
    documentHtml: null,
    input: null
  };

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];

    if (token === "--debug" || token === "-d") {
      options.debug = true;
      i += 1;
      continue;
    }

    if (token === "--html") {
      const filePath = argv[i + 1];
      if (!filePath) throw new Error("--html requires a file path.");
      options.documentHtml = await readFile(resolve(filePath), "utf8");
      i += 2;
      continue;
    }

    if (token === "--input-json") {
      const raw = argv[i + 1];
      if (!raw) throw new Error("--input-json requires JSON string.");
      options.input = JSON.parse(raw);
      i += 2;
      continue;
    }

    if (token === "--input-file") {
      const filePath = argv[i + 1];
      if (!filePath) throw new Error("--input-file requires a file path.");
      const raw = await readFile(resolve(filePath), "utf8");
      options.input = JSON.parse(raw);
      i += 2;
      continue;
    }

    if (!token.startsWith("-") && !options.scriptPath) {
      options.scriptPath = resolve(token);
      i += 1;
      continue;
    }

    throw new Error(`Unknown CLI argument: ${token}`);
  }

  return options;
}

main().catch((error) => {
  console.error("[V16] execution failed:", error);
  process.exitCode = 1;
});
