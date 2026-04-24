import jscodeshift from "jscodeshift";

function ensureNamedImport(root, j, fromModule, names) {
  const existing = root
    .find(j.ImportDeclaration)
    .filter((p) => p.node.source.value === fromModule);

  if (existing.size() === 0) {
    root.get().node.program.body.unshift(
      j.importDeclaration(
        names.map((n) => j.importSpecifier(j.identifier(n))),
        j.literal(fromModule),
      ),
    );
    return;
  }

  existing.forEach((p) => {
    const specifiers = p.node.specifiers ?? [];
    const existingNames = new Set(
      specifiers
        .filter((s) => s.type === "ImportSpecifier")
        .map((s) => s.imported.name),
    );
    for (const n of names) {
      if (!existingNames.has(n)) specifiers.push(j.importSpecifier(j.identifier(n)));
    }
    p.node.specifiers = specifiers;
  });
}

function wrapCalleeCalls(root, j, calleePath, wrapperName) {
  const parts = calleePath.split(".");

  const matches = root
    .find(j.CallExpression)
    .filter((p) => {
      let cur = p.node.callee;
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const name = parts[i];
        if (cur?.type === "MemberExpression" && cur.property.type === "Identifier" && cur.property.name === name) {
          cur = cur.object;
          continue;
        }
        if (i === 0 && cur?.type === "Identifier" && cur.name === name) return true;
        return false;
      }
      return false;
    });

  function isWithinWrapper(path) {
    let cur = path;
    while (cur?.parentPath) {
      const n = cur.parentPath.node;
      if (n?.type === "CallExpression") {
        const callee = n.callee;
        if (callee?.type === "Identifier" && callee.name === wrapperName) return true;
      }
      cur = cur.parentPath;
    }
    return false;
  }

  // Avoid double-wrapping if already inside wrapper(...)
  const toWrap = matches.filter((p) => !isWithinWrapper(p));

  const count = toWrap.size();

  toWrap
    .replaceWith((p) => {
      // Turn: callee(args...)  ->  wrapper(() => callee(args...))
      const originalCall = p.node;
      return j.callExpression(j.identifier(wrapperName), [
        j.arrowFunctionExpression([], originalCall),
      ]);
    });

  return count;
}

function newHandlerExpr(j, handlerName) {
  return j.newExpression(j.identifier(handlerName), []);
}

function hasHandlerAlready(j, callbacksPropValue, handlerName) {
  if (!callbacksPropValue) return false;
  if (callbacksPropValue.type !== "ArrayExpression") return false;
  return callbacksPropValue.elements.some((el) => {
    if (!el) return false;
    if (el.type !== "NewExpression") return false;
    return el.callee.type === "Identifier" && el.callee.name === handlerName;
  });
}

function ensureCallbacksInOptionsObject({ j, objExpr, handlerName }) {
  const props = objExpr.properties ?? [];
  const keyName = "callbacks";

  /** @type {any | null} */
  let callbacksProp = null;
  for (const p of props) {
    if (p?.type !== "ObjectProperty" && p?.type !== "Property") continue;
    const k = p.key;
    const name =
      k?.type === "Identifier" ? k.name :
      k?.type === "StringLiteral" ? k.value :
      k?.type === "Literal" ? k.value :
      null;
    if (name === keyName) callbacksProp = p;
  }

  if (!callbacksProp) {
    props.push(
      j.objectProperty(
        j.identifier(keyName),
        j.arrayExpression([newHandlerExpr(j, handlerName)]),
      ),
    );
    objExpr.properties = props;
    return;
  }

  const v = callbacksProp.value;
  if (hasHandlerAlready(j, v, handlerName)) return;

  if (v?.type === "ArrayExpression") {
    v.elements.push(newHandlerExpr(j, handlerName));
    return;
  }

  // Best-effort: if callbacks is some expression, rewrite to [...callbacks, new Handler()]
  // Only do this when we can safely spread (Identifier / MemberExpression / CallExpression).
  if (v && (v.type === "Identifier" || v.type === "MemberExpression" || v.type === "CallExpression")) {
    callbacksProp.value = j.arrayExpression([
      j.spreadElement(v),
      newHandlerExpr(j, handlerName),
    ]);
  }
}

function injectLangChainHitlGuardrail(root, j, { importFrom, handlerName }) {
  let injectedCount = 0;

  // Pattern 1: new AgentExecutor({ ...options })
  root.find(j.NewExpression, { callee: { type: "Identifier", name: "AgentExecutor" } }).forEach((p) => {
    const arg0 = p.node.arguments?.[0];
    if (arg0?.type === "ObjectExpression") {
      const before = j(arg0).toSource();
      ensureCallbacksInOptionsObject({ j, objExpr: arg0, handlerName });
      const after = j(arg0).toSource();
      if (after !== before) injectedCount += 1;
    }
  });

  // Pattern 2: AgentExecutor.fromAgentAndTools({ ...options })
  root
    .find(j.CallExpression, {
      callee: {
        type: "MemberExpression",
        object: { type: "Identifier", name: "AgentExecutor" },
        property: { type: "Identifier", name: "fromAgentAndTools" },
      },
    })
    .forEach((p) => {
      const arg0 = p.node.arguments?.[0];
      if (arg0?.type === "ObjectExpression") {
        const before = j(arg0).toSource();
        ensureCallbacksInOptionsObject({ j, objExpr: arg0, handlerName });
        const after = j(arg0).toSource();
        if (after !== before) injectedCount += 1;
      }
    });

  // Pattern 3: initializeAgentExecutorWithOptions(tools, llm, { ...options })
  root
    .find(j.CallExpression, { callee: { type: "Identifier", name: "initializeAgentExecutorWithOptions" } })
    .forEach((p) => {
      const args = p.node.arguments ?? [];
      const arg2 = args[2];
      if (!arg2) {
        args[2] = j.objectExpression([
          j.objectProperty(j.identifier("callbacks"), j.arrayExpression([newHandlerExpr(j, handlerName)])),
        ]);
        p.node.arguments = args;
        injectedCount += 1;
        return;
      }
      if (arg2.type === "ObjectExpression") {
        const before = j(arg2).toSource();
        ensureCallbacksInOptionsObject({ j, objExpr: arg2, handlerName });
        const after = j(arg2).toSource();
        if (after !== before) injectedCount += 1;
      }
    });

  if (injectedCount > 0) ensureNamedImport(root, j, importFrom, [handlerName]);
  return injectedCount;
}

export function applyTemplateOperations({ source, operations }) {
  const j = jscodeshift.withParser("tsx");
  const root = j(source);

  const deferredImports = [];
  let didMutate = false;
  let sawNonImportOp = false;

  for (const op of operations) {
    if (op.op === "ensure_import") {
      deferredImports.push(op);
    } else if (op.op === "wrap_call") {
      sawNonImportOp = true;
      const wrapped = wrapCalleeCalls(root, j, op.callee, op.wrapper);
      if (wrapped > 0) didMutate = true;
    } else if (op.op === "langchain_hitl_guardrail") {
      sawNonImportOp = true;
      const injected = injectLangChainHitlGuardrail(root, j, {
        importFrom: op.import_from ?? "./statute/hitl",
        handlerName: op.handler ?? "StatuteHITLCallbackHandler",
      });
      if (injected > 0) didMutate = true;
    } else {
      throw new Error(`UNSUPPORTED_OPERATION:${op.op}`);
    }
  }

  if (didMutate || !sawNonImportOp) {
    for (const op of deferredImports) {
      ensureNamedImport(root, j, op.from, op.named ?? []);
    }
  }

  return root.toSource({ quote: "double" });
}
