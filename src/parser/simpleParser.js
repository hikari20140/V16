const KEYWORDS = new Set([
  "let",
  "const",
  "var",
  "if",
  "else",
  "while",
  "for",
  "break",
  "continue",
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
const DOUBLE_CHAR_OPERATORS = new Set(["==", "!=", "<=", ">=", "=>", "&&", "||"]);

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

    if (char === "`") {
      const start = i;
      i += 1;
      let value = "";

      while (i < source.length) {
        const current = source[i];
        if (current === "\\") {
          if (i + 1 >= source.length) {
            throw new SyntaxError("Unterminated template literal.");
          }
          value += source[i];
          value += source[i + 1];
          i += 2;
          continue;
        }

        if (current === "`") {
          i += 1;
          tokens.push({ type: "template", value, start, end: i });
          break;
        }

        value += current;
        i += 1;
      }

      if (i >= source.length && source[source.length - 1] !== "`") {
        throw new SyntaxError("Unterminated template literal.");
      }
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

  tokenAt(offset = 0) {
    return this.tokens[this.cursor + offset];
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
    if (this.match("keyword", "for")) return this.parseForStatement();
    if (this.match("keyword", "break")) return this.parseBreakStatement();
    if (this.match("keyword", "continue")) return this.parseContinueStatement();
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
    const { params, end } = this.parseFunctionSignature();
    const body = this.parseBlockStatement();
    return {
      type: "FunctionDeclaration",
      id,
      params,
      body,
      start: startToken.start,
      end: body.end || end
    };
  }

  parseFunctionExpression() {
    const startToken = this.expect("keyword", "function");
    const id = this.match("identifier") ? this.parseIdentifier() : null;
    const { params, end } = this.parseFunctionSignature();
    const body = this.parseBlockStatement();
    return {
      type: "FunctionExpression",
      id,
      params,
      body,
      start: startToken.start,
      end: body.end || end
    };
  }

  parseFunctionSignature() {
    this.expect("punctuator", "(");
    const params = [];
    if (!this.match("punctuator", ")")) {
      do {
        params.push(this.parseIdentifier());
        if (!this.match("punctuator", ",")) break;
        this.consume();
      } while (true);
    }
    const closeToken = this.expect("punctuator", ")");
    return { params, end: closeToken.end };
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

  parseForStatement() {
    const startToken = this.expect("keyword", "for");
    this.expect("punctuator", "(");

    let init = null;
    if (!this.match("punctuator", ";")) {
      if (this.match("keyword", "let") || this.match("keyword", "const") || this.match("keyword", "var")) {
        init = this.parseVariableDeclaration(false);
      } else {
        init = this.parseExpression();
      }
    }
    this.expect("punctuator", ";");

    let test = null;
    if (!this.match("punctuator", ";")) {
      test = this.parseExpression();
    }
    this.expect("punctuator", ";");

    let update = null;
    if (!this.match("punctuator", ")")) {
      update = this.parseExpression();
    }
    this.expect("punctuator", ")");

    const body = this.parseStatement();

    return {
      type: "ForStatement",
      init,
      test,
      update,
      body,
      start: startToken.start,
      end: body.end
    };
  }

  parseBreakStatement() {
    const token = this.expect("keyword", "break");
    this.consumeSemicolon();
    return {
      type: "BreakStatement",
      start: token.start,
      end: token.end
    };
  }

  parseContinueStatement() {
    const token = this.expect("keyword", "continue");
    this.consumeSemicolon();
    return {
      type: "ContinueStatement",
      start: token.start,
      end: token.end
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

  parseVariableDeclaration(consumeSemicolon = true) {
    const kindToken = this.expect("keyword");
    const declarations = [];

    do {
      const id = this.parseIdentifier();
      let init = null;
      if (this.match("operator", "=")) {
        this.consume();
        init = this.parseExpression();
      }
      declarations.push({
        type: "VariableDeclarator",
        id,
        init,
        start: id.start,
        end: init ? init.end : id.end
      });
      if (!this.match("punctuator", ",")) break;
      this.consume();
    } while (true);

    if (consumeSemicolon) {
      this.consumeSemicolon();
    }

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
    if (this.isArrowFunctionStart()) {
      return this.parseArrowFunctionExpression();
    }

    const left = this.parseLogicalOr();
    if (this.match("operator", "=")) {
      this.consume();
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

  parseArrowFunctionExpression() {
    const params = [];
    let start;

    if (this.match("identifier") && this.tokenAt(1)?.type === "operator" && this.tokenAt(1)?.value === "=>") {
      const identifier = this.parseIdentifier();
      params.push(identifier);
      start = identifier.start;
    } else {
      const open = this.expect("punctuator", "(");
      start = open.start;
      if (!this.match("punctuator", ")")) {
        do {
          params.push(this.parseIdentifier());
          if (!this.match("punctuator", ",")) break;
          this.consume();
        } while (true);
      }
      this.expect("punctuator", ")");
    }

    this.expect("operator", "=>");

    let body;
    let expression = false;
    if (this.match("punctuator", "{")) {
      body = this.parseBlockStatement();
    } else {
      body = this.parseAssignment();
      expression = true;
    }

    return {
      type: "ArrowFunctionExpression",
      params,
      body,
      expression,
      start,
      end: body.end
    };
  }

  isArrowFunctionStart() {
    if (this.match("identifier")) {
      const next = this.tokenAt(1);
      return next?.type === "operator" && next.value === "=>";
    }

    if (!this.match("punctuator", "(")) {
      return false;
    }

    let depth = 0;
    let i = this.cursor;
    let validParams = true;

    while (i < this.tokens.length) {
      const token = this.tokens[i];

      if (token.type === "punctuator" && token.value === "(") {
        depth += 1;
        i += 1;
        continue;
      }

      if (token.type === "punctuator" && token.value === ")") {
        depth -= 1;
        i += 1;
        if (depth === 0) break;
        continue;
      }

      if (depth > 1) {
        validParams = false;
        break;
      }

      if (depth === 1) {
        const isAllowed =
          token.type === "identifier" ||
          (token.type === "punctuator" && token.value === ",");
        if (!isAllowed) {
          validParams = false;
          break;
        }
      }

      i += 1;
    }

    if (!validParams || depth !== 0) {
      return false;
    }

    const next = this.tokens[i];
    return next?.type === "operator" && next.value === "=>";
  }

  parseLogicalOr() {
    let node = this.parseLogicalAnd();
    while (this.match("operator", "||")) {
      const op = this.consume();
      const right = this.parseLogicalAnd();
      node = {
        type: "LogicalExpression",
        operator: op.value,
        left: node,
        right,
        start: node.start,
        end: right.end
      };
    }
    return node;
  }

  parseLogicalAnd() {
    let node = this.parseEquality();
    while (this.match("operator", "&&")) {
      const op = this.consume();
      const right = this.parseEquality();
      node = {
        type: "LogicalExpression",
        operator: op.value,
        left: node,
        right,
        start: node.start,
        end: right.end
      };
    }
    return node;
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
        this.consume();
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
        this.consume();
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

    if (this.match("template")) {
      const token = this.consume();
      return this.parseTemplateLiteral(token);
    }

    if (this.match("keyword", "true") || this.match("keyword", "false") || this.match("keyword", "null")) {
      const token = this.consume();
      const value = token.value === "true" ? true : token.value === "false" ? false : null;
      return { type: "Literal", value, start: token.start, end: token.end };
    }

    if (this.match("keyword", "function")) {
      return this.parseFunctionExpression();
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

  parseTemplateLiteral(token) {
    const parts = splitTemplateLiteralParts(token.value);
    const expressions = parts.expressions.map((source) => parseTemplateExpressionSource(source));
    return {
      type: "TemplateLiteral",
      quasis: parts.quasis.map((value) => ({ type: "Literal", value })),
      expressions,
      start: token.start,
      end: token.end
    };
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

function parseTemplateExpressionSource(source) {
  const exprSource = source.trim();
  if (exprSource.length === 0) {
    throw new SyntaxError("Template interpolation cannot be empty.");
  }
  const parser = new Parser(tokenize(exprSource));
  const expression = parser.parseExpression();
  if (!parser.match("eof")) {
    const token = parser.current();
    throw new SyntaxError(`Unexpected token in template expression: ${token.type}:${token.value}`);
  }
  return expression;
}

function splitTemplateLiteralParts(raw) {
  const quasis = [];
  const expressions = [];
  let current = "";
  let i = 0;

  while (i < raw.length) {
    const char = raw[i];

    if (char === "\\") {
      if (i + 1 < raw.length) {
        current += raw[i + 1];
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (char === "$" && raw[i + 1] === "{") {
      quasis.push(current);
      current = "";
      i += 2;
      const { expressionSource, nextIndex } = readTemplateExpression(raw, i);
      expressions.push(expressionSource);
      i = nextIndex;
      continue;
    }

    current += char;
    i += 1;
  }

  quasis.push(current);
  return { quasis, expressions };
}

function readTemplateExpression(raw, startIndex) {
  let i = startIndex;
  let depth = 1;
  let quote = null;

  while (i < raw.length) {
    const char = raw[i];

    if (quote) {
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      i += 1;
      continue;
    }

    if (char === "{") {
      depth += 1;
      i += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          expressionSource: raw.slice(startIndex, i),
          nextIndex: i + 1
        };
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  throw new SyntaxError("Unterminated template interpolation.");
}
