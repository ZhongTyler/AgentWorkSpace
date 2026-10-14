#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { checkStatus } from "./check-status.mjs";
import { checkDecisionReception } from "./check-decision-reception.mjs";
import { checkBuildLayout } from "./check-build-layout.mjs";
import { checkAssets, inside } from "./check-assets.mjs";
const root = path.resolve(process.argv[2] || process.cwd());
const configPath = path.join(root, "maintenance", "project-config.json");
const errors = [];
const warnings = [];
errors.push(...checkStatus(root).errors);
errors.push(...checkBuildLayout(root));
const reception = checkDecisionReception(root);
errors.push(...reception.errors); warnings.push(...reception.warnings);
const exists = (target) => fs.existsSync(target);
const read = (target) => fs.readFileSync(target, "utf8");
const relative = (target) => path.relative(root, target).split(path.sep).join("/") || ".";
if (!exists(configPath)) { console.error(`ERROR missing ${relative(configPath)}`); process.exit(1); }
let config;
try { config = JSON.parse(read(configPath)); } catch (error) { console.error(`ERROR invalid ${relative(configPath)}: ${error.message}`); process.exit(1); }
const engineDirectory = config.engine?.directory;
if (typeof engineDirectory !== "string" || !engineDirectory || path.isAbsolute(engineDirectory) || engineDirectory.includes("..")) errors.push("engine.directory must be a non-empty relative path without '..'");
try { inside(root, engineDirectory); } catch (e) { console.error(e.message); process.exit(1); }
const assetResult = checkAssets(root, config);
errors.push(...assetResult.errors); warnings.push(...assetResult.warnings);
if (assetResult.counts) console.log("Asset inventory: " + JSON.stringify(assetResult.counts));
const excluded = new Set(config.maintenance?.excluded_directories || []);
const generated = new Set(config.maintenance?.generated_directories || []);
const managedRoots = new Set(config.maintenance?.managed_roots || []);
if (engineDirectory) managedRoots.add(engineDirectory);
function isSkipped(relativeDirectory) { return [...excluded, ...generated].some((entry) => relativeDirectory === entry || relativeDirectory.startsWith(`${entry}/`)); }
function inspectLocalLinks(readmePath, content) {
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    const target = rawTarget.split("#")[0].split("?")[0];
    if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (!exists(path.resolve(path.dirname(readmePath), target))) errors.push(`broken local link ${rawTarget} in ${relative(readmePath)}`);
  }
}
function inspectDirectory(directory) {
  const rel = relative(directory);
  if (fs.lstatSync(directory).isSymbolicLink()) { errors.push("linked directory: " + rel); return; }
  const readmePath = path.join(directory, "README.md");
  if (!exists(readmePath)) { errors.push(`missing README.md in ${rel}`); return; }
  const content = read(readmePath);
  if (!content.includes("## 目录")) errors.push(`README route section missing in ${relative(readmePath)}`);
  inspectLocalLinks(readmePath, content);
  const children = fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).filter((name) => !isSkipped(rel === "." ? name : `${rel}/${name}`));
  for (const child of children) {
    const childPath = path.join(directory, child);
    if (!exists(path.join(childPath, "README.md"))) { errors.push(`missing README.md in ${relative(childPath)}`); continue; }
    if (!content.includes(`(${child}/README.md)`)) errors.push(`README route missing ${child}/README.md in ${relative(readmePath)}`);
    inspectDirectory(childPath);
  }
}
for (const filename of ["README.md", "NOW.md", "AGENTS.md", "maintenance/CHANGELOG.md"]) if (!exists(path.join(root, filename))) errors.push(`missing ${filename}`);
for (const managedRoot of managedRoots) if (!exists(path.join(root, managedRoot))) errors.push(`missing managed directory ${managedRoot}`);
inspectDirectory(root);
const enginePath = engineDirectory ? path.join(root, engineDirectory) : null;
if (enginePath && config.engine?.state === "not_initialized" && exists(path.join(enginePath, "project.godot"))) warnings.push("engine state is not_initialized but project.godot exists");
if (enginePath && config.engine?.state === "initialized" && !exists(path.join(enginePath, "project.godot"))) errors.push("engine state is initialized but project.godot is missing");
for (const warning of warnings) console.warn(`WARN ${warning}`);
if (errors.length) { for (const error of errors) console.error(`ERROR ${error}`); process.exit(1); }
console.log(`PASS health check: ${relative(root)} (template ${config.template?.version || "unknown"})`);
