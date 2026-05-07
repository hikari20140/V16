const KEYWORDS = new Set([
  "let",
  "const",
  "var",
  "if",
  "else",
  "while",
  "function",
  "return",
  "import",
  "from",
  "export",
  "as",
  "default",
  "true",
  "false",
  "null"
]);

const PUNCTUATORS = new Set([";", ",", "(", ")", "{", "}", "."]);
const SINGLE_CHAR_OPERATORS = new Set(["+", "-", "*", "/", "=", "<", ">", "!"]);
const DOUBLE_CHAR_OPERATORS = new Set(["==", "!=", "<=", ">="]);

function isWhitespace(char) {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isDigit(char) {
  return char >= "0" && char <= "9";
}

function isIdentifierStart(char) {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_$]/.test(char);
}

export function tokenize(source) {
  const tokens = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i];

    if (isWhitespace(char)) {
      i += 1;
      continue;
    }

    if (char === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }

    if (char === "/" && source[i + 1] === "*") {
      i += 2;
      while (i + 1 < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }

    if (char === "'" || char === "\"") {
      const quote = char;
      const start = i;
      i += 1;
      let value = "";

      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < source.length) {
          value += source[i + 1];
          i += 2;
          continue;
        }
        value += source[i];
        i += 1;
      }

      if (source[i] !== quote) {
        throw new SyntaxError("Unterminated string literal.");
      }

      i += 1;
      tokens.push({ type: "string", value, start, end: i });
      continue;
    }

    if (isDigit(char)) {
      const start = i;
      let value = char;
      i += 1;
      while (i < source.length && (isDigit(source[i]) || source[i] === ".")) {
        value += source[i];
        i += 1;
      }
      tokens.push({ type: "number", value, start, end: i });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = i;
      let value = char;
      i += 1;
      while (i < source.length && isIdentifierPart(source[i])) {
        value += source[i];
        i += 1;
      }
      tokens.push({
        type: KEYWORDS.has(value) ? "keyword" : "identifier",
        value,
        start,
        end: i
      });
      continue;
    }

    const twoChar = source.slice(i, i + 2);
    if (DOUBLE_CHAR_OPERATORS.has(twoChar)) {
      tokens.push({ type: "operator", value: twoChar, start: i, end: i + 2 });
      i += 2;
      continue;
    }

    if (PUNCTUATORS.has(char)) {
      tokens.push({ type: "punctuator", value: char, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    if (SINGLE_CHAR_OPERATORS.has(char)) {
      tokens.push({ type: "operator", value: char, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    throw new SyntaxError(`Unexpected character "${char}" at index ${i}.`);
  }

  tokens.push({ type: "eof", value: "<eof>", start: source.length, end: source.length });
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.cursor = 0;
  }

  current() {
    return this.tokens[this.cursor];
  }

  consume() {
    const token = this.current();
    this.cursor += 1;
    return token;
  }

  match(type, value = null) {
    const token = this.current();
    if (!token || token.type !== type) return false;
    if (value !== null && token.value !== value) return false;
    return true;
  }

  expect(type, value = null) {
    if (!this.match(type, value)) {
      const token = this.current();
      const got = token ? `${token.type}:${token.value}` : "EOF";
      const expected = value ? `${type}:${value}` : type;
      throw new SyntaxError(`Expected ${expected}, got ${got}.`);
    }
    return this.consume();
  }

  parseProgram() {
    const start = this.current().start;
    const body = [];
    while (!this.match("eof")) {
      body.push(this.parseStatement());
    }
    const end = this.current().end;
    return { type: "Program", body, start, end };
  }

  parseStatement() {
    if (this.match("keyword", "import")) return this.parseImportDeclaration();
    if (this.match("keyword", "export")) return this.parseExportDeclaration();
    if (this.match("keyword", "function")) return this.parseFunctionDeclaration();
    if (this.match("keyword", "if")) return this.parseIfStatement();
    if (this.match("keyword", "while")) return this.parseWhileStatement();
    if (this.match("keyword", "return")) return this.parseReturnStatement();
    if (this.match("keyword", "let") || this.match("keyword", "const") || this.match("keyword", "var")) {
      return this.parseVariableDeclaration();
    }
    if (this.match("punctuator", "{")) return this.parseBlockStatement();
    return this.parseExpressionStatement();
  }

  parseImportDeclaration() {
    const startToken = this.expect("keyword", "import");
    const specifiers = [];

    if (this.match("identifier")) {
      const local = this.parseIdentifier();
      specifiers.push({ type: "ImportDefaultSpecifier", local, start: local.start, end: local.end });
      if (this.match("punctuator", ",")) this.consume();
    }

    if (this.match("operator", "*")) {
      this.consume();
      this.expect("keyword", "as");
      const local = this.parseIdentifier();
      specifiers.push({ type: "ImportNamespaceSpecifier", local, start: local.start, end: local.end });
    } else if (this.match("punctuator", "{")) {
      this.consume();
      while (!this.match("punctuator", "}")) {
        const imported = this.parseIdentifier();
        let local = imported;
        if (this.match("keyword", "as")) {
          this.consume();
          local = this.parseIdentifier();
        }
        specifiers.push({
          type: "ImportSpecifier",
          imported,
          local,
          start: imported.start,
          end: local.end
        });
        if (!this.match("punctuator", ",")) break;
        this.consume();
      }
      this.expect("punctuator", "}");
    }

    this.expect("keyword", "from");
    const source = this.parseStringLiteral();
    this.consumeSemicolon();

    return {
      type: "ImportDeclaration",
      specifiers,
      source,
      start: startToken.start,
      end: source.end
    };
  }

  parseExportDeclaration() {
    const startToken = this.expect("keyword", "export");

    if (this.match("keyword", "default")) {
      this.consume();
      const declaration = this.parseExpression();
      this.consumeSemicolon();
      return {
        type: "ExportDefaultDeclaration",
        declaration,
        start: startToken.start,
        end: declaration.end
      };
    }

    if (this.match("keyword", "function")) {
      const declaration = this.parseFunctionDeclaration();
      return {
        type: "ExportNamedDeclaration",
        declaration,
        specifiers: [],
        source: null,
        start: startToken.start,
        end: declaration.end
      };
    }

    if (this.match("keyword", "let") || this.match("keyword", "const") || this.match("keyword", "var")) {
      const declaration = this.parseVariableDeclaration();
      return {
        type: "ExportNamedDeclaration",
        declaration,
        specifiers: [],
        source: null,
        start: startToken.start,
        end: declaration.end
      };
    }

    this.expect("punctuator", "{");
    const specifiers = [];
    while (!this.match("punctuator", "}")) {
      const local = this.parseIdentifier();
      let exported = local;
      if (this.match("keyword", "as")) {
        this.consume();
        exported = this.parseIdentifier();
      }
      specifiers.push({ type: "ExportSpecifier", local, exported, start: local.start, end: exported.end });
      if (!this.match("punctuator", ",")) break;
      this.consume();
    }
    const endToken = this.expect("punctuator", "}");
    this.consumeSemicolon();

    return {
      type: "ExportNamedDeclaration",
      declaration: null,
      specifiers,
      source: null,
      start: startToken.start,
      end: endToken.end
    };
  }

  parseFunctionDeclaration() {
    const startToken = this.expect("keyword", "function");
    const id = this.parseIdentifier();
    this.expect("punctuator", "(");
    const params = [];
    if (!this.match("punctuator", ")")) {
      do {
        params.push(this.parseIdentifier());
        if (!this.match("punctuator", ",")) break;
        this.consume();
      } while (true);
    }
    this.expect("punctuator", ")");
    const body = this.parseBlockStatement();
    return {
      type: "FunctionDeclaration",
      id,
      params,
      body,
      start: startToken.start,
      end: body.end
    };
  }

  parseIfStatement() {
    const startToken = this.expect("keyword", "if");
    this.expect("punctuator", "(");
    const test = this.parseExpression();
    this.expect("punctuator", ")");
    const consequent = this.parseStatement();
    let alternate = null;
    if (this.match("keyword", "else")) {
      this.consume();
      alternate = this.parseStatement();
    }
    return {
      type: "IfStatement",
      test,
      consequent,
      alternate,
      start: startToken.start,
      end: alternate ? alternate.end : consequent.end
    };
  }

  parseWhileStatement() {
    const startToken = this.expect("keyword", "while");
    this.expect("punctuator", "(");
    const test = this.parseExpression();
    this.expect("punctuator", ")");
    const body = this.parseStatement();
    return {
      type: "WhileStatement",
      test,
      body,
      start: startToken.start,
      end: body.end
    };
  }

  parseReturnStatement() {
    const startToken = this.expect("keyword", "return");
    let argument = null;
    if (!this.match("punctuator", ";") && !this.match("punctuator", "}") && !this.match("eof")) {
      argument = this.parseExpression();
    }
    this.consumeSemicolon();
    return {
      type: "ReturnStatement",
      argument,
      start: startToken.start,
      end: argument ? argument.end : startToken.end
    };
  }

  parseBlockStatement() {
    const startToken = this.expect("punctuator", "{");
    const body = [];
    while (!this.match("punctuator", "}")) {
      if (this.match("eof")) throw new SyntaxError("Unterminated block statement.");
      body.push(this.parseStatement());
    }
    const endToken = this.expect("punctuator", "}");
    return {
      type: "BlockStatement",
      body,
      start: startToken.start,
      end: endToken.end
    };
  }

  parseVariableDeclaration() {
    const kindToken = this.expect("keyword");
    const declarations = [];

    do {
      const id = this.parseIdentifier();
      let init = null;
      if (this.match("operator", "=")) {
        this.consume();
        init = this.parseExpression();
      }
      declarations.push({ type: "VariableDeclarator", id, init, start: id.start, end: init ? init.end : id.end });
      if (!this.match("punctuator", ",")) break;
      this.consume();
    } while (true);

    this.consumeSemicolon();

    return {
      type: "VariableDeclaration",
      kind: kindToken.value,
      declarations,
      start: kindToken.start,
      end: declarations[declarations.length - 1].end
    };
  }

  parseExpressionStatement() {
    const expression = this.parseExpression();
    this.consumeSemicolon();
    return {
      type: "ExpressionStatement",
      expression,
      start: expression.start,
      end: expression.end
    };
  }

  parseExpression() {
    return this.parseAssignment();
  }

  parseAssignment() {
    const left = this.parseEquality();
    if (this.match("operator", "=")) {
      const op = this.consume();
      if (left.type !== "Identifier") {
        throw new SyntaxError("Assignment target must be an identifier.");
      }
      const right = this.parseAssignment();
      return {
        type: "AssignmentExpression",
        operator: "=",
        left,
        right,
        start: left.start,
        end: right.end
      };
    }
    return left;
  }

  parseEquality() {
    let node = this.parseComparison();
    while (this.match("operator", "==") || this.match("operator", "!=")) {
      const operator = this.consume();
      const right = this.parseComparison();
      node = {
        type: "BinaryExpression",
        operator: operator.value,
        left: node,
        right,
        start: node.start,
        end: right.end
      };
    }
    return node;
  }

  parseComparison() {
    let node = this.parseAdditive();
    while (
      this.match("operator", "<") ||
      this.match("operator", ">") ||
      this.match("operator", "<=") ||
      this.match("operator", ">=")
    ) {
      const operator = this.consume();
      const right = this.parseAdditive();
      node = {
        type: "BinaryExpression",
        operator: operator.value,
        left: node,
        right,
        start: node.start,
        end: right.end
      };
    }
    return node;
  }

  parseAdditive() {
    let node = this.parseMultiplicative();
    while (this.match("operator", "+") || this.match("operator", "-")) {
      const operator = this.consume();
      const right = this.parseMultiplicative();
      node = {
        type: "BinaryExpression",
        operator: operator.value,
        left: node,
        right,
        start: node.start,
        end: right.end
      };
    }
    return node;
  }

  parseMultiplicative() {
    let node = this.parseUnary();
    while (this.match("operator", "*") || this.match("operator", "/")) {
      const operator = this.consume();
      const right = this.parseUnary();
      node = {
        type: "BinaryExpression",
        operator: operator.value,
        left: node,
        right,
        start: node.start,
        end: right.end
      };
    }
    return node;
  }

  parseUnary() {
    if (this.match("operator", "-") || this.match("operator", "!")) {
      const operator = this.consume();
      const argument = this.parseUnary();
      return {
        type: "UnaryExpression",
        operator: operator.value,
        argument,
        start: operator.start,
        end: argument.end
      };
    }
    return this.parseCallMember();
  }

  parseCallMember() {
    let node = this.parsePrimary();
    while (true) {
      if (this.match("punctuator", ".")) {
        const dot = this.consume();
        const property = this.parseIdentifier();
        node = {
          type: "MemberExpression",
          object: node,
          property,
          start: node.start,
          end: property.end
        };
        continue;
      }

      if (this.match("punctuator", "(")) {
        const openParen = this.consume();
        const args = [];
        if (!this.match("punctuator", ")")) {
          do {
            args.push(this.parseExpression());
            if (!this.match("punctuator", ",")) break;
            this.consume();
          } while (true);
        }
        const closeParen = this.expect("punctuator", ")");
        node = {
          type: "CallExpression",
          callee: node,
          arguments: args,
          start: node.start,
          end: closeParen.end
        };
        if (openParen && closeParen) {
          // no-op to keep lint happy without dependency on formatter
        }
        continue;
      }

      break;
    }

    return node;
  }

  parsePrimary() {
    if (this.match("number")) {
      const token = this.consume();
      return { type: "Literal", value: Number(token.value), start: token.start, end: token.end };
    }

    if (this.match("string")) {
      const token = this.consume();
      return { type: "Literal", value: token.value, start: token.start, end: token.end };
    }

    if (this.match("keyword", "true") || this.match("keyword", "false") || this.match("keyword", "null")) {
      const token = this.consume();
      const value = token.value === "true" ? true : token.value === "false" ? false : null;
      return { type: "Literal", value, start: token.start, end: token.end };
    }

    if (this.match("identifier")) {
      return this.parseIdentifier();
    }

    if (this.match("punctuator", "(")) {
      const open = this.consume();
      const expr = this.parseExpression();
      const close = this.expect("punctuator", ")");
      return {
        ...expr,
        start: open.start,
        end: close.end
      };
    }

    const token = this.current();
    const got = token ? `${token.type}:${token.value}` : "EOF";
    throw new SyntaxError(`Unexpected token ${got} in expression.`);
  }

  parseIdentifier() {
    const token = this.expect("identifier");
    return { type: "Identifier", name: token.value, start: token.start, end: token.end };
  }

  parseStringLiteral() {
    const token = this.expect("string");
    return { type: "Literal", value: token.value, start: token.start, end: token.end };
  }

  consumeSemicolon() {
    if (this.match("punctuator", ";")) {
      this.consume();
    }
  }
}

export function parse(source) {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();
  return { ast, tokens };
}
