/** Deterministic prototype rules. This module never performs external actions. */
export const policy = Object.freeze({
  rules: [
    { tool: "list_files", decision: "ALLOW", description: "List sandbox fixtures in /workspace only." },
    { tool: "read_file", decision: "ALLOW", description: "Read /workspace/notes.txt or /workspace/README.md only. Protected and unknown paths are blocked." },
    { tool: "delete_file", decision: "BLOCK", description: "File deletion is always blocked." },
    { tool: "send_email", decision: "REQUIRE_APPROVAL", description: "Require approval before a simulated email action. Message fields are redacted from stored requests." },
    { tool: "unknown", decision: "BLOCK", description: "Block tools that are not explicitly recognized." },
  ],
});

const FILES = Object.freeze({
  "/workspace/README.md": "# AgentGuard sandbox\n\nThis is a fixture file. No real filesystem access is performed.\n",
  "/workspace/notes.txt": "AgentGuard checks tool requests before sandbox execution.\nApproval decisions and request activity are recorded by the application.\n",
});

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function checkBounds(value, depth = 0, budget = { keys: 0 }) {
  if (depth > 4) fail("Arguments may be nested at most four levels.");
  if (typeof value === "string") {
    if (value.length > 4096) fail("Argument values are too long.");
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("Arguments contain an invalid number.");
    return;
  }
  if (!Array.isArray(value) && !isRecord(value)) fail("Arguments must contain JSON values only.");
  const entries = Object.entries(value);
  budget.keys += entries.length;
  if (budget.keys > 32) fail("Arguments contain too many fields.");
  for (const [key, nested] of entries) {
    if (key.length > 64 || ["__proto__", "prototype", "constructor"].includes(key)) fail("Arguments contain an unsupported field.");
    checkBounds(nested, depth + 1, budget);
  }
}

function allowedKeys(args, keys) {
  if (Object.keys(args).some(key => !keys.includes(key))) fail("This tool received unsupported argument fields.");
}

function stringField(args, name, max, allowEmpty = false) {
  const value = args[name];
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
    fail("The " + name + " argument must be a non-empty string of at most " + max + " characters.");
  }
  return value;
}

function pathCheck(path) {
  // Reject alternate encodings and ambiguous separators rather than normalizing them.
  if (/[\\%\u0000-\u001f\u007f?#]/.test(path) || path.includes("//")) return "The path contains ambiguous or unsupported characters.";
  const segments = path.split("/");
  if (segments.some(segment => segment === "." || segment === "..")) return "Path traversal is blocked.";
  if (path !== "/workspace" && !path.startsWith("/workspace/")) return "Only paths inside /workspace are permitted.";
  if (segments.some(segment => segment.startsWith(".") || /^(?:credentials?|secrets?|private|config)(?:\.|$)/i.test(segment) || /\.(?:pem|key|p12|pfx)$/i.test(segment))) {
    return "Access to protected or credential paths is blocked.";
  }
  return null;
}

export function evaluateRequest(body) {
  if (!isRecord(body)) fail("The request must be a JSON object.");
  if (Object.keys(body).some(key => !["tool", "arguments"].includes(key))) fail("The request contains unsupported fields.");
  if (typeof body.tool !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(body.tool)) {
    fail("Tool names must start with a letter and contain at most 64 letters, digits or underscores.");
  }
  if (!isRecord(body.arguments)) fail("The arguments field must be a JSON object.");
  checkBounds(body.arguments);
  const tool = body.tool;
  const args = body.arguments;
  const decision = (value, reason, stored = {}) => ({ tool, arguments: stored, decision: value, reason });

  if (!["list_files", "read_file", "delete_file", "send_email"].includes(tool)) {
    return decision("BLOCK", "This tool is not recognized. Unknown tools are blocked by default.");
  }

  if (tool === "send_email") {
    allowedKeys(args, ["to", "subject", "body"]);
    const to = stringField(args, "to", 254);
    const subject = stringField(args, "subject", 160);
    stringField(args, "body", 4000);
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to) || /[\r\n\u0000]/.test(to + subject)) {
      fail("Provide a valid single recipient and a subject without line breaks.");
    }
    return decision("REQUIRE_APPROVAL", "Email actions require an explicit approval before sandbox execution.", {
      to: "[redacted]", subject: "[redacted]", body: "[redacted]",
    });
  }

  allowedKeys(args, ["path"]);
  const path = tool === "list_files" && args.path === undefined ? "/workspace" : stringField(args, "path", 512);
  const problem = pathCheck(path);
  const stored = { path: problem ? "[restricted path]" : path };
  if (tool === "delete_file") return decision("BLOCK", "Deletion is blocked by policy. No file will be deleted.", stored);
  if (problem) return decision("BLOCK", problem, stored);
  if (tool === "list_files") {
    return path === "/workspace"
      ? decision("ALLOW", "Listing the sandbox workspace is permitted.", stored)
      : decision("BLOCK", "Only the /workspace directory is available in this sandbox.", stored);
  }
  return Object.hasOwn(FILES, path)
    ? decision("ALLOW", "This file is an explicitly permitted sandbox fixture.", stored)
    : decision("BLOCK", "This file is not on the sandbox read allowlist.", stored);
}

export function sandboxExecute(row) {
  if (!row || !["READY", "APPROVED"].includes(row.status)) fail("This request is not ready for execution.", 409);
  if (row.tool === "send_email" && row.decision === "REQUIRE_APPROVAL" && row.status === "APPROVED") {
    return { simulated: true, action: "send_email", message: "Sandbox email action completed. No email was sent." };
  }
  if (row.decision !== "ALLOW" || row.status !== "READY") fail("This request is not permitted for execution.", 409);
  const evaluated = evaluateRequest({ tool: row.tool, arguments: row.arguments });
  if (evaluated.decision !== "ALLOW") fail("The request does not satisfy the current policy.", 409);
  if (row.tool === "list_files") return { simulated: true, action: "list_files", files: Object.keys(FILES), message: "These are sandbox fixtures, not files on a real computer." };
  if (row.tool === "read_file") return { simulated: true, action: "read_file", path: row.arguments.path, content: FILES[row.arguments.path] };
  fail("The sandbox does not implement this tool.", 409);
}
