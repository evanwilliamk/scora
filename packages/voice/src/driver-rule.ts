// Safe evaluator for pattern `driver_rule` predicates (doc 06 §3).
//
// Grammar (precedence low -> high):
//   OR                                  race_in_next_7d = true OR hrv_7d_avg_delta < -5
//   AND                                 acwr > 1.2 AND sleep_7d_avg_delta < -3
//   comparison  = == != > >= < <=       consecutive_hard_days = 0
//   IS [NOT] NULL   (postfix)           coach_note_this_week IS NOT NULL
//   + -                                 load_28d / 4
//   * /                                 (load_28d / 4) * 0.85
//   unary -                             < -3
//   primary   number | true | false | identifier | ( expr )
//
// Deliberately NO eval()/Function — a hand-rolled parser so a malformed rule is
// a load-time error, never arbitrary code. Missing drivers make a comparison
// false (you can't satisfy a rule about data you don't have), which is what
// min_data_completeness and the driver-existence rule (§3.2) both want.

import type { DriverRecord, DriverValue } from './types';

// ---- tokenizer ----------------------------------------------------------

type TokKind =
  | 'num' | 'ident' | 'bool'
  | 'op' | 'lparen' | 'rparen'
  | 'and' | 'or' | 'is' | 'not' | 'null';

interface Token {
  kind: TokKind;
  value: string;
  pos: number;
}

const KEYWORDS: Record<string, TokKind> = {
  and: 'and', or: 'or', is: 'is', not: 'not', null: 'null',
  true: 'bool', false: 'bool',
};

const TWO_CHAR_OPS = new Set(['>=', '<=', '==', '!=']);
const ONE_CHAR_OPS = new Set(['>', '<', '=', '+', '-', '*', '/']);

function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }

    if (c === '(') { toks.push({ kind: 'lparen', value: c, pos: i }); i++; continue; }
    if (c === ')') { toks.push({ kind: 'rparen', value: c, pos: i }); i++; continue; }

    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) { toks.push({ kind: 'op', value: two, pos: i }); i += 2; continue; }
    if (ONE_CHAR_OPS.has(c)) { toks.push({ kind: 'op', value: c, pos: i }); i++; continue; }

    // number
    const num = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (num) { toks.push({ kind: 'num', value: num[0], pos: i }); i += num[0].length; continue; }

    // identifier / keyword (snake_case, dots allowed for scheduled_workout.*)
    const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (id) {
      const lower = id[0].toLowerCase();
      const kw = KEYWORDS[lower];
      toks.push({ kind: kw ?? 'ident', value: kw ? lower : id[0], pos: i });
      i += id[0].length;
      continue;
    }

    throw new DriverRuleError(`unexpected character ${JSON.stringify(c)} at ${i}`, src);
  }
  return toks;
}

// ---- AST ----------------------------------------------------------------

type Node =
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'ident'; name: string }
  | { t: 'neg'; x: Node }
  | { t: 'bin'; op: string; l: Node; r: Node }
  | { t: 'isnull'; x: Node; negated: boolean };

export class DriverRuleError extends Error {
  constructor(message: string, public rule: string) {
    super(`driver_rule: ${message} — in ${JSON.stringify(rule)}`);
    this.name = 'DriverRuleError';
  }
}

// left binding power; higher binds tighter
function lbp(tok: Token): number {
  if (tok.kind === 'or') return 1;
  if (tok.kind === 'and') return 2;
  if (tok.kind === 'is') return 3;
  if (tok.kind === 'op') {
    if (['=', '==', '!=', '>', '>=', '<', '<='].includes(tok.value)) return 3;
    if (['+', '-'].includes(tok.value)) return 4;
    if (['*', '/'].includes(tok.value)) return 5;
  }
  return 0;
}

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (kind: TokKind) => {
    const t = toks[p];
    if (!t || t.kind !== kind) throw new DriverRuleError(`expected ${kind}`, src);
    return next();
  };

  function unary(): Node {
    const t = peek();
    if (t && t.kind === 'op' && t.value === '-') {
      next();
      return { t: 'neg', x: unary() };
    }
    return primary();
  }

  function primary(): Node {
    const t = next();
    if (!t) throw new DriverRuleError('unexpected end of rule', src);
    if (t.kind === 'lparen') {
      const e = expr(0);
      expect('rparen');
      return e;
    }
    if (t.kind === 'num') return { t: 'num', v: parseFloat(t.value) };
    if (t.kind === 'bool') return { t: 'bool', v: t.value === 'true' };
    if (t.kind === 'ident') return { t: 'ident', name: t.value };
    throw new DriverRuleError(`unexpected token ${JSON.stringify(t.value)}`, src);
  }

  function expr(minBp: number): Node {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t) break;
      const bp = lbp(t);
      if (bp === 0 || bp < minBp) break;

      if (t.kind === 'is') {
        next();
        let negated = false;
        if (peek()?.kind === 'not') { next(); negated = true; }
        expect('null');
        left = { t: 'isnull', x: left, negated };
        continue;
      }

      const op = next().value;
      const right = expr(bp + 1); // left-associative
      left = { t: 'bin', op, l: left, r: right };
    }
    return left;
  }

  const ast = expr(0);
  if (p < toks.length) {
    throw new DriverRuleError(`unexpected trailing token ${JSON.stringify(toks[p].value)}`, src);
  }
  return ast;
}

// ---- evaluation ---------------------------------------------------------

// null = missing/unknown driver; propagates so comparisons on it read false.
type Val = number | boolean | null;

const asNum = (v: Val): number | null => (typeof v === 'number' ? v : null);
const truthy = (v: Val): boolean => v === true;

function toVal(dv: DriverValue): Val {
  if (dv === null || dv === undefined) return null;
  if (typeof dv === 'number') return Number.isFinite(dv) ? dv : null;
  if (typeof dv === 'boolean') return dv;
  return null; // strings aren't comparable in numeric/boolean predicates
}

// Single evaluator. AND/OR short-circuit and coerce to boolean; arithmetic
// yields numbers; comparisons yield booleans; a missing driver (null) makes any
// comparison touching it false. All recursion goes through here, so a logical
// group nested anywhere still evaluates correctly.
function evalNode(n: Node, rec: DriverRecord): Val {
  switch (n.t) {
    case 'num': return n.v;
    case 'bool': return n.v;
    case 'ident': return toVal(rec[n.name]);
    case 'neg': {
      const x = asNum(evalNode(n.x, rec));
      return x === null ? null : -x;
    }
    case 'isnull': {
      // Presence is about the RAW driver (a string counts as present), not the
      // numeric-coerced value — so IS NOT NULL works for string drivers too.
      const present = n.x.t === 'ident'
        ? rec[n.x.name] !== null && rec[n.x.name] !== undefined
        : evalNode(n.x, rec) !== null;
      return n.negated ? present : !present;
    }
    case 'bin': {
      const op = n.op;

      // Logical — short-circuit, boolean-coerced.
      if (op === 'and') return truthy(evalNode(n.l, rec)) && truthy(evalNode(n.r, rec));
      if (op === 'or') return truthy(evalNode(n.l, rec)) || truthy(evalNode(n.r, rec));

      // Arithmetic.
      if (op === '+' || op === '-' || op === '*' || op === '/') {
        const a = asNum(evalNode(n.l, rec));
        const b = asNum(evalNode(n.r, rec));
        if (a === null || b === null) return null;
        if (op === '+') return a + b;
        if (op === '-') return a - b;
        if (op === '*') return a * b;
        return b === 0 ? null : a / b;
      }

      // Equality — across numbers or booleans; missing operand => not equal.
      if (op === '=' || op === '==' || op === '!=') {
        const l = evalNode(n.l, rec);
        const r = evalNode(n.r, rec);
        if (l === null || r === null) return false;
        return op === '!=' ? l !== r : l === r;
      }

      // Ordered comparisons — numeric only, missing => false.
      const a = asNum(evalNode(n.l, rec));
      const b = asNum(evalNode(n.r, rec));
      if (a === null || b === null) return false;
      if (op === '>') return a > b;
      if (op === '>=') return a >= b;
      if (op === '<') return a < b;
      if (op === '<=') return a <= b;
      return null;
    }
  }
}

export interface CompiledRule {
  source: string;
  evaluate(rec: DriverRecord): boolean;
}

// Parse a rule once; throws DriverRuleError on bad syntax so the loader can
// reject a malformed entry at boot.
export function compileDriverRule(rule: string): CompiledRule {
  const ast = parse(rule);
  return {
    source: rule,
    evaluate: (rec: DriverRecord) => truthy(evalNode(ast, rec)),
  };
}

// Convenience one-shot (compiles every call — prefer compileDriverRule in hot paths).
export function evaluateDriverRule(rule: string, rec: DriverRecord): boolean {
  return compileDriverRule(rule).evaluate(rec);
}
