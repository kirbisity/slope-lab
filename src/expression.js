// Parses y = f(x) into a callable function. Recursive descent with the usual
// precedence, implicit multiplication (2x, 3(x+1), 2sin(x)) and right-
// associative powers, so "-x^2" means -(x²) as it does on paper.

const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  // The original game used log for the natural logarithm; keep that meaning.
  log: Math.log, ln: Math.log, log10: Math.log10,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
};

const CONSTANTS = { pi: Math.PI, e: Math.E };

export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

export class ExpressionError extends Error {
  constructor(message, position) {
    super(message);
    this.position = position;
  }
}

/** Normalise typographic input: unicode minus, ×, ÷, π, superscripts. */
export function normaliseEquation(text) {
  return String(text)
    .replace(/[−–—]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/X/g, 'x')
    .trim();
}

/** Strip an optional leading "y =" and return the right-hand side. */
export function rightHandSide(text) {
  const normalised = normaliseEquation(text);
  const parts = normalised.split('=');
  if (parts.length > 2) throw new ExpressionError('Use a single "=" sign, as in y = 0.5x', normalised.indexOf('=', normalised.indexOf('=') + 1));
  if (parts.length === 2) {
    if (!/^\s*y\s*$/i.test(parts[0])) throw new ExpressionError('The left side should be y, as in y = 0.5x', 0);
    return parts[1];
  }
  return parts[0];
}

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) { index += 1; continue; }
    const numberMatch = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(source.slice(index));
    if (numberMatch && /[\d.]/.test(character)) {
      tokens.push({ type: 'number', value: parseFloat(numberMatch[0]), position: index });
      index += numberMatch[0].length;
      continue;
    }
    const wordMatch = /^[a-z][a-z0-9]*/i.exec(source.slice(index));
    if (wordMatch) {
      splitWord(wordMatch[0].toLowerCase(), index, tokens);
      index += wordMatch[0].length;
      continue;
    }
    if ('+-*/^(),'.includes(character)) {
      tokens.push({ type: character, position: index });
      index += 1;
      continue;
    }
    throw new ExpressionError(`"${character}" is not something Slope Lab can calculate`, index);
  }
  tokens.push({ type: 'end', position: source.length });
  return tokens;
}

// Split "xsin" or "pix" into known names so 2xsin(x) and pix read naturally.
function splitWord(word, position, tokens) {
  let rest = word;
  let offset = position;
  while (rest.length > 0) {
    const name = longestKnownPrefix(rest);
    if (!name) throw new ExpressionError(`Unknown name "${rest}". Try x, pi, e or ${FUNCTION_NAMES.slice(0, 6).join(', ')}…`, offset);
    tokens.push({ type: 'name', value: name, position: offset });
    rest = rest.slice(name.length);
    offset += name.length;
  }
}

function longestKnownPrefix(word) {
  const candidates = ['x', ...Object.keys(CONSTANTS), ...FUNCTION_NAMES];
  let best = null;
  for (const candidate of candidates) {
    if (word.startsWith(candidate) && (!best || candidate.length > best.length)) best = candidate;
  }
  return best;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  peek() { return this.tokens[this.index]; }

  take(type) {
    const token = this.peek();
    if (token.type !== type) {
      const found = token.type === 'end' ? 'the end' : `"${token.value ?? token.type}"`;
      throw new ExpressionError(`Expected "${type}" but found ${found}`, token.position);
    }
    this.index += 1;
    return token;
  }

  parseExpression() {
    let node = this.parseTerm();
    while (this.peek().type === '+' || this.peek().type === '-') {
      const operator = this.take(this.peek().type).type;
      node = { kind: 'binary', operator, left: node, right: this.parseTerm() };
    }
    return node;
  }

  parseTerm() {
    let node = this.parseUnary();
    for (;;) {
      const type = this.peek().type;
      if (type === '*' || type === '/') {
        this.index += 1;
        node = { kind: 'binary', operator: type, left: node, right: this.parseUnary() };
      } else if (type === 'number' || type === 'name' || type === '(') {
        node = { kind: 'binary', operator: '*', left: node, right: this.parsePower() };
      } else {
        return node;
      }
    }
  }

  parseUnary() {
    if (this.peek().type === '-') {
      this.index += 1;
      return { kind: 'negate', operand: this.parseUnary() };
    }
    if (this.peek().type === '+') {
      this.index += 1;
      return this.parseUnary();
    }
    return this.parsePower();
  }

  parsePower() {
    const base = this.parsePrimary();
    if (this.peek().type === '^') {
      this.index += 1;
      return { kind: 'binary', operator: '^', left: base, right: this.parseUnary() };
    }
    return base;
  }

  parsePrimary() {
    const token = this.peek();
    if (token.type === 'number') {
      this.index += 1;
      return { kind: 'number', value: token.value };
    }
    if (token.type === '(') {
      this.index += 1;
      const inner = this.parseExpression();
      this.take(')');
      return inner;
    }
    if (token.type === 'name') {
      this.index += 1;
      if (token.value === 'x') return { kind: 'x' };
      if (token.value in CONSTANTS) return { kind: 'number', value: CONSTANTS[token.value] };
      // "sin x" and "sin 2x" read as sin(x) and sin(2x) only up to a power.
      const argument = this.peek().type === '(' ? this.parsePrimary() : this.parsePower();
      return { kind: 'call', name: token.value, argument };
    }
    if (token.type === 'end') throw new ExpressionError('The equation ends too early', token.position);
    throw new ExpressionError(`Unexpected "${token.type}"`, token.position);
  }
}

function compileNode(node) {
  switch (node.kind) {
    case 'number': { const value = node.value; return () => value; }
    case 'x': return (x) => x;
    case 'negate': { const operand = compileNode(node.operand); return (x) => -operand(x); }
    case 'call': {
      const fn = FUNCTIONS[node.name];
      const argument = compileNode(node.argument);
      return (x) => fn(argument(x));
    }
    case 'binary': {
      const left = compileNode(node.left);
      const right = compileNode(node.right);
      switch (node.operator) {
        case '+': return (x) => left(x) + right(x);
        case '-': return (x) => left(x) - right(x);
        case '*': return (x) => left(x) * right(x);
        case '/': return (x) => left(x) / right(x);
        case '^': return (x) => Math.pow(left(x), right(x));
      }
    }
  }
  throw new ExpressionError('Could not understand the equation', 0);
}

/**
 * Compile an equation such as "y = 0.05(x+5)^2" into f(x).
 * Throws ExpressionError with a character position on bad input.
 */
export function compileEquation(text) {
  const source = rightHandSide(text);
  if (!source.trim()) throw new ExpressionError('Type an expression in x, for example y = -0.5x', 0);
  const parser = new Parser(tokenize(source));
  const tree = parser.parseExpression();
  if (parser.peek().type !== 'end') {
    const token = parser.peek();
    throw new ExpressionError(`Unexpected "${token.value ?? token.type}"`, token.position);
  }
  return compileNode(tree);
}

/** Return an error message for the equation, or '' when it is valid. */
export function describeEquationError(text) {
  try {
    compileEquation(text);
    return '';
  } catch (error) {
    return error.message;
  }
}
