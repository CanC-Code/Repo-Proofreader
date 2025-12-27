///// parseJS.js
///// Author: CCVO / CanC-Code
///// Purpose: Parse JS modules for syntax and exports/imports (browser-safe)

import { logError } from "./reporter.js";

export function parseJS(code, path, exportsMap, importsMap) {
  let ast;

  try {
    ast = Babel.parse(code, { sourceType: "module" });
  } catch (err) {
    logError(`JS Syntax Error in ${path}:\n${err.message}`);
    return;
  }

  const exports = new Set();
  const imports = [];

  function walk(node) {
    if (!node || typeof node !== "object") return;

    switch (node.type) {
      case "ExportNamedDeclaration":
        if (node.declaration) {
          if (node.declaration.id) exports.add(node.declaration.id.name);
          else if (node.declaration.declarations) {
            node.declaration.declarations.forEach(d => exports.add(d.id.name));
          }
        }
        if (node.specifiers) node.specifiers.forEach(s => exports.add(s.exported.name));
        break;

      case "ExportDefaultDeclaration":
        exports.add("default");
        break;

      case "ImportDeclaration":
        const source = node.source.value;
        const importedNames = node.specifiers.map(s => s.imported ? s.imported.name : "default");
        imports.push({ source, names: importedNames });
        break;
    }

    // Walk all child nodes
    for (const key in node) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(walk);
      else walk(child);
    }
  }

  walk(ast.program);

  exportsMap[path] = exports;
  importsMap[path] = imports;
}