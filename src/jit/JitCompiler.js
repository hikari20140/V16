import { Buffer } from "node:buffer";

export function compileToBinary(ast, treeInfo = null) {
  const blockResolver = createBlockResolver(treeInfo);
  const optimization = optimizeAst(ast, blockResolver);

  const instructions = [];
  const state = {
    inFunction: false,
    loopStack: [],
    blockResolver,
    tempCounter: 0
  };

  compileProgram(optimization.ast, instructions, state);

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
      compileExpression(node.declaration, out, state, { emitResult: true });
      out.push({ op: "EXPORT_VALUE", exported: "default" });
      return;
    case "FunctionDeclaration":
      compileFunctionDeclaration(node, out, state);
      return;
    case "VariableDeclaration":
      compileVariableDeclaration(node, out, state);
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
    case "ForStatement":
      compileForStatement(node, out, state);
      return;
    case "BreakStatement":
      compileBreakStatement(out, state);
      return;
    case "ContinueStatement":
      compileContinueStatement(out, state);
      return;
    case "ReturnStatement":
      compileReturnStatement(node, out, state);
      return;
    case "ExpressionStatement":
      compileExpression(node.expression, out, state, { emitResult: false });
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
  const name = node.id.name;
  out.push({ op: "DECLARE", kind: "var", name });
  compileFunctionLike(node, out, state, { functionName: name, emitStore: true });
}

function compileFunctionLike(node, out, state, options) {
  const bodyInstructions = [];
  const functionState = {
    ...state,
    inFunction: true,
    loopStack: []
  };

  if (node.body.type === "BlockStatement") {
    for (const statement of node.body.body) {
      compileStatement(statement, bodyInstructions, functionState);
    }
  } else {
    compileExpression(node.body, bodyInstructions, functionState, { emitResult: true });
    bodyInstructions.push({ op: "RET" });
  }

  bodyInstructions.push({ op: "PUSH_CONST", value: undefined });
  bodyInstructions.push({ op: "RET" });

  out.push({
    op: "MAKE_FUNCTION",
    name: options.functionName ?? null,
    params: node.params.map((param) => param.name),
    body: bodyInstructions
  });

  if (options.emitStore) {
    out.push({ op: "STORE", name: options.functionName });
  }
}

function compileVariableDeclaration(node, out, state) {
  for (const declarator of node.declarations) {
    out.push({
      op: "DECLARE",
      kind: node.kind,
      name: declarator.id.name
    });
    if (declarator.init) {
      compileExpression(declarator.init, out, state, { emitResult: true });
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
  compileExpression(node.test, out, state, { emitResult: true });
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
  const blockInfo = node.body?.type === "BlockStatement"
    ? state.blockResolver.resolve(node.body.start, node.body.end)
    : state.blockResolver.resolve(node.start, node.end);
  if (blockInfo) {
    out.push({
      op: "BLOCK_HINT",
      blockId: blockInfo.id,
      kind: blockInfo.kind,
      depth: blockInfo.depth,
      statementCount: blockInfo.statementCount
    });
  }

  const testLabel = out.length;
  compileExpression(node.test, out, state, { emitResult: true });
  const exitJumpIndex = emitJump(out, "JMP_IF_FALSE");

  const loopContext = { breakJumps: [], continueJumps: [], continueTarget: testLabel };
  state.loopStack.push(loopContext);

  compileStatement(node.body, out, state);

  out.push({ op: "JMP", target: testLabel });
  const exitLabel = out.length;
  patchJump(out, exitJumpIndex, exitLabel);
  patchLoopJumps(out, loopContext, exitLabel, testLabel);

  state.loopStack.pop();
}

function compileForStatement(node, out, state) {
  if (node.init) {
    if (node.init.type === "VariableDeclaration") {
      compileVariableDeclaration(node.init, out, state);
    } else {
      compileExpression(node.init, out, state, { emitResult: false });
    }
  }

  const testLabel = out.length;
  let exitJumpIndex = null;

  if (node.test) {
    compileExpression(node.test, out, state, { emitResult: true });
    exitJumpIndex = emitJump(out, "JMP_IF_FALSE");
  }

  const loopContext = { breakJumps: [], continueJumps: [], continueTarget: -1 };
  state.loopStack.push(loopContext);

  compileStatement(node.body, out, state);

  const continueTarget = out.length;
  loopContext.continueTarget = continueTarget;

  if (node.update) {
    compileExpression(node.update, out, state, { emitResult: false });
  }

  out.push({ op: "JMP", target: testLabel });
  const exitLabel = out.length;

  if (exitJumpIndex !== null) {
    patchJump(out, exitJumpIndex, exitLabel);
  }

  patchLoopJumps(out, loopContext, exitLabel, continueTarget);
  state.loopStack.pop();
}

function compileBreakStatement(out, state) {
  const currentLoop = state.loopStack[state.loopStack.length - 1];
  if (!currentLoop) {
    throw new Error("`break` must be used inside a loop.");
  }
  out.push({ op: "JMP", target: -1 });
  currentLoop.breakJumps.push(out.length - 1);
}

function compileContinueStatement(out, state) {
  const currentLoop = state.loopStack[state.loopStack.length - 1];
  if (!currentLoop) {
    throw new Error("`continue` must be used inside a loop.");
  }
  out.push({ op: "JMP", target: -1 });
  currentLoop.continueJumps.push(out.length - 1);
}

function patchLoopJumps(out, loopContext, breakTarget, continueTarget) {
  for (const jumpIndex of loopContext.breakJumps) {
    patchJump(out, jumpIndex, breakTarget);
  }
  for (const jumpIndex of loopContext.continueJumps) {
    patchJump(out, jumpIndex, continueTarget);
  }
}

function compileReturnStatement(node, out, state) {
  if (!state.inFunction) {
    throw new Error("`return` is only allowed inside a function in V16.");
  }
  if (node.argument) {
    compileExpression(node.argument, out, state, { emitResult: true });
  } else {
    out.push({ op: "PUSH_CONST", value: undefined });
  }
  out.push({ op: "RET" });
}

function emitJump(out, op) {
  out.push({ op, target: -1 });
  return out.length - 1;
}

function patchJump(out, index, target) {
  out[index].target = target;
}

function compileExpression(node, out, state, options = { emitResult: true }) {
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
    case "MemberExpression":
      compileMemberExpression(node, out, state, emitResult);
      return;
    case "TemplateLiteral":
      compileTemplateLiteral(node, out, state, emitResult);
      return;
    case "AssignmentExpression":
      compileExpression(node.right, out, state, { emitResult: true });
      out.push({ op: "STORE", name: node.left.name });
      if (emitResult) out.push({ op: "LOAD", name: node.left.name });
      return;
    case "UnaryExpression":
      compileExpression(node.argument, out, state, { emitResult: true });
      out.push({ op: unaryOperatorToOpcode(node.operator) });
      if (!emitResult) out.push({ op: "DROP" });
      return;
    case "BinaryExpression":
      compileExpression(node.left, out, state, { emitResult: true });
      compileExpression(node.right, out, state, { emitResult: true });
      out.push({ op: binaryOperatorToOpcode(node.operator) });
      if (!emitResult) out.push({ op: "DROP" });
      return;
    case "LogicalExpression":
      compileLogicalExpression(node, out, state, emitResult);
      return;
    case "CallExpression":
      compileCallExpression(node, out, state, emitResult);
      return;
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      compileFunctionExpression(node, out, state, emitResult);
      return;
    default:
      throw new Error(`Unsupported expression: ${node.type}`);
  }
}

function compileMemberExpression(node, out, state, emitResult) {
  if (!emitResult) {
    return;
  }
  compileExpression(node.object, out, state, { emitResult: true });
  out.push({ op: "GET_PROP", property: node.property.name });
}

function compileLogicalExpression(node, out, state, emitResult) {
  if (node.operator === "&&") {
    compileExpression(node.left, out, state, { emitResult: true });
    out.push({ op: "DUP" });
    const falseJumpIndex = emitJump(out, "JMP_IF_FALSE");
    out.push({ op: "DROP" });
    compileExpression(node.right, out, state, { emitResult: true });
    patchJump(out, falseJumpIndex, out.length);
  } else if (node.operator === "||") {
    compileExpression(node.left, out, state, { emitResult: true });
    out.push({ op: "DUP" });
    const evaluateRightJump = emitJump(out, "JMP_IF_FALSE");
    const endJump = emitJump(out, "JMP");
    patchJump(out, evaluateRightJump, out.length);
    out.push({ op: "DROP" });
    compileExpression(node.right, out, state, { emitResult: true });
    patchJump(out, endJump, out.length);
  } else {
    throw new Error(`Unsupported logical operator: ${node.operator}`);
  }

  if (!emitResult) {
    out.push({ op: "DROP" });
  }
}

function compileCallExpression(node, out, state, emitResult) {
  for (const arg of node.arguments) {
    compileExpression(arg, out, state, { emitResult: true });
  }

  if (node.callee.type === "MemberExpression") {
    compileExpression(node.callee.object, out, state, { emitResult: true });
    out.push({
      op: "CALL_MEMBER",
      property: node.callee.property.name,
      argc: node.arguments.length,
      discardResult: !emitResult
    });
    return;
  }

  compileExpression(node.callee, out, state, { emitResult: true });
  out.push({
    op: "CALL_DYNAMIC",
    argc: node.arguments.length,
    discardResult: !emitResult
  });
}

function compileFunctionExpression(node, out, state, emitResult) {
  compileFunctionLike(node, out, state, {
    functionName: node.id?.name ?? null,
    emitStore: false
  });

  if (node.type === "ArrowFunctionExpression" && node.expression) {
    // handled by compileFunctionLike using expression body path
  }

  if (!emitResult) {
    out.push({ op: "DROP" });
  }
}

function compileTemplateLiteral(node, out, state, emitResult) {
  const quasis = node.quasis ?? [];
  const expressions = node.expressions ?? [];

  if (quasis.length === 0) {
    if (emitResult) {
      out.push({ op: "PUSH_CONST", value: "" });
    }
    return;
  }

  out.push({ op: "PUSH_CONST", value: quasis[0].value ?? "" });

  for (let i = 0; i < expressions.length; i += 1) {
    compileExpression(expressions[i], out, state, { emitResult: true });
    out.push({ op: "ADD" });
    out.push({ op: "PUSH_CONST", value: quasis[i + 1]?.value ?? "" });
    out.push({ op: "ADD" });
  }

  if (!emitResult) {
    out.push({ op: "DROP" });
  }
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

function optimizeAst(ast, blockResolver) {
  const stats = {
    foldedConstants: 0,
    removedPureExpressions: 0,
    prunedBranches: 0,
    removedLoops: 0,
    licmHoists: 0,
    blockCseReuses: 0
  };

  const optimizedBody = optimizeStatementList(ast.body, stats, blockResolver);
  return {
    ast: { ...ast, body: optimizedBody },
    stats
  };
}

function optimizeStatementList(statements, stats, blockResolver) {
  const optimized = [];
  const cseState = createCseState();

  for (const statement of statements) {
    const next = optimizeStatement(statement, stats, blockResolver, cseState);
    if (next === null) continue;
    if (Array.isArray(next)) {
      optimized.push(...next);
      continue;
    }
    optimized.push(next);
  }

  return optimized;
}

function optimizeStatement(statement, stats, blockResolver, cseState) {
  switch (statement.type) {
    case "ExpressionStatement": {
      const expression = optimizeExpression(statement.expression, stats);
      if (isPureExpression(expression)) {
        stats.removedPureExpressions += 1;
        return null;
      }
      cseInvalidateByExpression(expression, cseState);
      return { ...statement, expression };
    }
    case "VariableDeclaration": {
      const declarations = [];
      for (const declaration of statement.declarations) {
        const init = declaration.init ? optimizeExpression(declaration.init, stats) : null;
        let finalInit = init;
        if (init) {
          const key = expressionKey(init);
          const deps = collectIdentifiers(init);
          if (key && !hasDependencyConflict(deps, cseState.assignedNames)) {
            const existingName = cseState.expressionToName.get(key);
            if (existingName && existingName !== declaration.id.name) {
              finalInit = {
                type: "Identifier",
                name: existingName,
                start: init.start,
                end: init.end
              };
              stats.blockCseReuses += 1;
            } else {
              cseState.expressionToName.set(key, declaration.id.name);
            }
          }
        }

        declarations.push({
          ...declaration,
          init: finalInit
        });
        cseState.assignedNames.add(declaration.id.name);
      }
      return { ...statement, declarations };
    }
    case "IfStatement": {
      const test = optimizeExpression(statement.test, stats);
      const consequent = optimizeStatement(statement.consequent, stats, blockResolver, createCseState());
      const alternate = statement.alternate
        ? optimizeStatement(statement.alternate, stats, blockResolver, createCseState())
        : null;

      if (test.type === "Literal") {
        stats.prunedBranches += 1;
        if (test.value) return consequent ?? null;
        return alternate ?? null;
      }

      return {
        ...statement,
        test,
        consequent: consequent ?? emptyBlockLike(statement),
        alternate
      };
    }
    case "WhileStatement": {
      const optimizedLoop = optimizeLoopStatement(statement, stats, blockResolver, "while");
      if (optimizedLoop === null) {
        return null;
      }
      cseState.expressionToName.clear();
      return optimizedLoop;
    }
    case "ForStatement": {
      const optimizedLoop = optimizeLoopStatement(statement, stats, blockResolver, "for");
      if (optimizedLoop === null) {
        return null;
      }
      cseState.expressionToName.clear();
      return optimizedLoop;
    }
    case "BlockStatement": {
      const body = optimizeStatementList(statement.body, stats, blockResolver);
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
        declaration: statement.declaration
          ? optimizeStatement(statement.declaration, stats, blockResolver, createCseState())
          : null
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

function optimizeLoopStatement(statement, stats, blockResolver, loopKind) {
  const bodyNode = statement.body.type === "BlockStatement" ? statement.body : null;

  const loopInfo = bodyNode
    ? blockResolver.resolve(bodyNode.start, bodyNode.end)
    : blockResolver.resolve(statement.start, statement.end);
  const canUseTreeGuidedLicm = loopInfo && (loopInfo.kind === "while" || loopInfo.kind === "for");

  const optimizedBody = optimizeStatement(statement.body, stats, blockResolver, createCseState());

  if (loopKind === "while") {
    const test = optimizeExpression(statement.test, stats);
    if (test.type === "Literal" && !test.value) {
      stats.removedLoops += 1;
      return null;
    }

    const mutated = collectMutatedIdentifiersFromStatement(optimizedBody);
    const licmResult = canUseTreeGuidedLicm
      ? hoistInvariantFromTest(test, mutated, stats, "__v16_licm_w")
      : { prelude: [], test };

    const loopNode = {
      ...statement,
      test: licmResult.test,
      body: optimizedBody ?? emptyBlockLike(statement)
    };

    if (licmResult.prelude.length > 0) {
      return [...licmResult.prelude, loopNode];
    }
    return loopNode;
  }

  const init = statement.init ? optimizeForPart(statement.init, stats, blockResolver) : null;
  const update = statement.update ? optimizeExpression(statement.update, stats) : null;
  const test = statement.test ? optimizeExpression(statement.test, stats) : null;

  if (test && test.type === "Literal" && !test.value) {
    stats.removedLoops += 1;
    return init ? [init] : null;
  }

  const mutated = collectMutatedIdentifiersFromStatement(optimizedBody);
  if (update) {
    for (const name of collectIdentifiers(update)) {
      mutated.add(name);
    }
  }

  const licmResult = canUseTreeGuidedLicm && test
    ? hoistInvariantFromTest(test, mutated, stats, "__v16_licm_f")
    : { prelude: [], test };

  const loopNode = {
    ...statement,
    init,
    test: test ? licmResult.test : null,
    update,
    body: optimizedBody ?? emptyBlockLike(statement)
  };

  if (licmResult.prelude.length > 0) {
    return [...licmResult.prelude, loopNode];
  }

  return loopNode;
}

function optimizeForPart(part, stats, blockResolver) {
  if (!part) return null;
  if (part.type === "VariableDeclaration") {
    return optimizeStatement(part, stats, blockResolver, createCseState());
  }
  return optimizeExpression(part, stats);
}

function hoistInvariantFromTest(test, mutatedIdentifiers, stats, prefix) {
  if (!test) {
    return { prelude: [], test };
  }

  let sequence = 0;
  const prelude = [];

  function visit(node) {
    if (node.type === "BinaryExpression" || node.type === "LogicalExpression") {
      const left = visit(node.left);
      const right = visit(node.right);
      const rebuilt = { ...node, left, right };
      const ids = collectIdentifiers(rebuilt);
      if (ids.size > 0 && !hasDependencyConflict(ids, mutatedIdentifiers) && isPureExpression(rebuilt)) {
        const tempName = `${prefix}_${sequence}`;
        sequence += 1;
        prelude.push(makeTempDeclaration(tempName, rebuilt));
        stats.licmHoists += 1;
        return {
          type: "Identifier",
          name: tempName,
          start: rebuilt.start,
          end: rebuilt.end
        };
      }
      return rebuilt;
    }

    if (node.type === "UnaryExpression") {
      const argument = visit(node.argument);
      return { ...node, argument };
    }

    return node;
  }

  return { prelude, test: visit(test) };
}

function makeTempDeclaration(name, init) {
  return {
    type: "VariableDeclaration",
    kind: "const",
    declarations: [
      {
        type: "VariableDeclarator",
        id: {
          type: "Identifier",
          name,
          start: init.start,
          end: init.start
        },
        init,
        start: init.start,
        end: init.end
      }
    ],
    start: init.start,
    end: init.end
  };
}

function optimizeExpression(expression, stats) {
  switch (expression.type) {
    case "Literal":
    case "Identifier":
      return expression;
    case "MemberExpression":
      return {
        ...expression,
        object: optimizeExpression(expression.object, stats)
      };
    case "FunctionExpression":
      return {
        ...expression,
        body: {
          ...expression.body,
          body: optimizeStatementList(expression.body.body, stats, createBlockResolver())
        }
      };
    case "ArrowFunctionExpression":
      return {
        ...expression,
        body: expression.body.type === "BlockStatement"
          ? { ...expression.body, body: optimizeStatementList(expression.body.body, stats, createBlockResolver()) }
          : optimizeExpression(expression.body, stats)
      };
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
    case "LogicalExpression": {
      const left = optimizeExpression(expression.left, stats);
      const right = optimizeExpression(expression.right, stats);
      if (left.type === "Literal") {
        stats.prunedBranches += 1;
        if (expression.operator === "&&") {
          return left.value ? right : left;
        }
        return left.value ? left : right;
      }
      return { ...expression, left, right };
    }
    case "TemplateLiteral": {
      const expressions = expression.expressions.map((expr) => optimizeExpression(expr, stats));
      const quasis = expression.quasis;
      if (expressions.every((expr) => expr.type === "Literal")) {
        stats.foldedConstants += 1;
        return {
          type: "Literal",
          value: evaluateTemplateLiteral(quasis, expressions),
          start: expression.start,
          end: expression.end
        };
      }
      return { ...expression, expressions, quasis };
    }
    case "AssignmentExpression":
      return {
        ...expression,
        right: optimizeExpression(expression.right, stats)
      };
    case "CallExpression":
      return {
        ...expression,
        callee: optimizeExpression(expression.callee, stats),
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

function evaluateTemplateLiteral(quasis, expressions) {
  let result = String(quasis[0]?.value ?? "");
  for (let i = 0; i < expressions.length; i += 1) {
    result += String(expressions[i].value);
    result += String(quasis[i + 1]?.value ?? "");
  }
  return result;
}

function createBlockResolver(treeInfo = null) {
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

function emptyBlockLike(statement) {
  return {
    type: "BlockStatement",
    body: [],
    start: statement.start,
    end: statement.end
  };
}

function collectIdentifiers(node, out = new Set()) {
  if (!node) return out;

  switch (node.type) {
    case "Identifier":
      out.add(node.name);
      return out;
    case "Literal":
      return out;
    case "UnaryExpression":
      return collectIdentifiers(node.argument, out);
    case "BinaryExpression":
    case "LogicalExpression":
      collectIdentifiers(node.left, out);
      collectIdentifiers(node.right, out);
      return out;
    case "AssignmentExpression":
      collectIdentifiers(node.left, out);
      collectIdentifiers(node.right, out);
      return out;
    case "MemberExpression":
      return collectIdentifiers(node.object, out);
    case "CallExpression":
      collectIdentifiers(node.callee, out);
      for (const arg of node.arguments) {
        collectIdentifiers(arg, out);
      }
      return out;
    case "TemplateLiteral":
      for (const expr of node.expressions) {
        collectIdentifiers(expr, out);
      }
      return out;
    default:
      return out;
  }
}

function collectMutatedIdentifiersFromStatement(statement, out = new Set()) {
  if (!statement) return out;

  switch (statement.type) {
    case "VariableDeclaration":
      for (const declaration of statement.declarations) {
        out.add(declaration.id.name);
      }
      return out;
    case "ExpressionStatement":
      return collectMutatedIdentifiersFromExpression(statement.expression, out);
    case "AssignmentExpression":
      out.add(statement.left.name);
      return out;
    case "BlockStatement":
      for (const child of statement.body) {
        collectMutatedIdentifiersFromStatement(child, out);
      }
      return out;
    case "IfStatement":
      collectMutatedIdentifiersFromStatement(statement.consequent, out);
      if (statement.alternate) collectMutatedIdentifiersFromStatement(statement.alternate, out);
      return out;
    case "WhileStatement":
    case "ForStatement":
      collectMutatedIdentifiersFromStatement(statement.body, out);
      return out;
    case "FunctionDeclaration":
      out.add(statement.id.name);
      return out;
    default:
      return out;
  }
}

function collectMutatedIdentifiersFromExpression(expression, out = new Set()) {
  if (!expression) return out;

  switch (expression.type) {
    case "AssignmentExpression":
      out.add(expression.left.name);
      collectMutatedIdentifiersFromExpression(expression.right, out);
      return out;
    case "BinaryExpression":
    case "LogicalExpression":
      collectMutatedIdentifiersFromExpression(expression.left, out);
      collectMutatedIdentifiersFromExpression(expression.right, out);
      return out;
    case "UnaryExpression":
      collectMutatedIdentifiersFromExpression(expression.argument, out);
      return out;
    case "CallExpression":
      for (const arg of expression.arguments) {
        collectMutatedIdentifiersFromExpression(arg, out);
      }
      return out;
    default:
      return out;
  }
}

function hasDependencyConflict(identifiers, assignedNames) {
  for (const name of identifiers) {
    if (assignedNames.has(name)) {
      return true;
    }
  }
  return false;
}

function expressionKey(expression) {
  switch (expression.type) {
    case "Literal":
      return `L:${JSON.stringify(expression.value)}`;
    case "Identifier":
      return `I:${expression.name}`;
    case "UnaryExpression": {
      const argument = expressionKey(expression.argument);
      return argument ? `U:${expression.operator}:${argument}` : null;
    }
    case "BinaryExpression": {
      const left = expressionKey(expression.left);
      const right = expressionKey(expression.right);
      if (!left || !right) return null;
      return `B:${expression.operator}:${left}:${right}`;
    }
    default:
      return null;
  }
}

function createCseState() {
  return {
    expressionToName: new Map(),
    assignedNames: new Set()
  };
}

function cseInvalidateByExpression(expression, cseState) {
  if (!expression) return;
  if (expression.type === "AssignmentExpression") {
    cseState.assignedNames.add(expression.left.name);
    cseState.expressionToName.clear();
    return;
  }
  if (expression.type === "CallExpression") {
    cseState.expressionToName.clear();
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
    case "LogicalExpression":
      return isPureExpression(expression.left) && isPureExpression(expression.right);
    case "MemberExpression":
      return isPureExpression(expression.object);
    case "TemplateLiteral":
      return expression.expressions.every((expr) => isPureExpression(expr));
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return true;
    default:
      return false;
  }
}
