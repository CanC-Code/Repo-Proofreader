import { logError } from "./reporter.js";

export function parseCSS(css, path) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  } catch (err) {
    logError(`CSS Syntax Error in ${path}: ${err.message}`);
  }
}