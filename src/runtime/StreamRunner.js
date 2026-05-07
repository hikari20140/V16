import { once } from "node:events";

export class BytecodeVM {
  constructor({ logger = console.log, modules = {}, moduleName = "main" } = {}) {
    this.logger = logger;
    this.modules = modules;
    this.moduleName = moduleName;
    this.moduleExports = {};
    this.functions = new Map();
    this.outputs = [];
    this.stack = [];
    this.scopes = [{ kind: "global", bindings: new Map() }];
  }

  run(instructions) {
    this.executeInstructions(instructions);
    return {
      env: this.snapshotGlobalBindings(),
      outputs: this.outputs,
      exports: this.moduleExports
    };
  }

  executeInstructions(instructions) {
    let ip = 0;

    while (ip < instructions.length) {
      const instruction = instructions[ip];

      switch (instruction.op) {
        case "BLOCK_HINT":
          break;
        case "ENTER_SCOPE":
          this.enterScope(instruction.kind ?? "block");
          break;
        case "EXIT_SCOPE":
          this.exitScope();
          break;
        case "DECLARE":
          this.declare(instruction.name, instruction.kind);
          break;
        case "PUSH_CONST":
          this.stack.push(instruction.value);
          break;
        case "LOAD":
          this.stack.push(this.lookup(instruction.name));
          break;
        case "STORE": {
          const value = this.stack.pop();
          this.assign(instruction.name, value);
          break;
        }
        case "ADD":
        case "SUB":
        case "MUL":
        case "DIV":
        case "LT":
        case "GT":
        case "LTE":
        case "GTE":
        case "EQ":
        case "NEQ": {
          const right = this.stack.pop();
          const left = this.stack.pop();
          this.stack.push(executeBinary(instruction.op, left, right));
          break;
        }
        case "NEG": {
          const value = this.stack.pop();
          this.stack.push(-value);
          break;
        }
        case "NOT": {
          const value = this.stack.pop();
          this.stack.push(!value);
          break;
        }
        case "DROP":
          this.stack.pop();
          break;
        case "JMP":
          ip = instruction.target;
          continue;
        case "JMP_IF_FALSE": {
          const condition = this.stack.pop();
          if (!condition) {
            ip = instruction.target;
            continue;
          }
          break;
        }
        case "PRINT": {
          const argc = instruction.argc ?? 0;
          const args = [];
          for (let i = 0; i < argc; i += 1) {
            args.push(this.stack.pop());
          }
          args.reverse();
          this.outputs.push(args);
          this.logger(...args);
          if (!instruction.discardResult) {
            this.stack.push(null);
          }
          break;
        }
        case "REGISTER_FUNC":
          this.registerFunction(instruction.name, instruction.params, instruction.body);
          break;
        case "CALL": {
          const argc = instruction.argc ?? 0;
          const args = [];
          for (let i = 0; i < argc; i += 1) {
            args.push(this.stack.pop());
          }
          args.reverse();
          const value = this.call(instruction.callee, args);
          if (!instruction.discardResult) {
            this.stack.push(value);
          }
          break;
        }
        case "RET": {
          const value = this.stack.pop();
          return { returned: true, value };
        }
        case "IMPORT":
          this.applyImport(instruction.source, instruction.specifiers ?? []);
          break;
        case "EXPORT":
          this.moduleExports[instruction.exported] = this.lookup(instruction.local);
          break;
        case "EXPORT_VALUE": {
          const value = this.stack.pop();
          this.moduleExports[instruction.exported] = value;
          break;
        }
        default:
          throw new Error(`Unknown opcode: ${instruction.op}`);
      }

      ip += 1;
    }

    return { returned: false, value: undefined };
  }

  registerFunction(name, params, body) {
    this.functions.set(name, { params, body });
    this.declare(name, "var");
    this.assign(name, { __v16Function: name });
  }

  call(callee, args) {
    if (callee === "print" || callee === "console.log") {
      this.outputs.push(args);
      this.logger(...args);
      return null;
    }

    if (this.functions.has(callee)) {
      return this.executeFunction(callee, args);
    }

    const direct = this.lookup(callee);
    if (direct && typeof direct === "object" && direct.__v16Function && this.functions.has(direct.__v16Function)) {
      return this.executeFunction(direct.__v16Function, args);
    }

    if (typeof direct === "function") {
      return direct(...args);
    }

    if (callee.includes(".")) {
      const [root, ...rest] = callee.split(".");
      let target = this.lookup(root);
      for (const part of rest.slice(0, -1)) {
        target = target?.[part];
      }
      const method = rest[rest.length - 1];
      if (target && typeof target[method] === "function") {
        return target[method](...args);
      }
    }

    throw new Error(`Undefined function call: ${callee}`);
  }

  executeFunction(name, args) {
    const func = this.functions.get(name);
    if (!func) {
      throw new Error(`Unknown function: ${name}`);
    }

    this.enterScope("function");
    for (let i = 0; i < func.params.length; i += 1) {
      const paramName = func.params[i];
      this.declare(paramName, "let");
      this.assign(paramName, args[i]);
    }

    const result = this.executeInstructions(func.body);
    this.exitScope();

    return result.returned ? result.value : undefined;
  }

  applyImport(source, specifiers) {
    const moduleRecord = this.modules[source] ?? {};

    for (const specifier of specifiers) {
      let value;
      if (specifier.type === "namespace") {
        value = moduleRecord;
      } else {
        value = moduleRecord[specifier.imported];
      }
      this.declare(specifier.local, "const");
      this.assign(specifier.local, value);
    }
  }

  enterScope(kind) {
    this.scopes.push({ kind, bindings: new Map() });
  }

  exitScope() {
    if (this.scopes.length > 1) {
      this.scopes.pop();
    }
  }

  declare(name, kind = "let") {
    const targetScope = kind === "var" ? this.findNearestFunctionScope() : this.currentScope();
    if (!targetScope.bindings.has(name)) {
      targetScope.bindings.set(name, undefined);
    }
  }

  assign(name, value) {
    const scope = this.findScopeContaining(name);
    if (scope) {
      scope.bindings.set(name, value);
      return;
    }
    this.scopes[0].bindings.set(name, value);
  }

  lookup(name) {
    const scope = this.findScopeContaining(name);
    if (scope) {
      return scope.bindings.get(name);
    }
    return undefined;
  }

  currentScope() {
    return this.scopes[this.scopes.length - 1];
  }

  findNearestFunctionScope() {
    for (let i = this.scopes.length - 1; i >= 0; i -= 1) {
      const scope = this.scopes[i];
      if (scope.kind === "function" || scope.kind === "global") {
        return scope;
      }
    }
    return this.scopes[0];
  }

  findScopeContaining(name) {
    for (let i = this.scopes.length - 1; i >= 0; i -= 1) {
      const scope = this.scopes[i];
      if (scope.bindings.has(name)) {
        return scope;
      }
    }
    return null;
  }

  snapshotGlobalBindings() {
    return Object.fromEntries(this.scopes[0].bindings.entries());
  }
}

function executeBinary(op, left, right) {
  switch (op) {
    case "ADD":
      return left + right;
    case "SUB":
      return left - right;
    case "MUL":
      return left * right;
    case "DIV":
      return left / right;
    case "LT":
      return left < right;
    case "GT":
      return left > right;
    case "LTE":
      return left <= right;
    case "GTE":
      return left >= right;
    case "EQ":
      return left == right; // eslint-disable-line eqeqeq
    case "NEQ":
      return left != right; // eslint-disable-line eqeqeq
    default:
      throw new Error(`Unknown arithmetic opcode: ${op}`);
  }
}

export async function runBinaryStream(stream, vm) {
  const instructions = [];
  let pending = "";

  const processPending = () => {
    let newlineIndex = pending.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = pending.slice(0, newlineIndex).trim();
      pending = pending.slice(newlineIndex + 1);
      if (line.length > 0) {
        instructions.push(JSON.parse(line));
      }
      newlineIndex = pending.indexOf("\n");
    }
  };

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    processPending();
  });

  if (!stream.readableEnded) {
    await once(stream, "end");
  }
  processPending();

  return vm.run(instructions);
}
