import { tokenize } from "./simpleParser.js";

const CONTROL_BLOCK_KEYWORDS = new Set(["if", "while", "function"]);

export function buildExecutionTree(source) {
  const tokens = tokenize(source);
  const root = {
    id: 0,
    type: "ProgramBlock",
    kind: "program",
    start: 0,
    end: source.length,
    depth: 0,
    parentId: null,
    children: [],
    statementCount: 0
  };

  const blockTable = [root];
  const stack = [root];
  const diagnostics = [];
  let nextBlockId = 1;
  let pendingBlockKind = null;

  for (const token of tokens) {
    if (token.type === "keyword" && CONTROL_BLOCK_KEYWORDS.has(token.value)) {
      pendingBlockKind = token.value;
      continue;
    }

    if (token.type === "punctuator" && token.value === "{") {
      const parent = stack[stack.length - 1];
      const block = {
        id: nextBlockId,
        type: "Block",
        kind: pendingBlockKind ?? "block",
        start: token.start,
        end: null,
        depth: stack.length,
        parentId: parent.id,
        children: [],
        statementCount: 0
      };
      nextBlockId += 1;
      parent.children.push(block);
      blockTable.push(block);
      stack.push(block);
      pendingBlockKind = null;
      continue;
    }

    if (token.type === "punctuator" && token.value === "}") {
      if (stack.length === 1) {
        diagnostics.push({ type: "UnmatchedBrace", index: token.start });
        continue;
      }
      const closed = stack.pop();
      closed.end = token.end;
      pendingBlockKind = null;
      continue;
    }

    if (token.type === "punctuator" && token.value === ";") {
      const current = stack[stack.length - 1];
      current.statementCount += 1;
      continue;
    }

    if (token.type !== "keyword") {
      pendingBlockKind = null;
    }
  }

  if (stack.length > 1) {
    for (let i = 1; i < stack.length; i += 1) {
      diagnostics.push({
        type: "UnclosedBlock",
        blockId: stack[i].id,
        start: stack[i].start
      });
    }
  }

  return {
    root,
    blockTable,
    diagnostics,
    metrics: {
      blockCount: blockTable.length - 1,
      loopBlockCount: blockTable.filter((b) => b.kind === "while").length,
      functionBlockCount: blockTable.filter((b) => b.kind === "function").length,
      statementCount: blockTable.reduce((sum, block) => sum + block.statementCount, 0),
      maxDepth: Math.max(...blockTable.map((b) => b.depth))
    }
  };
}
