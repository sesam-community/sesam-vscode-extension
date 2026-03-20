/**
 * DTL Evaluator — client-side mini-interpreter
 * Evaluates a subset of DTL transforms against a given input entity.
 * Unsupported functions (hops, encryption, etc.) are flagged as unsupported.
 *
 * Supported transforms: add, add-if, copy, remove, rename, default, filter, discard, comment, if
 * Supported expressions: concat, upper, lower, strip, replace, split, join, substring, length,
 *   string, integer, float, concat, if, if-null, coalesce, eq, neq, gt, gte, lt, lte,
 *   and, or, not, is-null, is-not-null, map, list, first, last, count, in,
 *   +, -, *, /, %, abs, round, floor, ceil, min, max, sum
 */

export interface DtlObject {
  [key: string]: DtlValue;
}
export type DtlValue =
  | string
  | number
  | boolean
  | null
  | DtlValue[]
  | DtlObject;

export interface EvalEntity extends DtlObject {}

export type EvalStatus = "ok" | "discarded" | "error";

export interface EvalResult {
  status: EvalStatus;
  output: EvalEntity;
  warnings: string[];
}

interface EvalContext {
  source: EvalEntity;
  target: EvalEntity;
  current?: DtlValue; // _
  parent?: EvalEntity; // _P
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function evaluate(
  rules: unknown[],
  inputEntity: EvalEntity,
): EvalResult {
  const ctx: EvalContext = {
    source: inputEntity,
    target: {},
    warnings: [],
  };

  try {
    for (const rule of rules) {
      const result = applyTransform(rule, ctx);
      if (result === "discard") {
        return { status: "discarded", output: {}, warnings: ctx.warnings };
      }
    }
  } catch (err) {
    return {
      status: "error",
      output: ctx.target,
      warnings: [...ctx.warnings, String(err)],
    };
  }

  return { status: "ok", output: ctx.target, warnings: ctx.warnings };
}

// ---------------------------------------------------------------------------
// Transform dispatch
// ---------------------------------------------------------------------------

function applyTransform(rule: unknown, ctx: EvalContext): "discard" | void {
  if (!Array.isArray(rule) || rule.length === 0) return;

  const name = rule[0];
  if (typeof name !== "string") return;

  const args = rule.slice(1);

  switch (name) {
    case "comment":
      return; // no-op

    case "add": {
      const [prop, val] = args;
      if (typeof prop === "string") {
        ctx.target[prop] = evalExpr(val, ctx);
      }
      return;
    }

    case "add-if": {
      const [prop, val] = args;
      if (typeof prop === "string") {
        const v = evalExpr(val, ctx);
        if (v !== null && v !== false && v !== undefined) {
          ctx.target[prop] = v;
        }
      }
      return;
    }

    case "copy": {
      const [pattern] = args;
      if (pattern === "*" || pattern === undefined) {
        Object.assign(ctx.target, ctx.source);
      } else if (typeof pattern === "string") {
        if (pattern in ctx.source) {
          ctx.target[pattern] = ctx.source[pattern];
        }
      }
      return;
    }

    case "remove": {
      const [pattern] = args;
      if (pattern === "*") {
        for (const k of Object.keys(ctx.target)) delete ctx.target[k];
      } else if (typeof pattern === "string") {
        delete ctx.target[pattern];
      }
      return;
    }

    case "rename": {
      const [newName, oldExpr] = args;
      if (typeof newName === "string") {
        ctx.target[newName] = evalExpr(oldExpr, ctx);
      }
      return;
    }

    case "default": {
      const [prop, val] = args;
      if (typeof prop === "string" && !(prop in ctx.target)) {
        ctx.target[prop] = evalExpr(val, ctx);
      }
      return;
    }

    case "filter": {
      const condition = evalExpr(args[0], ctx);
      if (!condition) return "discard";
      return;
    }

    case "discard":
      return "discard";

    case "if": {
      const [cond, thenRule, elseRule] = args;
      const condResult = evalExpr(cond, ctx);
      if (condResult) {
        return applyTransform(thenRule, ctx);
      } else if (elseRule !== undefined) {
        return applyTransform(elseRule, ctx);
      }
      return;
    }

    case "case": {
      // ["case", cond1, transform1, cond2, transform2, ..., defaultTransform?]
      for (let i = 0; i < args.length - 1; i += 2) {
        const cond = args[i];
        const transform = args[i + 1];
        if (evalExpr(cond, ctx)) {
          return applyTransform(transform, ctx);
        }
      }
      // Default (odd number of remaining args)
      if (args.length % 2 === 1) {
        return applyTransform(args[args.length - 1], ctx);
      }
      return;
    }

    case "case-eq": {
      // ["case-eq", value, match1, transform1, ..., defaultTransform?]
      const matchValue = evalExpr(args[0], ctx);
      const rest = args.slice(1);
      for (let i = 0; i < rest.length - 1; i += 2) {
        if (matchValue === rest[i]) {
          return applyTransform(rest[i + 1], ctx);
        }
      }
      if (rest.length % 2 === 1) {
        return applyTransform(rest[rest.length - 1], ctx);
      }
      return;
    }

    case "merge": {
      const dict = evalExpr(args[0], ctx);
      if (dict && typeof dict === "object" && !Array.isArray(dict)) {
        Object.assign(ctx.target, dict);
      }
      return;
    }

    case "merge-union": {
      const dict = evalExpr(args[0], ctx);
      if (dict && typeof dict === "object" && !Array.isArray(dict)) {
        for (const [k, v] of Object.entries(dict)) {
          if (
            k in ctx.target &&
            Array.isArray(ctx.target[k]) &&
            Array.isArray(v)
          ) {
            ctx.target[k] = [
              ...new Set([...(ctx.target[k] as DtlValue[]), ...v]),
            ];
          } else {
            ctx.target[k] = v as DtlValue;
          }
        }
      }
      return;
    }

    default: {
      ctx.warnings.push(
        `Unsupported transform "${name}" — skipped (may require live node).`,
      );
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Expression evaluator
// ---------------------------------------------------------------------------

function evalExpr(expr: unknown, ctx: EvalContext): DtlValue {
  // Literal values
  if (expr === null || typeof expr === "boolean" || typeof expr === "number") {
    return expr as DtlValue;
  }

  // String — could be a variable reference or literal
  if (typeof expr === "string") {
    return evalStringExpr(expr, ctx);
  }

  // Array — a DTL function call
  if (Array.isArray(expr)) {
    return evalFunction(expr, ctx);
  }

  // Dict — return as-is (with values recursively evaluated)
  if (typeof expr === "object" && expr !== null) {
    const result: Record<string, DtlValue> = {};
    for (const [k, v] of Object.entries(expr as Record<string, unknown>)) {
      result[k] = evalExpr(v, ctx);
    }
    return result;
  }

  return null;
}

function evalStringExpr(str: string, ctx: EvalContext): DtlValue {
  // _S.property or _S (whole source entity)
  if (str === "_S") return ctx.source as unknown as DtlValue;
  if (str.startsWith("_S.")) {
    return getProp(ctx.source, str.slice(3));
  }
  // _T.property
  if (str === "_T") return ctx.target as unknown as DtlValue;
  if (str.startsWith("_T.")) {
    return getProp(ctx.target, str.slice(3));
  }
  // _P — parent (not supported in preview)
  if (str === "_P" || str.startsWith("_P.")) {
    return getProp(
      ctx.parent ?? ({} as EvalEntity),
      str.startsWith("_P.") ? str.slice(3) : "",
    );
  }
  // _ — current value
  if (str === "_") return ctx.current ?? null;

  // Literal string
  return str;
}

function getProp(
  entity: EvalEntity | Record<string, DtlValue>,
  path: string,
): DtlValue {
  const parts = path.split(".");
  let current: DtlValue = entity as unknown as DtlValue;
  for (const part of parts) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    )
      return null;
    current = (current as Record<string, DtlValue>)[part] ?? null;
  }
  return current;
}

function evalFunction(arr: unknown[], ctx: EvalContext): DtlValue {
  if (arr.length === 0) return null;
  const name = arr[0];
  if (typeof name !== "string") return null;
  const args = arr.slice(1);

  switch (name) {
    // ── Strings
    case "concat":
      return args.map((a) => String(evalExpr(a, ctx) ?? "")).join("");
    case "upper":
      return String(evalExpr(args[0], ctx) ?? "").toUpperCase();
    case "lower":
      return String(evalExpr(args[0], ctx) ?? "").toLowerCase();
    case "strip":
      return String(evalExpr(args[0], ctx) ?? "").trim();
    case "lstrip":
      return String(evalExpr(args[0], ctx) ?? "").trimStart();
    case "rstrip":
      return String(evalExpr(args[0], ctx) ?? "").trimEnd();
    case "length": {
      const v = evalExpr(args[0], ctx);
      return typeof v === "string"
        ? v.length
        : Array.isArray(v)
          ? v.length
          : null;
    }
    case "replace": {
      const [s, r, str] = args.map((a) => String(evalExpr(a, ctx) ?? ""));
      return str.split(s).join(r);
    }
    case "substring": {
      const s = String(evalExpr(args[0], ctx) ?? "");
      const start = Number(evalExpr(args[1], ctx) ?? 0);
      const end =
        args[2] !== undefined ? Number(evalExpr(args[2], ctx)) : undefined;
      return s.slice(start, end);
    }
    case "split": {
      const [sep, str] = args.map((a) => String(evalExpr(a, ctx) ?? ""));
      return str.split(sep);
    }
    case "join": {
      const sep = String(evalExpr(args[0], ctx) ?? "");
      const list = evalExpr(args[1], ctx);
      if (!Array.isArray(list)) return null;
      return list.map((v) => String(v ?? "")).join(sep);
    }
    case "string":
      return String(evalExpr(args[0], ctx) ?? "");
    case "is-string":
      return typeof evalExpr(args[0], ctx) === "string";
    case "matches": {
      const pattern = String(evalExpr(args[0], ctx) ?? "");
      const str = String(evalExpr(args[1], ctx) ?? "");
      try {
        return new RegExp(pattern).test(str);
      } catch {
        return false;
      }
    }
    case "ljust": {
      const s = String(evalExpr(args[0], ctx) ?? "");
      const w = Number(evalExpr(args[1], ctx) ?? 0);
      const fill = String(evalExpr(args[2], ctx) ?? " ");
      return s.padEnd(w, fill);
    }
    case "rjust": {
      const s = String(evalExpr(args[0], ctx) ?? "");
      const w = Number(evalExpr(args[1], ctx) ?? 0);
      const fill = String(evalExpr(args[2], ctx) ?? " ");
      return s.padStart(w, fill);
    }

    // ── Comparisons
    case "eq":
      return evalExpr(args[0], ctx) === evalExpr(args[1], ctx);
    case "neq":
      return evalExpr(args[0], ctx) !== evalExpr(args[1], ctx);
    case "gt":
      return (
        (evalExpr(args[0], ctx) as number) > (evalExpr(args[1], ctx) as number)
      );
    case "gte":
      return (
        (evalExpr(args[0], ctx) as number) >= (evalExpr(args[1], ctx) as number)
      );
    case "lt":
      return (
        (evalExpr(args[0], ctx) as number) < (evalExpr(args[1], ctx) as number)
      );
    case "lte":
      return (
        (evalExpr(args[0], ctx) as number) <= (evalExpr(args[1], ctx) as number)
      );

    // ── Boolean logic
    case "and":
      return args.every((a) => Boolean(evalExpr(a, ctx)));
    case "or":
      return args.some((a) => Boolean(evalExpr(a, ctx)));
    case "not":
      return !evalExpr(args[0], ctx);
    case "all": {
      const list = evalExpr(args[0], ctx);
      if (!Array.isArray(list)) return false;
      return list.every((item) =>
        Boolean(evalExpr(args[1], { ...ctx, current: item as DtlValue })),
      );
    }
    case "any": {
      const list = evalExpr(args[0], ctx);
      if (!Array.isArray(list)) return false;
      return list.some((item) =>
        Boolean(evalExpr(args[1], { ...ctx, current: item as DtlValue })),
      );
    }

    // ── Conditionals / Nulls
    case "if": {
      const cond = evalExpr(args[0], ctx);
      return cond
        ? evalExpr(args[1], ctx)
        : args[2] !== undefined
          ? evalExpr(args[2], ctx)
          : null;
    }
    case "if-null": {
      const v = evalExpr(args[0], ctx);
      return v !== null && v !== undefined ? v : evalExpr(args[1], ctx);
    }
    case "coalesce":
    case "coalesce-args": {
      for (const a of args) {
        const v = evalExpr(a, ctx);
        if (v !== null && v !== undefined) return v;
      }
      return null;
    }
    case "is-null":
      return evalExpr(args[0], ctx) === null;
    case "is-not-null":
      return evalExpr(args[0], ctx) !== null;

    // ── Numbers
    case "integer":
      return parseInt(String(evalExpr(args[0], ctx) ?? ""), 10);
    case "float":
    case "decimal":
      return parseFloat(String(evalExpr(args[0], ctx) ?? ""));
    case "is-integer":
      return Number.isInteger(evalExpr(args[0], ctx));
    case "is-float":
      return (
        typeof evalExpr(args[0], ctx) === "number" &&
        !Number.isInteger(evalExpr(args[0], ctx))
      );
    case "is-boolean":
      return typeof evalExpr(args[0], ctx) === "boolean";
    case "boolean":
      return Boolean(evalExpr(args[0], ctx));

    // ── Math
    case "+":
      return args.reduce(
        (acc, a) => (acc as number) + (evalExpr(a, ctx) as number),
        0,
      ) as number;
    case "plus":
      return (
        (evalExpr(args[0], ctx) as number) + (evalExpr(args[1], ctx) as number)
      );
    case "-":
    case "minus":
      return args.length === 1
        ? -(evalExpr(args[0], ctx) as number)
        : (evalExpr(args[0], ctx) as number) -
            (evalExpr(args[1], ctx) as number);
    case "*":
    case "multiply":
      return args.reduce(
        (acc, a) => (acc as number) * (evalExpr(a, ctx) as number),
        1,
      ) as number;
    case "/":
    case "divide":
      return (
        (evalExpr(args[0], ctx) as number) / (evalExpr(args[1], ctx) as number)
      );
    case "%":
    case "mod":
      return (
        (evalExpr(args[0], ctx) as number) % (evalExpr(args[1], ctx) as number)
      );
    case "^":
    case "pow":
      return Math.pow(
        evalExpr(args[0], ctx) as number,
        evalExpr(args[1], ctx) as number,
      );
    case "abs":
      return Math.abs(evalExpr(args[0], ctx) as number);
    case "ceil":
      return Math.ceil(evalExpr(args[0], ctx) as number);
    case "floor":
      return Math.floor(evalExpr(args[0], ctx) as number);
    case "round": {
      const v = evalExpr(args[0], ctx) as number;
      const digits =
        args[1] !== undefined ? (evalExpr(args[1], ctx) as number) : 0;
      const factor = Math.pow(10, digits);
      return Math.round(v * factor) / factor;
    }
    case "sqrt":
      return Math.sqrt(evalExpr(args[0], ctx) as number);
    case "cos":
      return Math.cos(evalExpr(args[0], ctx) as number);
    case "sin":
      return Math.sin(evalExpr(args[0], ctx) as number);
    case "tan":
      return Math.tan(evalExpr(args[0], ctx) as number);

    // ── Lists
    case "list":
      return args.map((a) => evalExpr(a, ctx));
    case "map": {
      const list = evalExpr(args[0], ctx);
      if (!Array.isArray(list)) return [];
      return list.map((item) =>
        evalExpr(args[1], { ...ctx, current: item as DtlValue }),
      );
    }
    case "filter": {
      const list = evalExpr(args[0], ctx);
      if (!Array.isArray(list)) return [];
      return list.filter((item) =>
        Boolean(evalExpr(args[1], { ...ctx, current: item as DtlValue })),
      );
    }
    case "first": {
      const v = evalExpr(args[0], ctx);
      return Array.isArray(v) ? (v[0] ?? null) : null;
    }
    case "last": {
      const v = evalExpr(args[0], ctx);
      return Array.isArray(v) ? (v[v.length - 1] ?? null) : null;
    }
    case "count": {
      const v = evalExpr(args[0], ctx);
      return Array.isArray(v) ? v.length : null;
    }
    case "distinct": {
      const v = evalExpr(args[0], ctx);
      if (!Array.isArray(v)) return v;
      return [...new Set(v.map((x) => JSON.stringify(x)))].map((x) =>
        JSON.parse(x),
      );
    }
    case "flatten": {
      const v = evalExpr(args[0], ctx);
      if (!Array.isArray(v)) return v;
      return v.flat(1);
    }
    case "combine": {
      const lists = args.map((a) => evalExpr(a, ctx));
      return lists.filter(Array.isArray).flat() as DtlValue[];
    }
    case "sorted": {
      const v = evalExpr(args[0], ctx);
      if (!Array.isArray(v)) return v;
      return [...v].sort((a, b) => ((a as string) > (b as string) ? 1 : -1));
    }
    case "sorted-descending": {
      const v = evalExpr(args[0], ctx);
      if (!Array.isArray(v)) return v;
      return [...v].sort((a, b) => ((a as string) < (b as string) ? 1 : -1));
    }
    case "reversed": {
      const v = evalExpr(args[0], ctx);
      return Array.isArray(v) ? [...v].reverse() : v;
    }
    case "sum": {
      const v = evalExpr(args[0], ctx);
      return Array.isArray(v)
        ? v.reduce((acc, x) => (acc as number) + (x as number), 0)
        : null;
    }
    case "min": {
      const v = evalExpr(args[0], ctx);
      return Array.isArray(v)
        ? v.reduce((a, b) => ((a as number) < (b as number) ? a : b))
        : null;
    }
    case "max": {
      const v = evalExpr(args[0], ctx);
      return Array.isArray(v)
        ? v.reduce((a, b) => ((a as number) > (b as number) ? a : b))
        : null;
    }
    case "in": {
      const val = evalExpr(args[0], ctx);
      const list = evalExpr(args[1], ctx);
      return Array.isArray(list) && list.includes(val);
    }
    case "nth": {
      const list = evalExpr(args[0], ctx);
      const idx = evalExpr(args[1], ctx) as number;
      return Array.isArray(list) ? (list[idx] ?? null) : null;
    }
    case "range": {
      const a = evalExpr(args[0], ctx) as number;
      const b =
        args[1] !== undefined ? (evalExpr(args[1], ctx) as number) : null;
      const step =
        args[2] !== undefined ? (evalExpr(args[2], ctx) as number) : 1;
      const start = b === null ? 0 : a;
      const end = b === null ? a : b;
      const result: number[] = [];
      for (let i = start; i < end; i += step) result.push(i);
      return result;
    }
    case "is-empty": {
      const v = evalExpr(args[0], ctx);
      return v === null || (Array.isArray(v) && v.length === 0);
    }
    case "is-not-empty": {
      const v = evalExpr(args[0], ctx);
      return v !== null && (!Array.isArray(v) || v.length > 0);
    }
    case "is-list":
      return Array.isArray(evalExpr(args[0], ctx));
    case "enumerate": {
      const v = evalExpr(args[0], ctx);
      if (!Array.isArray(v)) return [];
      return v.map((item, i) => [i, item]);
    }

    // ── Dictionaries
    case "dict": {
      const result: Record<string, DtlValue> = {};
      for (let i = 0; i < args.length - 1; i += 2) {
        const k = String(evalExpr(args[i], ctx));
        result[k] = evalExpr(args[i + 1], ctx);
      }
      return result;
    }
    case "keys": {
      const d = evalExpr(args[0], ctx);
      return d && typeof d === "object" && !Array.isArray(d)
        ? Object.keys(d)
        : null;
    }
    case "values": {
      const d = evalExpr(args[0], ctx);
      return d && typeof d === "object" && !Array.isArray(d)
        ? Object.values(d)
        : null;
    }
    case "has-key": {
      const d = evalExpr(args[0], ctx);
      const k = String(evalExpr(args[1], ctx) ?? "");
      return d && typeof d === "object" && !Array.isArray(d) ? k in d : false;
    }
    case "is-dict": {
      const v = evalExpr(args[0], ctx);
      return v !== null && typeof v === "object" && !Array.isArray(v);
    }
    case "path": {
      const pathStr = String(evalExpr(args[0], ctx) ?? "");
      const entity = evalExpr(args[1], ctx);
      if (!entity || typeof entity !== "object" || Array.isArray(entity))
        return null;
      return getProp(entity as EvalEntity, pathStr);
    }

    // ── Misc
    case "literal":
      return evalExpr(args[0], ctx);
    case "now":
      return new Date().toISOString();

    // ── Sets
    case "union": {
      const a = evalExpr(args[0], ctx);
      const b = evalExpr(args[1], ctx);
      if (!Array.isArray(a) || !Array.isArray(b)) return null;
      return [...new Set([...a, ...b].map((x) => JSON.stringify(x)))].map((x) =>
        JSON.parse(x),
      );
    }
    case "intersection": {
      const a = evalExpr(args[0], ctx);
      const b = evalExpr(args[1], ctx);
      if (!Array.isArray(a) || !Array.isArray(b)) return null;
      const setB = new Set(b.map((x) => JSON.stringify(x)));
      return a.filter((x) => setB.has(JSON.stringify(x)));
    }
    case "difference": {
      const a = evalExpr(args[0], ctx);
      const b = evalExpr(args[1], ctx);
      if (!Array.isArray(a) || !Array.isArray(b)) return null;
      const setB = new Set(b.map((x) => JSON.stringify(x)));
      return a.filter((x) => !setB.has(JSON.stringify(x)));
    }
    case "intersects": {
      const a = evalExpr(args[0], ctx);
      const b = evalExpr(args[1], ctx);
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      const setB = new Set(b.map((x) => JSON.stringify(x)));
      return a.some((x) => setB.has(JSON.stringify(x)));
    }

    // ── Unsupported (requires live node)
    case "hops":
    case "apply-hops":
    case "lookup-entity":
    case "apply":
    case "apply-ns":
    case "strip-ns":
    case "encrypt":
    case "decrypt":
    case "encrypt-pgp":
    case "decrypt-pgp":
    case "encrypt-pki":
    case "decrypt-pki":
    case "hash128":
    case "datetime":
    case "datetime-parse":
    case "datetime-format":
    case "datetime-diff":
    case "datetime-plus":
    case "datetime-shift":
    case "is-datetime":
    case "ni":
    case "ni-id":
    case "ni-ns":
    case "is-ni":
    case "uri":
    case "is-uri":
    case "url-quote":
    case "url-unquote":
    case "uuid":
    case "phonenumber-parse":
    case "phonenumber-format":
    case "json-transit":
    case "json-transit-parse":
    case "base64-encode":
    case "base64-decode":
    case "completeness":
    case "is-changed": {
      ctx.warnings.push(
        `⚠ "${name}" requires a live Sesam node — returning null in preview.`,
      );
      return null;
    }

    default: {
      ctx.warnings.push(`Unknown function "${name}" — returning null.`);
      return null;
    }
  }
}
