export function buildExecutionTree(source) {
  const root = {
    type: "ProgramBlock",
    start: 0,
    end: source.length,
    depth: 0,
    children: [],
    statements: []
  };

  const stack = [root];
  const diagnostics = [];

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (char === "{") {
      const parent = stack[stack.length - 1];
      const block = {
        type: "Block",
        start: i,
        end: null,
        depth: stack.length,
        children: [],
        statements: []
      };
      parent.children.push(block);
      stack.push(block);
      continue;
    }

    if (char === "}") {
      if (stack.length === 1) {
        diagnostics.push({ type: "UnmatchedBrace", index: i, char });
        continue;
      }
      const closed = stack.pop();
      closed.end = i;
      continue;
    }

    if (char === ";") {
      const current = stack[stack.length - 1];
      current.statements.push({
        type: "StatementEnd",
        index: i,
        depth: stack.length - 1
      });
    }
  }

  if (stack.length > 1) {
    for (let i = 1; i < stack.length; i += 1) {
      diagnostics.push({
        type: "UnclosedBlock",
        start: stack[i].start
      });
    }
  }

  return {
    root,
    diagnostics,
    metrics: {
      blockCount: countBlocks(root),
      statementCount: countStatements(root)
    }
  };
}

function countBlocks(node) {
  let count = node.type === "Block" ? 1 : 0;
  for (const child of node.children) {
    count += countBlocks(child);
  }
  return count;
}

function countStatements(node) {
  let count = node.statements.length;
  for (const child of node.children) {
    count += countStatements(child);
  }
  return count;
}
