const output = document.getElementById("output");

export function log(msg) {
  const div = document.createElement("div");
  div.textContent = msg;
  div.className = "ok";
  output.appendChild(div);
}

export function logError(msg) {
  const div = document.createElement("div");
  div.textContent = msg;
  div.className = "error";
  output.appendChild(div);
}

export function clearLog() {
  output.textContent = "";
}