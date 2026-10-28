"""Read-only collaboration architecture audit (stdlib; Python >= 3.10).

Findings are evidence, never policy or permission. No model/network calls.
"""
import argparse
from collections import Counter, defaultdict, deque
import difflib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

sys.dont_write_bytecode = True
VERSION = 1
ENTRY_NAMES = {'AGENTS.md', 'AI_INDEX.md', 'README.md', 'COMMAND_MANUAL.md',
               'AI_SELF_CHECK.md', 'AI_SELF_CHECK_REFERENCE.md', 'AI_WORK_ROUTING.md', 'SKILL.md'}
ROOT_ENTRIES = ('AGENTS.md', 'AI_INDEX.md', 'README.md', 'COMMAND_MANUAL.md')
INACTIVE = {'mirror', 'generated-portable', 'template', 'export-template', 'released', 'archive', 'snapshot', 'release-input', 'third-party', 'state', 'diagnostic'}
MODAL = re.compile(r'必须|不得|禁止|始终|一律|无条件|每次|所有任务|默认|唯一|\bmust\b|\balways\b|\bnever\b', re.I)
CONDITION = re.compile(r'按需|仅在|只有|如果|若|当|命中|相关|适用|场景|用户.*(?:请求|授权|选择)|\bif\b|\bwhen\b|\bscenario\b|on demand', re.I)
HISTORICAL = re.compile(r'示例|反例|旧版|历史|例如|错误写法|反模式|example|counterexample', re.I)
PROMOTION = re.compile(r'必须.{0,12}(?:照搬|照抄|完整执行).{0,12}(?:示例|反例|建议)')
LOAD = re.compile(r'读取|加载|先读|必读|\bread\b|\bload\b(?!\s*(?:\*\*)?\s+(?:is|means)\b)', re.I)
RULE_TERMS = re.compile(r'授权|权限|owner|提交|发布|验收|完成|优先|SSOT|全局|根规则|上下文|Skill|读取|加载|测试|验证|approval|permission|commit', re.I)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def git(root, *args):
    env = dict(os.environ, GIT_OPTIONAL_LOCKS='0', GIT_TERMINAL_PROMPT='0')
    run = subprocess.run(['git', '--no-optional-locks', '-c', 'core.quotePath=false',
                          '-c', 'core.excludesFile=', '-C', str(root), *args],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if run.returncode:
        raise ValueError('Git read failed: ' + run.stderr.decode('utf-8', 'replace').strip())
    return run.stdout.decode('utf-8', 'strict')


def identity(path):
    parts = path.lower().split('/')
    if path.startswith(('collaboration/semantic/', 'collaboration/inheritance/')):
        return 'diagnostic'
    if '.collaboration' in parts:
        return 'generated-portable'
    # The Review router owns current triggers; its dated child reports are evidence snapshots.
    if path == 'reviews/README.md':
        return 'active'
    if parts[-1] in ('memory.md', 'now.md'):
        return 'state'
    if parts[-1] in ('changelog.md', 'history.md'):
        return 'snapshot'
    if any(x in parts for x in ('.agents', '.codebuddy')):
        return 'mirror'
    if 'released' in parts:
        return 'released'
    if 'release-input' in parts:
        return 'release-input'
    if any(x in parts for x in ('archive', '_archive', 'archives', '归档', 'legacy', 'legacy-source', 'legacy-import')):
        return 'archive'
    if any(x in parts for x in ('templates', '_templates', '_模板')) or '.template.' in path.lower():
        return 'template'
    if any(x in parts for x in ('reviews', 'evaluation', 'evaluations', 'tests', 'fixtures', 'reports', 'snapshots')):
        return 'snapshot'
    if 'post-to-xhs' in parts:
        return 'third-party'
    if path == 'meta-agent-collab/AGENTS.md':
        return 'active'
    if path.startswith('meta-agent-collab/'):
        return 'template'
    return 'active'


def prose(text):
    """Preserve physical line numbers; fences/examples cannot become live commands."""
    fence = None
    heading = ''
    for number, line in enumerate(text.splitlines(), 1):
        marker = re.match(r'^\s*(`{3,}|~{3,})', line)
        if marker:
            token = marker[1]
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            continue
        if fence:
            continue
        if line.startswith('#'):
            heading = line
        yield number, line, bool(HISTORICAL.search(heading) or (HISTORICAL.search(line) and not PROMOTION.search(line)))


def links(text):
    rows = list(prose(text))
    definitions = {}
    for n, line, _ in rows:
        match = re.match(r'^\s*\[([^\]]+)\]:\s*(<[^>]+>|\S+)', line)
        if match:
            definitions[match[1].casefold()] = match[2].strip('<>')
    for n, line, historical in rows:
        if re.match(r'^\s*\[[^\]]+\]:', line):
            continue
        used = []
        # Balanced one-level parentheses cover normal Markdown paths, including spaces in <>.
        pattern = r'(?<!!)\[([^\]]+)\]\((<[^>]+>|(?:[^()\n]|\([^()]*\))*)\)'
        for m in re.finditer(pattern, line):
            dest = m[2].strip()
            dest = dest[1:dest.index('>')] if dest.startswith('<') else re.sub(r'\s+[\"\x27].*$', '', dest)
            used.append(m.span())
            yield n, dest, line, historical, 'markdown'
        for m in re.finditer(r'(?<!!)\[([^\]]+)\](?:\[([^\]]*)\])?', line):
            if any(a <= m.start() < b for a, b in used):
                continue
            key = (m[2] or m[1]).casefold()
            if key in definitions:
                yield n, definitions[key], line, historical, 'markdown'
            elif m[2] is not None:
                yield n, 'unresolved-reference:' + key, line, historical, 'reference'
        # Bare paths inside code spans are common in project AGENTS. Commands and globs aren't links.
        for m in re.finditer(r'`([^`\n]+\.md(?:#[^` ]+)?)`', line, re.I):
            if not any(a <= m.start() < b for a, b in used) and not re.search(r'[ *<>|=]', m[1]):
                yield n, m[1], line, historical, 'code-path'


def anchors(text):
    counts = Counter()
    result = set(re.findall(r'<(?:a|span)\s+(?:name|id)=[\"\x27]([^\"\x27]+)', text))
    for _, line, _ in prose(text):
        if not re.match(r'^#{1,6}\s', line):
            continue
        value = re.sub(r'^#+\s*|\s+#+$', '', line).strip().lower()
        value = re.sub(r'[^\w\-\s\u3400-\u9fff]', '', value).replace(' ', '-')
        suffix = '-' + str(counts[value]) if counts[value] else ''
        counts[value] += 1
        result.add(value + suffix)
    return result


def normalize(line):
    value = re.sub(r'^\s*(?:>\s*)?(?:[-*]|\d+[.)、])?\s*', '', line)
    value = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', value)
    return re.sub(r'[\s`*，。；：、,.;:!！]', '', value).casefold()


def clauses(line):
    # English sentence stops require following whitespace, not a dot in a path.
    return re.split(r'[。；;]|(?<=[.!?])\s+', line)


class Audit:
    def __init__(self, root, max_documents=500, context_limit=12000):
        self.root = Path(root).resolve()
        self.max_documents = max_documents
        self.context_limit = context_limit
        self.files = {}
        self.repos = []
        self.docs = {}
        self.findings = []
        self.edges = []
        self.checked = Counter()
        self.mirrors = {}
        self.queue = deque()
        self.uninitialized = []
        self.visited_repositories = set()
        self.export_contexts = []
        self.export_templates = {}
        self.inheritance_expected = None
        self.verified_bridge_lines = set()

    def inheritance(self):
        self.inheritance_expected = {}
        self.verified_bridge_lines.clear()
        if not self.safe('collaboration/inheritance/manifest.json').is_file():
            return
        self.emit('observation', 'inheritance-generator-not-executed', 'Portable audit does not execute workspace generators; verify generated bridges separately.', [], 1)

    def emit(self, severity, code, message, evidence, confidence=1.0, candidate=None):
        row = {'severity': severity, 'code': code, 'message': message,
               'confidence': confidence, 'evidence': evidence}
        if candidate:
            row['candidate_change'] = candidate
        self.findings.append(row)

    def ev(self, path, line=1, excerpt=None):
        if excerpt is None:
            rows = self.docs.get(path, {}).get('text', '').splitlines()
            excerpt = rows[line - 1] if len(rows) >= line else path
        return {'path': path, 'line': line, 'excerpt': excerpt}

    def safe(self, rel):
        target = (self.root / rel).resolve()
        if not target.is_relative_to(self.root) or '.git' in [x.lower() for x in target.parts]:
            raise ValueError('outside readable workspace document scope: ' + rel)
        return target

    def inventory(self, rel='.'):
        repo = self.safe(rel)
        if repo in self.visited_repositories:
            raise ValueError('Duplicate/cyclic Git root alias: ' + rel)
        self.visited_repositories.add(repo)
        top = Path(git(repo, 'rev-parse', '--show-toplevel').strip()).resolve()
        if top != repo:
            raise ValueError('Not an independent Git root: ' + rel)
        raw = git(repo, 'ls-files', '--stage', '-z')
        self.repos.append({'path': rel, 'head': git(repo, 'rev-parse', 'HEAD').strip(),
                           'status': git(repo, 'status', '--porcelain=v1', '--ignore-submodules=all')})
        children = []
        for record in raw.split('\0'):
            if not record:
                continue
            meta, name = record.split('\t', 1)
            mode, sha, stage = meta.split()
            path = (Path(rel) / name).as_posix().removeprefix('./')
            if stage != '0':
                self.emit('error', 'index-conflict', 'Unmerged tracked path; scope cannot be trusted.', [self.ev(path)])
                continue
            self.files[path] = {'repository': rel, 'index_blob': sha, 'mode': mode, 'identity': identity(path)}
            if mode == '160000':
                children.append((path, sha))
        for child, sha in children:
            if not (self.safe(child) / '.git').exists():
                self.uninitialized.append(child)
                self.emit('observation', 'uninitialized-repository', 'Gitlink is not initialized; project audit not covered.', [self.ev(child)], 1)
            else:
                self.inventory(child)
                if self.repos[-1]['path'] == child and self.repos[-1]['head'] != sha:
                    self.emit('observation', 'gitlink-worktree-difference', 'Audit uses current worktree, different from parent gitlink.', [self.ev(child)])

    def add(self, path, reason, scope=None, activate_template=False):
        path = Path(path).as_posix()
        if path in self.docs:
            if reason not in self.docs[path]['reached_by']:
                self.docs[path]['reached_by'].append(reason)
            return
        role = 'export-template' if path in self.export_templates else self.files.get(path, {}).get('identity', identity(path))
        if role in INACTIVE and role != 'export-template' and not (role == 'template' and activate_template):
            return
        if len(self.docs) >= self.max_documents:
            self.emit('observation', 'discovery-limit', 'Document cap reached; remaining graph is not covered.', [self.ev(path)])
            return
        try:
            raw = self.safe(path).read_bytes()
            text = raw.decode('utf-8-sig')
        except (OSError, UnicodeError, ValueError) as exc:
            self.emit('error', 'unreadable-entry', str(exc), [self.ev(path)])
            return
        self.docs[path] = {'path': path, 'identity': role, 'scope': scope or str(Path(path).parent).replace('\\', '/'),
                           'activation': ('declared-export-template' if role == 'export-template' else
                                          'conditional-template' if activate_template else 'scoped-entry-or-reference'),
                           'repository': self.files.get(path, {}).get('repository', '.'),
                           'reached_by': [reason], 'sha256': digest(raw), 'characters': len(text), 'text': text}
        if re.search(r'(?:本文|本文件).{0,12}(?:已废弃|仅为历史快照|仅供历史参考)', text[:800]):
            self.docs[path]['identity'] = 'snapshot'
            self.emit('warning', 'declared-inactive-entry', 'Live entry declares itself deprecated/historical; body excluded from normative comparison.', [self.ev(path)], .95,
                      '候选：核对当前入口，迁移消费者；不从旧快照恢复政策。')
            return
        self.queue.append(path)

    def exports(self):
        registry = 'collaboration/semantic/export-contexts.json'
        if not self.safe(registry).is_file():
            return
        spec = importlib.util.spec_from_file_location('semantic_export_context', Path(__file__).parent / 'semantic/export_context.py')
        adapter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(adapter)
        self.export_adapter = adapter
        config = json.loads(self.safe(registry).read_text(encoding='utf-8-sig'))
        if set(config) != {'schema_version', 'generators'} or type(config['schema_version']) is not int or config['schema_version'] != 1 or not isinstance(config['generators'], list):
            raise ValueError('Unsupported export context registry')
        for entry in config['generators']:
            try:
                if set(entry) != {'path', 'adapter'} or entry['adapter'] != 'python-freeze-v1':
                    raise ValueError('Unsupported export context adapter')
                name = adapter.output_path(entry['path'])
                if name not in self.files or self.files[name]['mode'] not in ('100644', '100755'):
                    raise ValueError('Generator is not a tracked regular source')
                raw = self.safe(name).read_bytes()
                def contained(path):
                    return self.safe(str(path)).resolve()
                template_root, templates, outputs = adapter.python_freeze(self.safe(name), raw.decode('utf-8-sig'), contained)
                if (template_root / 'FROZEN.json').exists():
                    self.emit('error', 'export-context-collision', 'Artifact marker at registered source-template root; use ordinary artifact checks.', [self.ev(name)])
                    continue
                mapped = {p.relative_to(self.root).as_posix(): target for p, target in templates.items()}
                if set(mapped) & self.export_templates.keys():
                    raise ValueError('Source template has multiple export contexts')
                context = {'generator': name, 'sha256': digest(raw), 'templates': mapped,
                           'outputs': {target: p.relative_to(self.root).as_posix() if p else None for target, p in outputs.items()},
                           'artifacts_verified': False}
                self.export_contexts.append(context)
                self.export_templates.update({path: context for path in mapped})
                self.checked['export_contexts'] += 1
            except (OSError, ValueError, TypeError, KeyError, SyntaxError) as exc:
                self.emit('error', 'export-context-unavailable', str(exc), [self.ev(registry, excerpt=str(entry))])

    def export_link(self, source, dest, line, context):
        binding = self.export_templates[source]
        parsed = urlsplit(dest.replace('\\', '/'))
        if parsed.scheme or parsed.netloc:
            self.checked['external_links_not_checked'] += 1
            return
        evidence = [self.ev(source, line, context), self.ev(binding['generator'])]
        try:
            output = self.export_adapter.link_output(binding['templates'][source], unquote(parsed.path))
        except ValueError:
            output = None
        if output not in binding['outputs']:
            self.emit('error', 'unmapped-export-target', 'No declared export target: ' + dest, evidence)
            return
        target = binding['outputs'][output]
        if target is None:
            self.emit('observation', 'dynamic-export-target', 'Caller-supplied output is not statically verified: ' + output, evidence)
            return
        actual = self.safe(target)
        if not actual.is_file():
            self.emit('error', 'missing-export-source', 'Missing source for exported target ' + output + ': ' + target, evidence)
            return
        self.checked['export_template_targets'] += 1
        fragment = unquote(parsed.fragment)
        if fragment and actual.suffix.lower() == '.md' and fragment not in anchors(actual.read_text(encoding='utf-8-sig')):
            self.emit('warning', 'anchor-candidate', 'Exported heading fragment not found: ' + dest, evidence, .85)
        self.edges.append({'source': source, 'line': line, 'target': target, 'kind': 'export-reference',
                           'identity': 'export-template' if target in self.export_templates else identity(target), 'output': output})
        if target in self.export_templates:
            self.add(target, source + ':' + str(line) + ' declared export reference')

    def seeds(self):
        for path in ROOT_ENTRIES:
            self.add(path, 'root entry', '.')
        self.add('collaboration/README.md', 'architecture entry', '.')
        # Git discovery establishes separate nearest-directory contracts, not one global rule set.
        for path, item in sorted(self.files.items()):
            if Path(path).name == 'AGENTS.md' and item['identity'] == 'active':
                self.add(path, 'tracked scoped AGENTS', Path(path).parent.as_posix())
                for name in ('README.md', 'AI_INDEX.md'):
                    peer = (Path(path).parent / name).as_posix()
                    if peer in self.files:
                        self.add(peer, 'scoped entry', Path(path).parent.as_posix())
        for repo in self.repos:
            path = (Path(repo['path']) / 'README.md').as_posix().removeprefix('./')
            if path in self.files:
                self.add(path, 'Git repository entry', repo['path'])
        manifest_path = 'shared-skills/manifest.json'
        if self.safe(manifest_path).is_file():
            manifest = json.loads(self.safe(manifest_path).read_text(encoding='utf-8-sig'))
            source = manifest['sourceDirectory']
            for skill in manifest['skills']:
                directory = source + '/' + skill['name']
                self.safe(directory)
                self.add(directory + '/SKILL.md', 'Skill manifest', '@skill:' + skill['name'])
                resources = [directory + '/SKILL.md'] + [p for p in self.files if any(p.startswith(directory + '/' + r + '/') for r in manifest['resourceDirectories'])]
                for p in resources:
                    for kind in ('codex', 'codebuddy'):
                        mirror = manifest['adapters'][kind] + '/' + p[len(source) + 1:]
                        self.mirrors[mirror] = p
        # Non-manifest SKILLs require a live project link; merely being named SKILL is insufficient.

    def resolve(self, source, dest, style):
        if dest.startswith('unresolved-reference:'):
            return None, '', 'undefined'
        parsed = urlsplit(dest.replace('\\', '/'))
        if parsed.scheme or parsed.netloc:
            return None, '', 'external'
        path = unquote(parsed.path)
        fragment = unquote(parsed.fragment)
        if not path:
            return source, fragment, 'local'
        candidate = (Path(source).parent / path).as_posix()
        target = self.safe(candidate)
        if style == 'code-path' and not target.exists():
            repo = self.docs[source]['repository']
            options = [(Path(repo) / path).as_posix(), path]
            present = {self.safe(p) for p in options if self.safe(p).exists()}
            if len(present) == 1:
                target = present.pop()
            elif len(present) > 1:
                return None, fragment, 'ambiguous'
        return target.relative_to(self.root).as_posix(), fragment, 'local'

    def graph(self):
        while self.queue:
            source = self.queue.popleft()
            doc = self.docs[source]
            for line, dest, context, historical, style in links(doc['text']):
                clause = next((part for part in clauses(context) if dest in part), context)
                if style == 'code-path' and not re.search(r'读取|加载|先读|遵循|参见|路由|入口|协议|Query|Ingest|契约', clause, re.I):
                    continue
                evidence = [self.ev(source, line, context)]
                if source in self.export_templates and style == 'markdown':
                    self.export_link(source, dest, line, context)
                    continue
                try:
                    target, fragment, status = self.resolve(source, dest, style)
                except ValueError as exc:
                    self.emit('observation', 'external-path', str(exc), evidence)
                    continue
                if status == 'external':
                    self.checked['external_links_not_checked'] += 1
                    continue
                if status in ('undefined', 'ambiguous'):
                    self.emit('error' if status == 'undefined' else 'observation', 'unresolved-reference', status + ': ' + dest, evidence)
                    continue
                self.checked['local_targets'] += 1
                actual = self.safe(target)
                if not actual.exists():
                    if any(target.startswith(p + '/') for p in self.uninitialized):
                        self.emit('observation', 'uninitialized-target', 'Target lies in an uninitialized gitlink; absence is not a proven broken link: ' + target, evidence)
                        continue
                    planned = bool(re.search(r'待建|计划|拟建|示例|例如|placeholder', context))
                    level = 'observation' if style == 'code-path' or historical or planned else 'error'
                    self.emit(level, 'missing-target', 'Local target does not exist: ' + target, evidence,
                              1 if style == 'markdown' else .7, '核对实际消费者后更正路径；规划占位不等于可执行入口。')
                    continue
                if fragment and actual.is_file() and actual.suffix.lower() == '.md':
                    self.checked['anchors'] += 1
                    if fragment not in anchors(actual.read_text(encoding='utf-8-sig')):
                        self.emit('warning', 'anchor-candidate', 'Heading fragment not found by GitHub-style slug approximation: ' + dest, evidence, .85,
                                  '核对目标渲染器的锚点后修正；自定义渲染器可能不同。')
                role = self.files.get(target, {}).get('identity', identity(target))
                negated = re.search(r'不.{0,15}(?:读取|加载)|不(?:要求|强制)|无需|不做', clause)
                required = bool(LOAD.search(clause) and MODAL.search(clause) and not CONDITION.search(clause) and not historical and not negated)
                kind = 'required-candidate' if required else 'reference'
                self.edges.append({'source': source, 'line': line, 'target': target, 'kind': kind, 'identity': role})
                if role in INACTIVE:
                    explicit = re.search(r'模板|历史|镜像|副本|发布|归档|恢复|旧|release|archive|template|snapshot', clause, re.I)
                    # Diagnostic material is a legitimate conditional tool reference, not a policy source.
                    # Universal required reading still warns, and existence was checked above.
                    if (source, line) not in self.verified_bridge_lines and role != 'state' and (required or (role != 'diagnostic' and LOAD.search(clause) and not explicit and not historical and not negated)):
                        self.emit('warning', 'lifecycle-route', 'Active instruction routes to ' + role + ': ' + target, evidence, .9,
                                  '由所属 owner 明确按需模板/历史参考用途，或指向当前源。')
                    if role == 'template' and explicit and not negated and (Path(source).name == 'AGENTS.md' or LOAD.search(clause)) and not historical:
                        self.add(target, source + ':' + str(line) + ' explicit conditional template',
                                 Path(target).parent.parent.as_posix(), activate_template=True)
                    continue
                if actual.is_dir():
                    target = (Path(target) / 'README.md').as_posix()
                    actual = self.safe(target)
                if actual.suffix.lower() != '.md' or not actual.is_file() or historical:
                    continue
                # Only expand governance entries and instructions that actually route to material.
                governance = re.search(r'协作|规则|维护|协议|契约|能力|capabilit|AGENTS|AI_INDEX|COMMAND_MANUAL|SKILL', context, re.I)
                named_contract = Path(target).name in ENTRY_NAMES - {'README.md'}
                if named_contract or LOAD.search(context) or (Path(target).name == 'README.md' and governance):
                    target_scope = doc['scope']
                    if Path(target).name == 'AGENTS.md':
                        target_scope = Path(target).parent.as_posix()
                    if target not in self.files:
                        self.emit('observation', 'untracked-entry', 'Reachable local document is not tracked in discovered Git roots.', evidence)
                    self.add(target, source + ':' + str(line), target_scope)
            # A project capability can be named by its catalog diagram instead of a Markdown link.
            if Path(source).name == 'README.md':
                prefix = Path(source).parent.as_posix() + '/'
                for p in sorted(self.files):
                    if p.startswith(prefix) and Path(p).name == 'SKILL.md' and identity(p) == 'active':
                        name = Path(p).parent.name
                        if re.search(r'(?<![\w-])' + re.escape(name) + r'(?![\w-])', doc['text']):
                            self.add(p, source + ' names capability: ' + name, '@skill:' + p)

    def compatible(self, a, b):
        x, y = self.docs[a]['scope'], self.docs[b]['scope']
        if x.startswith('@skill:') or y.startswith('@skill:'):
            if x.startswith('@skill:') and y.startswith('@skill:'):
                return x == y
            skill, normal = (a, b) if x.startswith('@skill:') else (b, a)
            repo, scope = self.docs[skill]['repository'], self.docs[normal]['scope']
            return scope == '.' or repo == scope or Path(skill).parent.as_posix().startswith(scope + '/')
        return x == y or x == '.' or y == '.' or x.startswith(y + '/') or y.startswith(x + '/')

    def semantics(self):
        rules = []
        markers = defaultdict(list)
        for path, doc in self.docs.items():
            if doc['identity'] in INACTIVE and doc['activation'] != 'conditional-template':
                continue
            for n, line, historical in prose(doc['text']):
                for token in re.findall(r'<!--\s*([\w-]+-ssot:v\d+)\s*-->', line):
                    markers[token].append(self.ev(path, n, line))
                if historical or line.lstrip().startswith(('#', '<!--')):
                    continue
                if (path, n) in self.verified_bridge_lines:
                    continue
                if MODAL.search(line) and RULE_TERMS.search(line):
                    rules.append((path, n, line, normalize(line)))
                if any(re.search(r'(?<!不)本层覆盖全局|(?:项目|Skill|本技能).{0,15}(?<!不)(?<!不会)(?<!不能)(?:高于|优先于|覆盖).{0,10}(?:用户|根|全局)', part, re.I) for part in clauses(line)):
                    self.emit('warning', 'priority-candidate', 'Priority wording may override the shared kernel.', [self.ev(path, n, line), self.ev('AGENTS.md')], .9,
                              '候选：明确覆盖只适用于领域补充，不改变根层授权与事实边界；须 owner 审阅。')
                if re.search(r'(?:测试|技术|结构).{0,20}(?:PASS|通过).{0,12}(?:即|自动|等于|视为).{0,12}(?:验收|发布|完成)', line, re.I) and not re.search(r'不|不能|不得|不等于', line):
                    self.emit('warning', 'acceptance-candidate', 'Technical success may be promoted to acceptance.', [self.ev(path, n, line)], .9,
                              '候选：由权威验收合同核对技术门与人工门，不自动改状态。')
                if '/SKILL.md' in path:
                    if re.search(r'无需.{0,8}(?:授权|批准)|(?<!不)自动.{0,8}(?:发送|发布|删除)|(?:始终|无条件).{0,8}(?:写入|修改|提交)', line) and not re.search(r'不自动|不得|禁止|不能|不等于', line):
                        self.emit('warning', 'skill-authority-candidate', 'Skill wording may expand user scope.', [self.ev(path, n, line)], .85,
                                  '候选：将动作绑定用户已授权的目标、对象与范围。')
                    if any(LOAD.search(part) and MODAL.search(part) and not CONDITION.search(part) and not re.search(r'不(?:要求|强制)|无需|\bnever\s+(?:read|load)\b', part, re.I) for part in clauses(line)):
                        self.emit('warning', 'skill-eager-load', 'Skill may require extra reading unconditionally.', [self.ev(path, n, line)], .8,
                                  '候选：核对是否为该 Skill 执行必需输入，再决定是否按需下沉。')
                if re.search(r'(?:所有任务|每次任务|每轮|无论.*任务).{0,30}(?:必须|一律|都要)', line) and re.search(r'提问|自测|全量|读取全部|示例|反例|启动清单', line):
                    self.emit('warning', 'unconditional-method', 'Method/example may have become an unconditional gate.', [self.ev(path, n, line)], .85,
                              '候选：核对真实触发条件，保留必要领域验收而移除无证据的全局仪式。')
                if PROMOTION.search(line):
                    self.emit('warning', 'example-promoted-candidate', 'Example/advice appears promoted to a compulsory procedure.', [self.ev(path, n, line)], .8)
                if any(re.search(r'只读.{0,15}(?:必须|自动|一律).{0,12}(?:写入|提交|更新)', part) and not re.search(r'不得|禁止|不要求|无需|不(?:自动|必须|一律)', part) for part in clauses(line)):
                    self.emit('warning', 'readonly-write-candidate', 'A read-only trigger appears to require writes.', [self.ev(path, n, line)], .9,
                              '候选：核对只读目标与持久化触发，不把检查发现当写入授权。')
        for token, evidence in markers.items():
            if len(evidence) > 1:
                self.emit('error', 'duplicate-ssot-marker', 'Unique source marker defined more than once: ' + token, evidence)
        for i, (a, an, al, av) in enumerate(rules):
            for b, bn, bl, bv in rules[i + 1:]:
                if a == b and an == bn or not self.compatible(a, b):
                    continue
                self.checked['comparable_rule_pairs'] += 1
                evidence = [self.ev(a, an, al), self.ev(b, bn, bl)]
                # Exact opposing imperative with an identical subject, action AND explicit condition only.
                pa = re.fullmatch(r'(.*?)必须(.+)', av)
                pb = re.fullmatch(r'(.*?)(?:禁止|不得)(.+)', bv)
                qa = re.fullmatch(r'(.*?)(?:禁止|不得)(.+)', av)
                qb = re.fullmatch(r'(.*?)必须(.+)', bv)
                if ((pa and pb and pa.groups() == pb.groups()) or (qa and qb and qa.groups() == qb.groups())):
                    conditional = any(self.docs[p]['activation'] == 'conditional-template' for p in (a, b))
                    self.emit('warning' if conditional else 'error', 'template-conflict-candidate' if conditional else 'literal-contradiction',
                              'Identical condition/action is both required and forbidden; template activation needs review.' if conditional else 'Identical condition/action is both required and forbidden.', evidence, .85 if conditional else 1)
                elif av == bv and len(av) >= 25 and a != b:
                    self.emit('warning', 'duplicate-rule', 'Same normative text appears in compatible active scopes.', evidence, .98,
                              '候选：保留唯一来源并用带范围的引用替换副本；先确认是否为必要领域合同。')
                elif a != b and len(av) >= 35 and len(bv) >= 35:
                    score = difflib.SequenceMatcher(None, av, bv, autojunk=False).ratio()
                    if score >= .78:
                        self.emit('warning' if score >= .88 else 'observation', 'drift-candidate',
                                  'Similar normative clauses; conditions may differ (similarity %.3f).' % score,
                                  evidence, round(score, 3), '候选：逐项比较主体、触发、授权与完成条件；合理项目细化应保留。')
        self.checked['normative_clauses'] = len(rules)
        self.checked['semantic_documents'] = sum(d['identity'] not in INACTIVE or d['activation'] == 'conditional-template' for d in self.docs.values())

    def cycles(self):
        graph = defaultdict(set)
        for edge in self.edges:
            if edge['kind'] == 'required-candidate' and edge['target'] in self.docs and edge['source'] != edge['target']:
                graph[edge['source']].add(edge['target'])
        # Tarjan SCC: avoid enumerating exponentially many paths through a dense reference graph.
        indexes, low, stack, on_stack = {}, {}, [], set()
        def visit(node):
            indexes[node] = low[node] = len(indexes)
            stack.append(node)
            on_stack.add(node)
            for target in sorted(graph[node]):
                if target not in indexes:
                    visit(target)
                    low[node] = min(low[node], low[target])
                elif target in on_stack:
                    low[node] = min(low[node], indexes[target])
            if low[node] == indexes[node]:
                component = []
                while True:
                    target = stack.pop()
                    on_stack.remove(target)
                    component.append(target)
                    if target == node:
                        break
                if len(component) > 1:
                    self.emit('warning', 'required-cycle-candidate', 'Unconditional reading edges form a cycle; ordinary backlinks are not errors.',
                              [self.ev(p, next(e['line'] for e in self.edges if e['source'] == p and e['target'] in component and e['kind'] == 'required-candidate')) for p in sorted(component)], .85)
        for node in list(graph):
            if node not in indexes:
                visit(node)
        self.checked['required_edges'] = sum(len(v) for v in graph.values())

    def mirror_check(self):
        # Portable content is generated, but exclusion from prose comparison must
        # never suppress byte drift. Validate it against the one canonical source.
        manifest = self.safe('collaboration/inheritance/manifest.json')
        if manifest.is_file():
            if self.inheritance_expected is None:
                self.inheritance()
            expected = self.inheritance_expected
            for path, content in expected.items():
                self.checked['inheritance_generated_targets'] += 1
                if not self.safe(path).is_file() or self.safe(path).read_text(encoding='utf-8-sig') != content:
                    self.emit('error', 'inheritance-drift', 'Generated inheritance connection differs from canonical source.', [self.ev(path)])
            for path, item in self.files.items():
                if item['identity'] == 'generated-portable' and path not in expected:
                    self.emit('observation', 'unregistered-portable', 'Portable file is not registered by the generator; review its origin.', [self.ev(path)])
        for mirror, source in sorted(self.mirrors.items()):
            self.checked['mirror_pairs'] += 1
            try:
                if self.safe(mirror).read_bytes() != self.safe(source).read_bytes():
                    self.emit('error', 'mirror-drift', 'Generated mirror differs byte-for-byte from manifest source.', [self.ev(source), self.ev(mirror)])
            except OSError as exc:
                self.emit('error', 'missing-mirror-source', str(exc), [self.ev(source), self.ev(mirror)])
        for path, item in self.files.items():
            if item['identity'] == 'mirror' and Path(path).name == 'SKILL.md' and path not in self.mirrors:
                self.emit('observation', 'unregistered-mirror', 'Discovered Skill is outside the shared manifest; activation/source needs review.', [self.ev(path)])

    def context(self):
        path = 'collaboration/routes.json'
        if not self.safe(path).is_file():
            self.emit('observation', 'no-route-cost', 'No router config; default context cost not covered.', [self.ev(path)])
            return {}
        config = json.loads(self.safe(path).read_text(encoding='utf-8-sig'))
        profile = config['default_profile']
        result = {}
        for task, extra in config['tasks'].items():
            selected = config['base'] + config['profiles'][profile] + extra
            if len(set(selected)) != len(selected):
                self.emit('warning', 'duplicate-route', 'Router selects a source more than once: ' + task, [self.ev(path)])
            for p in selected:
                if identity(p) in INACTIVE:
                    self.emit('warning', 'inactive-router-source', 'Explicit router selects a non-active role: ' + p, [self.ev(path)], .95)
                self.add(p, 'router task:' + task, '.')
            total = sum(self.docs[p]['characters'] for p in set(selected) if p in self.docs)
            result[task] = {'paths': list(dict.fromkeys(selected)), 'characters': total}
            self.checked['router_tasks'] += 1
        default = result.get('answer', {})
        if default.get('characters', 0) > self.context_limit:
            self.emit('warning', 'default-context-cost', 'Default answer route exceeds diagnostic character threshold; threshold is not policy.',
                      [self.ev(path, excerpt=json.dumps(default, ensure_ascii=False))], .85,
                      '候选：审阅默认注入是否应下沉为任务输入；不按字符数删除必要边界。')
        return {'profile': profile, 'routes': result, 'warning_threshold_characters': self.context_limit,
                'unit': 'Unicode characters, not tokens; host/global prompts and implicit prose loads excluded'}

    def required_context(self, cost):
        selected = set(cost.get('routes', {}).get('answer', {}).get('paths', []))
        initial = set(selected)
        while True:
            expanded = selected | {e['target'] for e in self.edges if e['source'] in selected and e['kind'] == 'required-candidate'}
            if expanded == selected:
                break
            selected = expanded
        total = sum(self.docs[p]['characters'] for p in selected if p in self.docs)
        cost['default_required_candidates'] = {'paths': sorted(selected), 'characters': total,
                                                'unmeasured': sorted(selected - self.docs.keys())}
        if selected != initial and total > self.context_limit:
            self.emit('warning', 'transitive-context-cost', 'Default plus candidate unconditional reads exceeds diagnostic threshold.',
                      [self.ev(e['source'], e['line']) for e in self.edges if e['source'] in selected and e['kind'] == 'required-candidate'], .8,
                      '候选：核对传递加载是否确为无条件；保留任务必需输入，避免把导航当启动包。')

    def baseline(self):
        return {'status':'not_run','sources':[], 'use':'No recipient behavioral evaluation was performed.'}

    def run(self):
        self.inventory()
        self.inheritance()
        self.exports()
        self.seeds()
        cost = self.context()
        self.graph()
        self.required_context(cost)
        self.semantics()
        self.cycles()
        self.mirror_check()
        baseline = self.baseline()
        for check, count in sorted(self.checked.items()):
            if count and check != 'external_links_not_checked':
                self.emit('pass', 'executed-' + check, 'Executed coverage count: ' + str(count) + '; findings remain separate.', [], 1)
        for row in self.findings:
            row['id'] = digest(json.dumps(row, sort_keys=True, ensure_ascii=False).encode())[:12]
        self.findings.sort(key=lambda x: (['error', 'warning', 'observation', 'pass'].index(x['severity']), x['code'], x['id']))
        return {'schema_version': VERSION, 'authority': 'none; read-only diagnostic, not SSOT or permission',
                'workspace': str(self.root), 'repositories': self.repos,
                'documents': [{k: v for k, v in doc.items() if k != 'text'} for _, doc in sorted(self.docs.items())],
                'excluded_named_documents': [{'path': p, **v, 'activation': 'not reached or non-active identity; body not audited'} for p, v in sorted(self.files.items()) if Path(p).name in ENTRY_NAMES and p not in self.docs],
                'edges': self.edges, 'context': cost, 'behavior_baseline': baseline,
                'export_contexts': self.export_contexts,
                'coverage': dict(self.checked), 'summary': dict(Counter(f['severity'] for f in self.findings)),
                'findings': self.findings,
                'limits': ['Only initialized tracked Git roots and reachable governance documents; untracked/orphan material is not automatically active.',
                           'Conditional templates and released/archive bodies are classified but not merged into the current rule set.',
                           'Heuristic semantics are candidates; no claim of exhaustive contradiction detection or semantic PASS.',
                           'External URLs, host/global skills, arbitrary embedded code and dynamic includes are not executed or validated.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace-root', required=True)
    parser.add_argument('--format', choices=['json', 'text'], default='json')
    parser.add_argument('--max-documents', type=int, default=500)
    parser.add_argument('--context-limit', type=int, default=12000)
    args = parser.parse_args()
    try:
        if args.max_documents < 1 or args.context_limit < 1:
            raise ValueError('Limits must be positive')
        report = Audit(args.workspace_root, args.max_documents, args.context_limit).run()
    except (OSError, ValueError, KeyError, TypeError, UnicodeError) as exc:
        print(json.dumps({'severity': 'error', 'code': 'audit-unavailable', 'message': str(exc), 'authority': 'none'}, ensure_ascii=False))
        return 2
    if args.format == 'json':
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print('Read-only collaboration audit: ' + json.dumps(report['summary'], ensure_ascii=False))
        for item in report['findings']:
            print(item['severity'].upper(), item['code'], item['message'])
            for ev in item['evidence']:
                print('  %s:%s %s' % (ev['path'], ev['line'], ev['excerpt']))
    return 1 if report['summary'].get('error') else 0


if __name__ == '__main__':
    sys.exit(main())
