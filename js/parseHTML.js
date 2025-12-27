import { logError } from "./reporter.js";

export function parseHTML(html, path) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (doc.querySelector("parsererror")) {
      logError(`HTML Parse Error in ${path}`);
    }
  } catch (err) {
    logError(`HTML Error in ${path}: ${err.message}`);
  }
}