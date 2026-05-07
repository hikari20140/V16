import { Buffer } from "node:buffer";

export function compileToBinary(ast, treeInfo = null) {
  const optimization = optimizeAst(ast, treeInfo);
  const instructions = [];
  const compileState = {
    inFunction: false,
    blockResolver: createBlockResolver(treeInfo)
  };

  compileProgram(optimization.ast, instructions, compileState);

  const binary = encodeInstructionStream(instructions);

  return {
    instructions,
    binary,
    meta: {
      stage: "jit",
      instructionCount: instructions.length,
      byteLength: binary.byteLength,
      treeMetrics: treeInfo?.metrics ?? null,
      optimizations: optimization.stats
    }
  };
}

function compileProgram(program, out, state) {
  for (const statement of program.body) {
    compileStatement(statement, out, state);
  }
}

function compileStatement(node, out, state) {
  if (!node) return;

  switch (node.type) {
    case "ImportDeclaration":
      compileImportDeclaration(node, out);
      return;
    case "ExportNamedDeclaration":
      compileExportNamedDeclaration(node, out, state);
      return;
    case "ExportDefaultDeclaration":
      compileExpression(node.declaration, out, { emitResult: true });
      out.push({ op: "EXPORT_VALUE", exported: "default" });
      return;
    case "FunctionDeclaration":
      compileFunctionDeclaration(node, out, state);
      return;
    case "VariableDeclaration":
      compileVariableDeclaration(node, out);
      return;
    case "BlockStatement":
      compileBlockStatement(node, out, state);
      return;
    case "IfStatement":
      compileIfStatement(node, out, state);
      return;
    case "WhileStatement":
      compileWhileStatement(node, out, state);
      return;
    case "ReturnStatement":
      if (!state.inFunction) {
        throw new Error("`return` is only allowed inside a function in V16.");
      }
      if (node.argument) {
        compileExpression(node.argument, out, { emitResult: true });
      } else {
        out.push({ op: "PUSH_CONST", value: undefined });
      }
      out.push({ op: "RET" });
      return;
    case "ExpressionStatement":
      compileExpression(node.expression, out, { emitResult: false });
      return;
    default:
      throw new Error(`Unsupported statement: ${node.type}`);
  }
}

function compileImportDeclaration(node, out) {
  const specifiers = node.specifiers.map((specifier) => {
    if (specifier.type === "ImportSpecifier") {
      return {
        type: "named",
        imported: specifier.imported.name,
        local: specifier.local.name
      };
    }
    if (specifier.type === "ImportDefaultSpecifier") {
      return {
        type: "default",
        imported: "default",
        local: specifier.local.name
      };
    }
    if (specifier.type === "ImportNamespaceSpecifier") {
      return {
        type: "namespace",
        imported: "*",
        local: specifier.local.name
      };
    }
    throw new Error(`Unsupported import specifier: ${specifier.type}`);
  });

  out.push({
    op: "IMPORT",
    source: node.source.value,
    specifiers
  });
}

function compileExportNamedDeclaration(node, out, state) {
  if (node.declaration) {
    compileStatement(node.declaration, out, state);
    for (const name of extractDeclarationNames(node.declaration)) {
      out.push({ op: "EXPORT", local: name, exported: name });
    }
    return;
  }

  for (const specifier of node.specifiers) {
    out.push({
      op: "EXPORT",
      local: specifier.local.name,
      exported: specifier.exported.name
    });
  }
}

function compileFunctionDeclaration(node, out, state) {
  const bodyInstructions = [];
  const functionState = {
    ...state,
    inFunction: true
  };

  for (const statement of node.body.body) {
    compileStatement(statement, bodyInstructions, functionState);
  }

  bodyInstructions.push({ op: "PUSH_CONST", value: undefined });
  bodyInstructions.push({ op: "RET" });

  out.push({
    op: "REGISTER_FUNC",
    name: node.id.name,
    params: node.params.map((param) => param.name),
    body: bodyInstructions
  });
}

function compileVariableDeclaration(node, out) {
  for (const declarator of node.declarations) {
    out.push({
      op: "DECLARE",
      kind: node.kind,
      name: declarator.id.name
    });
    if (declarator.init) {
      compileExpression(declarator.init, out, { emitResult: true });
      out.push({ op: "STORE", name: declarator.id.name });
    }
  }
}

function compileBlockStatement(node, out, state) {
  const blockInfo = state.blockResolver.resolve(node.start, node.end);
  if (blockInfo) {
    out.push({
      op: "BLOCK_HINT",
      blockId: blockInfo.id,
      kind: blockInfo.kind,
      depth: blockInfo.depth,
      statementCount: blockInfo.statementCount
    });
  }

  out.push({ op: "ENTER_SCOPE", kind: "block" });
  for (const statement of node.body) {
    compileStatement(statement, out, state);
  }
  out.push({ op: "EXIT_SCOPE" });
}

function compileIfStatement(node, out, state) {
  compileExpression(node.test, out, { emitResult: true });
  const falseJumpIndex = emitJump(out, "JMP_IF_FALSE");

  compileStatement(node.consequent, out, state);

  if (node.alternate) {
    const endJumpIndex = emitJump(out, "JMP");
    patchJump(out, falseJumpIndex, out.length);
    compileStatement(node.alternate, out, state);
    patchJump(out, endJumpIndex, out.length);
    return;
  }

  patchJump(out, falseJumpIndex, out.length);
}

function compileWhileStatement(node, out, state) {
  const blockInfo = state.blockResolver.resolve(node.start, node.end);
  if (blockInfo) {
    out.push({
      op: "BLOCK_HINT",
      blockId: blockInfo.id,
      kind: blockInfo.kind,
      depth: blockInfo.depth,
      statementCount: blockInfo.statementCount
    });
  }

  const loopStart = out.length;
  compileExpression(node.test, out, { emitResult: true });
  const exitJumpIndex = emitJump(out, "JMP_IF_FALSE");

  compileStatement(node.body, out, state);
  out.push({ op: "JMP", target: loopStart });

  patchJump(out, exitJumpIndex, out.length);
}

function emitJump(out, op) {
  out.push({ op, target: -1 });
  return out.length - 1;
}

function patchJump(out, index, target) {
  out[index].target = target;
}

function compileExpression(node, out, options = { emitResult: true }) {
  const emitResult = options.emitResult !== false;

  if (!emitResult && isPureExpression(node)) {
    return;
  }

  switch (node.type) {
    case "Literal":
      if (emitResult) out.push({ op: "PUSH_CONST", value: node.value });
      return;
    case "Identifier":
      if (emitResult) out.push({ op: "LOAD", name: node.name });
      return;
    case "AssignmentExpression":
      compileExpression(node.right, out, { emitResult: true });
      out.push({ op: "STORE", name: node.left.name });
      if (emitResult) out.push({ op: "LOAD", name: node.left.name });
      return;
    case "UnaryExpression":
      compileExpression(node.argument, out, { emitResult: true });
      out.push({ op: unaryOperatorToOpcode(node.operator) });
      if (!emitResult) out.push({ op: "DROP" });
      return;
    case "BinaryExpression":
      compileExpression(node.left, out, { emitResult: true });
      compileExpression(node.right, out, { emitResult: true });
      out.push({ op: binaryOperatorToOpcode(node.operator) });
      if (!emitResult) out.push({ op: "DROP" });
      return;
    case "CallExpression":
      compileCallExpression(node, out, emitResult);
      return;
    default:
      throw new Error(`Unsupported expression: ${node.type}`);
  }
}

function compileCallExpression(node, out, emitResult) {
  const calleeName = normalizeCalleeName(node.callee);
  for (const arg of node.arguments) {
    compileExpression(arg, out, { emitResult: true });
  }

  if (calleeName === "print" || calleeName === "console.log") {
    out.push({ op: "PRINT", argc: node.arguments.length, discardResult: !emitResult });
    return;
  }

  out.push({
    op: "CALL",
    callee: calleeName,
    argc: node.arguments.length,
    discardResult: !emitResult
  });
}

function normalizeCalleeName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression") {
    const object = normalizeCalleeName(callee.object);
    return `${object}.${callee.property.name}`;
  }
  throw new Error(`Unsupported callee node: ${callee.type}`);
}

function binaryOperatorToOpcode(operator) {
  switch (operator) {
    case "+":
      return "ADD";
    case "-":
      return "SUB";
    case "*":
      return "MUL";
    case "/":
      return "DIV";
    case "<":
      return "LT";
    case ">":
      return "GT";
    case "<=":
      return "LTE";
    case ">=":
      return "GTE";
    case "==":
      return "EQ";
    case "!=":
      return "NEQ";
    default:
      throw new Error(`Unsupported binary operator: ${operator}`);
  }
}

function unaryOperatorToOpcode(operator) {
  switch (operator) {
    case "-":
      return "NEG";
    case "!":
      return "NOT";
    default:
      throw new Error(`Unsupported unary operator: ${operator}`);
  }
}

function encodeInstructionStream(instructions) {
  const payload = instructions.map((inst) => JSON.stringify(inst)).join("\n");
  return Buffer.from(`${payload}\n`, "utf8");
}

function extractDeclarationNames(declaration) {
  if (declaration.type === "FunctionDeclaration") {
    return [declaration.id.name];
  }
  if (declaration.type === "VariableDeclaration") {
    return declaration.declarations.map((declarator) => declarator.id.name);
  }
  return [];
}

function optimizeAst(ast, treeInfo) {
  const stats = {
    foldedConstants: 0,
    removedPureExpressions: 0,
    prunedBranches: 0,
    removedLoops: 0
  };

  const optimizedBody = optimizeStatementList(ast.body, stats, createBlockResolver(treeInfo));
  return {
    ast: { ...ast, body: optimizedBody },
    stats
  };
}

function optimizeStatementList(statements, stats, blockResolver) {
  const optimized = [];

  for (const statement of statements) {
    const next = optimizeStatement(statement, stats, blockResolver);
    if (next === null) continue;
    if (Array.isArray(next)) {
      optimized.push(...next);
    } else {
      optimized.push(next);
    }
  }

  return optimized;
}

function optimizeStatement(statement, stats, blockResolver) {
  switch (statement.type) {
    case "ExpressionStatement": {
      const expression = optimizeExpression(statement.expression, stats);
      if (isPureExpression(expression)) {
        stats.removedPureExpressions += 1;
        return null;
      }
      return { ...statement, expression };
    }
    case "VariableDeclaration":
      return {
        ...statement,
        declarations: statement.declarations.map((declaration) => ({
          ...declaration,
          init: declaration.init ? optimizeExpression(declaration.init, stats) : null
        }))
      };
    case "IfStatement": {
      const test = optimizeExpression(statement.test, stats);
      const consequent = optimizeStatement(statement.consequent, stats, blockResolver);
      const alternate = statement.alternate ? optimizeStatement(statement.alternate, stats, blockResolver) : null;

      if (test.type === "Literal") {
        stats.prunedBranches += 1;
        if (test.value) {
          return consequent ?? null;
        }
        return alternate ?? null;
      }

      return {
        ...statement,
        test,
        consequent: consequent ?? { type: "BlockStatement", body: [], start: statement.start, end: statement.end },
        alternate
      };
    }
    case "WhileStatement": {
      const test = optimizeExpression(statement.test, stats);
      if (test.type === "Literal" && !test.value) {
        stats.removedLoops += 1;
        return null;
      }
      const body = optimizeStatement(statement.body, stats, blockResolver);
      return {
        ...statement,
        test,
        body: body ?? { type: "BlockStatement", body: [], start: statement.start, end: statement.end }
      };
    }
    case "BlockStatement": {
      const body = optimizeStatementList(statement.body, stats, blockResolver);
      const block = blockResolver.resolve(statement.start, statement.end);
      if (block?.kind === "while" && body.length === 0) {
        // Keep empty loop block explicit to preserve control-flow shape for later passes.
        return { ...statement, body };
      }
      return { ...statement, body };
    }
    case "FunctionDeclaration":
      return {
        ...statement,
        body: {
          ...statement.body,
          body: optimizeStatementList(statement.body.body, stats, blockResolver)
        }
      };
    case "ReturnStatement":
      return {
        ...statement,
        argument: statement.argument ? optimizeExpression(statement.argument, stats) : null
      };
    case "ExportNamedDeclaration":
      return {
        ...statement,
        declaration: statement.declaration ? optimizeStatement(statement.declaration, stats, blockResolver) : null
      };
    case "ExportDefaultDeclaration":
      return {
        ...statement,
        declaration: optimizeExpression(statement.declaration, stats)
      };
    default:
      return statement;
  }
}

function optimizeExpression(expression, stats) {
  switch (expression.type) {
    case "Literal":
    case "Identifier":
      return expression;
    case "UnaryExpression": {
      const argument = optimizeExpression(expression.argument, stats);
      if (argument.type === "Literal") {
        stats.foldedConstants += 1;
        return {
          type: "Literal",
          value: evaluateUnary(expression.operator, argument.value),
          start: expression.start,
          end: expression.end
        };
      }
      return { ...expression, argument };
    }
    case "BinaryExpression": {
      const left = optimizeExpression(expression.left, stats);
      const right = optimizeExpression(expression.right, stats);
      if (left.type === "Literal" && right.type === "Literal") {
        stats.foldedConstants += 1;
        return {
          type: "Literal",
          value: evaluateBinary(expression.operator, left.value, right.value),
          start: expression.start,
          end: expression.end
        };
      }
      return { ...expression, left, right };
    }
    case "AssignmentExpression":
      return {
        ...expression,
        right: optimizeExpression(expression.right, stats)
      };
    case "CallExpression":
      return {
        ...expression,
        arguments: expression.arguments.map((arg) => optimizeExpression(arg, stats))
      };
    default:
      return expression;
  }
}

function evaluateUnary(operator, value) {
  switch (operator) {
    case "-":
      return -value;
    case "!":
      return !value;
    default:
      throw new Error(`Unsupported unary operator in optimizer: ${operator}`);
  }
}

function evaluateBinary(operator, left, right) {
  switch (operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return left / right;
    case "<":
      return left < right;
    case ">":
      return left > right;
    case "<=":
      return left <= right;
    case ">=":
      return left >= right;
    case "==":
      return left == right; // eslint-disable-line eqeqeq
    case "!=":
      return left != right; // eslint-disable-line eqeqeq
    default:
      throw new Error(`Unsupported binary operator in optimizer: ${operator}`);
  }
}

function isPureExpression(expression) {
  switch (expression.type) {
    case "Literal":
    case "Identifier":
      return true;
    case "UnaryExpression":
      return isPureExpression(expression.argument);
    case "BinaryExpression":
      return isPureExpression(expression.left) && isPureExpression(expression.right);
    case "MemberExpression":
      return isPureExpression(expression.object);
    default:
      return false;
  }
}

function createBlockResolver(treeInfo) {
  const blockTable = treeInfo?.blockTable ?? [];
  const ordered = [...blockTable]
    .filter((block) => block.end !== null && block.end !== undefined)
    .sort((a, b) => b.depth - a.depth);

  return {
    resolve(start, end) {
      for (const block of ordered) {
        if (start >= block.start && end <= block.end) {
          return block;
        }
      }
      return null;
    }
  };
}
