import { logError } from "./reporter.js";

export function parseJS(code, path, exportsMap, importsMap) {
  let ast;

  try {
    ast = Babel.transform(code, {
      ast: true,
      code: false,
      sourceType: "module"
    }).ast;
  } catch (err) {
    logError(`JS Syntax Error in ${path}:\n${err.message}`);
    return;
  }

  const exports = new Set();
  const imports = [];

  for (const node of ast.program.body) {
    if (node.type === "ExportNamedDeclaration") {
      if (node.declaration?.id) {
        exports.add(node.declaration.id.name);
      }
      if (node.specifiers) {
        node.specifiers.forEach(s => exports.add(s.exported.name));
      }
    }

    if (node.type === "ExportDefaultDeclaration") {
      exports.add("default");
    }

    if (node.type === "ImportDeclaration") {
      imports.push({
        source: node.source.value,
        names: node.specifiers.map(s =>
          s.imported ? s.imported.name : "default"
        )
      });
    }
  }

  exportsMap[path] = exports;
  importsMap[path] = imports;
}