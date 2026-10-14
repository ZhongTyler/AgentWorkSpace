import fs from 'node:fs';
import path from 'node:path';

// Windows scaffold contract. Generated release files need not exist in a fresh clone.
export function checkBuildLayout(root) {
  const errors = [];
  const dir = path.join(root, 'builds/windows');
  let c;
  try { c = JSON.parse(fs.readFileSync(path.join(dir, 'layout.json'), 'utf8')); }
  catch { return ['missing or invalid builds/windows/layout.json']; }
  if (c.schema_version !== 1 || c.root_launcher !== 'play.cmd') errors.push('invalid build layout contract');
  const routes = {preview_directory:'maintenance/previews', packages_directory:'builds/windows/packages', packs_directory:'builds/windows/packs', archive_directory:'builds/windows/archive'};
  for (const [key, expected] of Object.entries(routes)) {
    if (c[key] !== expected || !fs.existsSync(path.join(root, expected, 'README.md'))) errors.push('missing/incorrect build route: '+key);
  }
  for (const name of fs.readdirSync(root)) {
    if (/\.(cmd|bat|exe|pck|zip)$/i.test(name) && name !== 'play.cmd') errors.push('stray root launcher/build: '+name);
  }
  for (const name of fs.readdirSync(dir)) {
    if (/\.(cmd|bat|exe|pck|zip)$/i.test(name) && name !== 'play.cmd') errors.push('unclassified Windows build: '+name);
  }
  const rootLauncher = path.join(root, 'play.cmd'), launcher = path.join(dir, 'play.cmd');
  if (c.current_release === null && c.current_executable === null) {
    if (fs.existsSync(rootLauncher) || fs.existsSync(launcher)) errors.push('launcher exists without a current release');
    return errors;
  }
  if (typeof c.current_release !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(c.current_release)
      || typeof c.current_executable !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.exe$/i.test(c.current_executable)) {
    errors.push('invalid current release/executable identity');
    return errors;
  }
  const text = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replaceAll('/', '\\') : '';
  if (!text(rootLauncher).includes('builds\\windows\\play.cmd')) errors.push('root launcher does not route to Windows launcher');
  if (!text(launcher).includes('packages\\'+c.current_release+'\\'+c.current_executable)) errors.push('current release and launcher disagree');
  return errors;
}
