const KEYWORDS = new Set(["let", "const", "var"]);
const PUNCTUATORS = new Set([";", ",", "(", ")", "{", "}", "."]);
const SINGLE_CHAR_OPERATORS = new Set(["+", "-", "*", "/", "="]);

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

    if (char === "'" || char === "\"") {
      const quote = char;
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
      tokens.push({ type: "string", value });
      continue;
    }

    if (isDigit(char)) {
      let value = char;
      i += 1;
      while (i < source.length && (isDigit(source[i]) || source[i] === ".")) {
        value += source[i];
        i += 1;
      }
      tokens.push({ type: "number", value });
      continue;
    }

    if (isIdentifierStart(char)) {
      let value = char;
      i += 1;
      while (i < source.length && isIdentifierPart(source[i])) {
        value += source[i];
        i += 1;
      }
      tokens.push({
        type: KEYWORDS.has(value) ? "keyword" : "identifier",
        value
      });
      continue;
    }

    if (PUNCTUATORS.has(char)) {
      tokens.push({ type: "punctuator", value: char });
      i += 1;
      continue;
    }

    if (SINGLE_CHAR_OPERATORS.has(char)) {
      tokens.push({ type: "operator", value: char });
      i += 1;
      continue;
    }

    throw new SyntaxError(`Unexpected character "${char}" at index ${i}.`);
  }

  tokens.push({ type: "eof", value: "<eof>" });
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

  lookahead(offset = 1) {
    return this.tokens[this.cursor + offset];
  }

  consume() {
    const token = this.current();
    this.cursor += 1;
    return token;
  }

  match(type, value = null) {
    const token = this.current();
    if (!token) return false;
    if (token.type !== type) return false;
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
    const body = [];
    while (!this.match("eof")) {
      body.push(this.parseStatement());
    }
    return { type: "Program", body };
  }

  parseStatement() {
    if (this.match("keyword")) {
      return this.parseVariableDeclaration();
    }
    return this.parseExpressionStatement();
  }

  parseVariableDeclaration() {
    const kind = this.expect("keyword").value;
    const id = this.expect("identifier").value;
    let init = null;
    if (this.match("operator", "=")) {
      this.consume();
      init = this.parseExpression();
    }
    this.match("punctuator", ";") && this.consume();
    return {
      type: "VariableDeclaration",
      kind,
      id: { type: "Identifier", name: id },
      init
    };
  }

  parseExpressionStatement() {
    const expression = this.parseExpression();
    this.match("punctuator", ";") && this.consume();
    return { type: "ExpressionStatement", expression };
  }

  parseExpression() {
    return this.parseAssignment();
  }

  parseAssignment() {
    const left = this.parseAdditive();
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
        right
      };
    }
    return left;
  }

  parseAdditive() {
    let node = this.parseMultiplicative();
    while (this.match("operator", "+") || this.match("operator", "-")) {
      const operator = this.consume().value;
      const right = this.parseMultiplicative();
      node = {
        type: "BinaryExpression",
        operator,
        left: node,
        right
      };
    }
    return node;
  }

  parseMultiplicative() {
    let node = this.parseCallMember();
    while (this.match("operator", "*") || this.match("operator", "/")) {
      const operator = this.consume().value;
      const right = this.parseCallMember();
      node = {
        type: "BinaryExpression",
        operator,
        left: node,
        right
      };
    }
    return node;
  }

  parseCallMember() {
    let node = this.parsePrimary();
    while (true) {
      if (this.match("punctuator", ".")) {
        this.consume();
        const property = this.expect("identifier").value;
        node = {
          type: "MemberExpression",
          object: node,
          property: { type: "Identifier", name: property }
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
        this.expect("punctuator", ")");
        node = {
          type: "CallExpression",
          callee: node,
          arguments: args
        };
        continue;
      }

      break;
    }
    return node;
  }

  parsePrimary() {
    if (this.match("number")) {
      return { type: "Literal", value: Number(this.consume().value) };
    }

    if (this.match("string")) {
      return { type: "Literal", value: this.consume().value };
    }

    if (this.match("identifier")) {
      return { type: "Identifier", name: this.consume().value };
    }

    if (this.match("punctuator", "(")) {
      this.consume();
      const expr = this.parseExpression();
      this.expect("punctuator", ")");
      return expr;
    }

    const token = this.current();
    const got = token ? `${token.type}:${token.value}` : "EOF";
    throw new SyntaxError(`Unexpected token ${got} in expression.`);
  }
}

export function parse(source) {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();
  return { ast, tokens };
}
