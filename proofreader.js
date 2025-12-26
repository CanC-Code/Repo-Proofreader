///// proofreader.js - Import/Export Checker Addition
///// made by CanC-Code / CCVO

// Stores exports for all modules (path -> Set of exported names)
const moduleExportsMap = {};

async function parseJS(code, path) {
    try {
        const ast = Babel.transform(code, { ast: true, code: false, sourceType: "module" }).ast;

        // Collect exports
        const exportedSymbols = new Set();
        Babel.traverse(ast, {
            ExportNamedDeclaration({ node }) {
                if (node.declaration) {
                    if (node.declaration.id) exportedSymbols.add(node.declaration.id.name);
                    else if (node.declaration.declarations) {
                        node.declaration.declarations.forEach(d => exportedSymbols.add(d.id.name));
                    }
                }
                if (node.specifiers) node.specifiers.forEach(s => exportedSymbols.add(s.exported.name));
            },
            ExportDefaultDeclaration() { exportedSymbols.add("default"); }
        });
        moduleExportsMap[path] = exportedSymbols;

        // Check imports
        Babel.traverse(ast, {
            ImportDeclaration({ node }) {
                const source = node.source.value;
                node.specifiers.forEach(s => {
                    const importedName = s.imported ? s.imported.name : "default";
                    if (moduleExportsMap[source] && !moduleExportsMap[source].has(importedName)) {
                        logError(`❌ ${path}: imports '${importedName}' from '${source}' which is not exported`);
                    }
                });
            }
        });

    } catch (err) {
        logError(`JS Syntax Error in ${path}:\n${err.message}`);
    }
}