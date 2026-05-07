import { Buffer } from "node:buffer";

export function compileToBinary(ast, treeInfo = null) {
  const instructions = [];

  for (const statement of ast.body) {
    compileStatement(statement, instructions);
  }

  const binary = encodeInstructionStream(instructions);

  return {
    instructions,
    binary,
    meta: {
      stage: "jit",
      instructionCount: instructions.length,
      byteLength: binary.byteLength,
      treeMetrics: treeInfo?.metrics ?? null
    }
  };
}

function compileStatement(node, out) {
  switch (node.type) {
    case "VariableDeclaration": {
      out.push({
        op: "DECLARE",
        kind: node.kind,
        name: node.id.name
      });
      if (node.init) {
        compileExpression(node.init, out);
        out.push({ op: "STORE", name: node.id.name });
      }
      return;
    }
    case "ExpressionStatement": {
      compileExpression(node.expression, out);
      out.push({ op: "POP" });
      return;
    }
    default:
      throw new Error(`Unsupported statement: ${node.type}`);
  }
}

function compileExpression(node, out) {
  switch (node.type) {
    case "Literal":
      out.push({ op: "PUSH_CONST", value: node.value });
      return;
    case "Identifier":
      out.push({ op: "LOAD", name: node.name });
      return;
    case "AssignmentExpression":
      compileExpression(node.right, out);
      out.push({ op: "STORE", name: node.left.name });
      out.push({ op: "LOAD", name: node.left.name });
      return;
    case "BinaryExpression":
      compileExpression(node.left, out);
      compileExpression(node.right, out);
      out.push({ op: binaryOperatorToOpcode(node.operator) });
      return;
    case "CallExpression":
      compileCall(node, out);
      return;
    default:
      throw new Error(`Unsupported expression: ${node.type}`);
  }
}

function compileCall(node, out) {
  const calleeName = normalizeCalleeName(node.callee);
  for (const arg of node.arguments) {
    compileExpression(arg, out);
  }

  if (calleeName === "print" || calleeName === "console.log") {
    out.push({ op: "PRINT", argc: node.arguments.length });
    out.push({ op: "PUSH_CONST", value: null });
    return;
  }

  throw new Error(`Unsupported call target: ${calleeName}`);
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
    default:
      throw new Error(`Unsupported binary operator: ${operator}`);
  }
}

function encodeInstructionStream(instructions) {
  const payload = instructions.map((inst) => JSON.stringify(inst)).join("\n");
  return Buffer.from(`${payload}\n`, "utf8");
}
