import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Source text is normalized only for checkout line endings; claims remain human-reviewed.
export const statusHash = text => crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
export function checkStatus(root, contract = "maintenance/status-references.json") {
  const errors = [];
  const resolve = rel => {
    if (typeof rel !== "string" || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) throw new Error("unsafe status path: " + rel);
    const target = path.resolve(root, rel);
    if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error("outside status root");
    const real = fs.realpathSync(target), realRoot = fs.realpathSync(root);
    if (!real.startsWith(realRoot + path.sep)) throw new Error("linked status path outside root");
    if (!fs.statSync(target).isFile()) throw new Error("status reference is not a file: " + rel);
    return target;
  };
  try {
    const data = JSON.parse(fs.readFileSync(resolve(contract), "utf8"));
    if (data.schema_version !== 1 || !Array.isArray(data.sources)) throw new Error("invalid status contract");
    const seen = new Set();
    for (const row of data.sources) {
      if (seen.has(row.path)) throw new Error("duplicate status source: " + row.path);
      seen.add(row.path);
      if (!/^[a-f0-9]{64}$/.test(row.sha256) || !Array.isArray(row.consumers)) throw new Error("invalid status binding: " + row.path);
      const text = fs.readFileSync(resolve(row.path), "utf8");
      if (statusHash(text) !== row.sha256) errors.push("Status authority changed; review consumers before refreshing hash: " + row.path + " -> " + row.consumers.join(", "));
      for (const consumer of row.consumers) resolve(consumer);
    }
  } catch (error) { errors.push(error.message); }
  return {errors};
}
