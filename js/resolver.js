import { logError } from "./reporter.js";

export function resolveImports(exportsMap, importsMap) {
  for (const [path, imports] of Object.entries(importsMap)) {
    for (const imp of imports) {
      const resolved = resolvePath(path, imp.source);
      const exported = exportsMap[resolved];

      if (!exported) {
        logError(`❌ ${path}: module '${imp.source}' not found (${resolved})`);
        continue;
      }

      for (const name of imp.names) {
        if (!exported.has(name)) {
          logError(
            `❌ ${path}: '${name}' is not exported by ${resolved}`
          );
        }
      }
    }
  }
}

function resolvePath(from, source) {
  if (!source.startsWith(".")) return source;

  const base = from.split("/").slice(0, -1);
  for (const part of source.split("/")) {
    if (part === ".") continue;
    if (part === "..") base.pop();
    else base.push(part);
  }

  let resolved = base.join("/");
  if (!resolved.endsWith(".js")) resolved += ".js";
  return resolved;
}