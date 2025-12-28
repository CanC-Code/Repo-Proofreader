///// parseJS.js
///// Author: CCVO / CanC-Code
///// Purpose: Parse JS modules with 3-tier fallback (Babel → Esprima → Acorn/Recast)

import { log, logError } from "./reporter.js";
import * as acorn from '../libs/acorn.js';
import * as recast from '../libs/recast.min.js';
import * as esprima from '../libs/esprima.js';

export function parseJS(code, path, exportsMap, importsMap) {
  // Try Babel first
  if (tryBabel(code, path, exportsMap, importsMap)) {
    log("  ✓ " + path + " (Babel)");
    return;
  }

  // Try Esprima second
  if (tryEsprima(code, path, exportsMap, importsMap)) {
    log("  ✓ " + path + " (Esprima)");
    return;
  }

  // Try Acorn/Recast last
  if (tryAcornRecast(code, path, exportsMap, importsMap)) {
    log("  ✓ " + path + " (Acorn/Recast)");
    return;
  }

  // All parsers failed
  logError("❌ Cannot parse " + path + " with any parser");
}

// ----------------------
// Babel Parser
// ----------------------
function tryBabel(code, path, exportsMap, importsMap) {
  try {
    const ast = Babel.transform(code, { 
      ast: true, 
      code: false, 
      sourceType: "module" 
    }).ast;

    const exports = new Set();
    const imports = [];

    Babel.traverse(ast, {
      ExportNamedDeclaration({ node }) {
        if (node.declaration?.id) {
          exports.add(node.declaration.id.name);
        }
        if (node.declaration?.declarations) {
          node.declaration.declarations.forEach(d => exports.add(d.id.name));
        }
        if (node.specifiers) {
          node.specifiers.forEach(s => exports.add(s.exported.name));
        }
      },
      ExportDefaultDeclaration() {
        exports.add("default");
      },
      ImportDeclaration({ node }) {
        const source = node.source.value;
        const names = node.specifiers.map(s => 
          s.imported ? s.imported.name : "default"
        );
        imports.push({ source, names });
      }
    });

    exportsMap[path] = exports;
    importsMap[path] = imports;
    return true;

  } catch (err) {
    return false;
  }
}

// ----------------------
// Esprima Parser
// ----------------------
function tryEsprima(code, path, exportsMap, importsMap) {
  try {
    const ast = esprima.parseModule(code, { tolerant: true });

    const exports = new Set();
    const imports = [];

    for (const node of ast.body) {
      if (node.type === "ExportNamedDeclaration") {
        if (node.declaration?.id) {
          exports.add(node.declaration.id.name);
        }
        if (node.declaration?.declarations) {
          node.declaration.declarations.forEach(d => exports.add(d.id.name));
        }
        if (node.specifiers) {
          node.specifiers.forEach(s => exports.add(s.exported.name));
        }
      }

      if (node.type === "ExportDefaultDeclaration") {
        exports.add("default");
      }

      if (node.type === "ImportDeclaration") {
        const source = node.source.value;
        const names = node.specifiers.map(s => 
          s.imported ? s.imported.name : "default"
        );
        imports.push({ source, names });
      }
    }

    exportsMap[path] = exports;
    importsMap[path] = imports;
    return true;

  } catch (err) {
    return false;
  }
}

// ----------------------
// Acorn/Recast Parser
// ----------------------
function tryAcornRecast(code, path, exportsMap, importsMap) {
  try {
    const ast = recast.parse(code, { parser: acorn });

    const exports = new Set();
    const imports = [];

    recast.types.visit(ast, {
      visitExportNamedDeclaration(p) {
        if (p.node.declaration?.id) {
          exports.add(p.node.declaration.id.name);
        }
        if (p.node.declaration?.declarations) {
          p.node.declaration.declarations.forEach(d => {
            exports.add(d.id.name);
          });
        }
        if (p.node.specifiers) {
          p.node.specifiers.forEach(s => exports.add(s.exported.name));
        }
        this.traverse(p);
      },

      visitExportDefaultDeclaration(p) {
        exports.add("default");
        this.traverse(p);
      },

      visitImportDeclaration(p) {
        const source = p.node.source.value;
        const names = p.node.specifiers.map(s => 
          s.imported ? s.imported.name : "default"
        );
        imports.push({ source, names });
        this.traverse(p);
      }
    });

    exportsMap[path] = exports;
    importsMap[path] = imports;
    return true;

  } catch (err) {
    return false;
  }
}