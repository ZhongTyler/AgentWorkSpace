"""B1 执行契约 v1：纯检查，不执行动作，不写项目状态或 WSO runtime。

契约须由已获授权的调用方从可信用户事件和项目入口装配。
本模块验证这些输入的一致性，不能仅凭 JSON 自证用户授权的真实性。
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

OPERATIONS = {'read', 'edit', 'commit', 'push', 'transition'}
ROOT_FIELDS = {'contract_version', 'owner', 'scope', 'grants', 'source_refs', 'protected', 'checks', 'actions'}
HASH = re.compile(r'^[0-9a-f]{64}$')


def issue(code: str, target: str, message: str) -> dict:
    return {'code': code, 'target': target, 'message': message}


def relative_path(value: Any) -> str:
    if not isinstance(value, str) or not value or '\\' in value:
        raise ValueError('Path must be a nonempty Git relative path using slash separators')
    parts = value.split('/')
    if any(part in {'', '.', '..'} or part.casefold() == '.git' for part in parts) or re.search(r'[<>:"|?*\x00-\x1f]', value):
        raise ValueError('Unsafe or ambiguous relative path: ' + value)
    return value


def target_key(value: Any) -> tuple[str, str]:
    if not isinstance(value, dict) or set(value) != {'repository', 'path'}:
        raise ValueError('Target requires exactly repository and path')
    repository = value['repository']
    if not isinstance(repository, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]*', repository):
        raise ValueError('Unsafe repository identity')
    return repository, relative_path(value['path'])


def in_scope(target: tuple[str, str], scopes: list[tuple[str, str]]) -> bool:
    return any(target[0] == repo and (target[1] == path or target[1].startswith(path + '/')) for repo, path in scopes)


def evaluate(contract: dict, action_id: str, observed: dict) -> dict:
    """每次只判断一个冻结动作；未决依赖不阻断其他已授权动作。"""
    problems = []
    reused = []
    try:
        if not isinstance(contract, dict) or type(contract.get('contract_version')) is not int or contract['contract_version'] != 1:
            return {'allowed': False, 'issues': [issue('CONTRACT_VERSION', 'contract_version', 'Explicit compatibility adapter required')], 'reused_checks': []}
        if set(contract) - ROOT_FIELDS or not isinstance(contract.get('owner'), str) or not contract['owner'].strip():
            raise ValueError('Unknown contract field or missing owner')
        scopes = [target_key(item) for item in contract.get('scope', [])]
        grants = contract.get('grants', {})
        if not isinstance(grants, dict) or any(key not in OPERATIONS or not isinstance(value, str) or not value.strip() for key, value in grants.items()):
            raise ValueError('Grants require explicit operation and trusted evidence reference, not a truthy flag')
        actions = contract.get('actions', {})
        action = actions[action_id]
        if not isinstance(action, dict) or set(action) - {'operation', 'paths', 'requires', 'context_refs'}:
            raise ValueError('Unknown action field')
        operation = action['operation']
        if operation not in OPERATIONS:
            raise ValueError('Unsupported operation')
        if operation not in grants:
            problems.append(issue('AUTHORITY_REQUIRED', operation, 'No existing grant for this operation'))
        paths = [target_key(item) for item in action.get('paths', [])]
        protected = contract.get('protected', {})
        if not isinstance(protected, dict):
            raise ValueError('Protected snapshots must be an object')
        if operation != 'read':
            if not paths:
                problems.append(issue('SCOPE_REQUIRED', action_id, 'Mutation requires an explicit target set'))
            for target in paths:
                if not in_scope(target, scopes):
                    problems.append(issue('OUT_OF_SCOPE', '/'.join(target), 'Target is outside the task scope'))
            for identifier, snapshot in protected.items():
                if not isinstance(snapshot, dict) or set(snapshot) != {'target', 'index_oid', 'worktree_sha256'}:
                    raise ValueError('Protected entry requires target, index_oid and worktree_sha256')
                target = target_key(snapshot['target'])
                if any(in_scope(path, [target]) or in_scope(target, [path]) for path in paths):
                    problems.append(issue('OWNER_CONFLICT', identifier, 'Requested mutation overlaps a preserved owner path'))
                current = observed.get('protected', {}).get(identifier)
                if current != snapshot:
                    problems.append(issue('PRESERVATION_UNPROVEN', identifier, 'Current protected index and worktree must match their captured bytes'))
        source_refs = contract.get('source_refs', {})
        source_hashes = observed.get('source_hashes', {})
        for reference in action.get('context_refs', []):
            expected = source_refs[reference]
            if not isinstance(expected, str) or not HASH.fullmatch(expected):
                raise ValueError('Frozen source reference must be a SHA-256')
            if source_hashes.get(reference) != expected:
                problems.append(issue('CONTEXT_CHANGED', reference, 'Refresh this authority or project contract before its dependent action'))
        checks = contract.get('checks', {})
        records = observed.get('checks', {})
        visiting, validity = set(), {}

        def visit(identifier: str) -> bool:
            if identifier in validity:
                return validity[identifier]
            if identifier in visiting:
                raise ValueError('Validation dependency cycle: ' + identifier)
            definition = checks[identifier]
            if not isinstance(definition, dict) or set(definition) - {'kind', 'inputs', 'depends_on'}:
                raise ValueError('Unknown validation definition field')
            kind = definition['kind']
            if kind not in {'command', 'human', 'record'}:
                raise ValueError('Unsupported validation kind')
            problems_before = len(problems)
            visiting.add(identifier)
            dependencies_valid = [visit(dependency) for dependency in definition.get('depends_on', [])]
            visiting.remove(identifier)
            record = records.get(identifier)
            if not isinstance(record, dict) or record.get('status') != 'pass':
                code = 'HUMAN_GATE_PENDING' if kind == 'human' else 'DEPENDENCY_PENDING'
                problems.append(issue(code, identifier, 'Required evidence is missing, pending or failed'))
                validity[identifier] = False
                return False
            if not isinstance(record.get('evidence_ref'), str) or not record['evidence_ref'].strip():
                problems.append(issue('EVIDENCE_MISSING', identifier, 'A pass label is not an evidence reference'))
            if kind == 'command' and (type(record.get('exit_code')) is not int or record['exit_code'] != 0):
                problems.append(issue('COMMAND_FAILED', identifier, 'Required command must itself exit zero; wrapper status cannot replace it'))
            if kind == 'human' and record.get('actor') != 'user':
                problems.append(issue('HUMAN_GATE_PENDING', identifier, 'Only the trusted user decision source can attest this gate'))
            inputs = definition.get('inputs', [])
            if kind == 'human' and not inputs:
                problems.append(issue('SUBJECT_REQUIRED', identifier, 'Human acceptance must bind the reviewed subject'))
            for reference in inputs:
                current = source_hashes.get(reference)
                if not isinstance(current, str) or not HASH.fullmatch(current):
                    problems.append(issue('SOURCE_UNVERIFIED', reference, 'Current source bytes are not verified'))
                elif record.get('input_hashes', {}).get(reference) != current:
                    problems.append(issue('EVIDENCE_STALE', identifier, 'Evidence refers to different input bytes'))
            validity[identifier] = len(problems) == problems_before and all(dependencies_valid)
            if validity[identifier]:
                reused.append(identifier)
            return validity[identifier]

        for requirement in action.get('requires', []):
            visit(requirement)
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        problems.append(issue('CONTRACT_INVALID', action_id, str(error)))
    return {'allowed': not problems, 'issues': problems, 'reused_checks': reused}


def validate_commit_message(message: str) -> list[dict]:
    """验证完整提交消息；不靠后续 amend 修补已经绑定 receipt 的提交。"""
    if not isinstance(message, str) or not message.strip():
        return [issue('COMMIT_MISSING', 'message', 'No commit message')]
    lines = message.rstrip().splitlines()
    problems = []
    if not re.fullmatch(r'[a-z][a-z0-9-]*(\([^\r\n()]+\))?!?: .+', lines[0]):
        problems.append(issue('COMMIT_SUBJECT', 'subject', 'Conventional Commit subject required'))
    # 只接受最后一段 trailers；正文中的同名字样不是有效收尾字段。
    trailer_start = next((index + 1 for index in range(len(lines)-1, -1, -1) if not lines[index].strip()), 0)
    if trailer_start < 2:
        problems.append(issue('CLOSURE_TRAILER', 'paragraph', 'Closure trailers require a separate final paragraph'))
    trailer_lines = lines[trailer_start:]
    if any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*:\s+\S.*', line) for line in trailer_lines):
        problems.append(issue('CLOSURE_TRAILER', 'paragraph', 'The final paragraph must contain trailer lines only'))
    rules = {
        'Closure-Level': r'W[123]',
        'Closure-Domain': r'[a-z0-9][a-z0-9-]*',
        'Closure-Signals': r'[a-z0-9_]+(?:\s*,\s*[a-z0-9_]+)*',
        'Closure-Corrected': r'yes|no',
    }
    for name, pattern in rules.items():
        matches = [line.partition(':')[2].strip() for line in trailer_lines if line.partition(':')[0].casefold() == name.casefold()]
        if len(matches) != 1 or not re.fullmatch(pattern, matches[0]):
            problems.append(issue('CLOSURE_TRAILER', name, 'Exactly one valid trailer is required in the final paragraph'))
    return problems


def git_read(root: Path, *arguments: str) -> bytes:
    """只读 Git collector；命令失败立即抛出，不消费后续假定产物。"""
    process = subprocess.run(['git', '-c', 'safe.directory='+str(root.resolve()), '-C', str(root), *arguments], capture_output=True, check=False)
    if process.returncode:
        raise ValueError('Git read failed: ' + process.stderr.decode('utf-8', errors='replace'))
    return process.stdout


def verify_git_closure(repositories: dict, edges: list[dict]) -> dict:
    """对实际提交树验证本任务结果范围和每条直接父子边，忽略他人工作树状态。"""
    problems = []
    observed = {}
    try:
        expected_edges = {(spec['parent'], identity, relative_path(spec['gitlink_path'])) for identity, spec in repositories.items() if spec['parent'] is not None}
        supplied_edges = {(edge['parent'], edge['child'], relative_path(edge['path'])) for edge in edges}
        if len(edges) != len(supplied_edges) or expected_edges != supplied_edges:
            problems.append(issue('PARENT_CHAIN_INCOMPLETE', 'edges', 'Every declared direct parent edge is required exactly once'))
        roots = [identity for identity, spec in repositories.items() if spec['parent'] is None]
        if len(roots) != 1:
            problems.append(issue('PARENT_CHAIN_INVALID', 'repositories', 'One authoritative workspace root is required'))
        for identity in repositories:
            current, seen = identity, set()
            while current is not None:
                if current in seen:
                    raise ValueError('Parent cycle: '+identity)
                seen.add(current)
                current = repositories[current]['parent']
        for identity, spec in repositories.items():
            root = Path(spec['path'])
            base, result = spec['base'], spec['result']
            for revision in ((result,) if base is None else (base, result)):
                if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40,64}', revision):
                    raise ValueError('Full revision required: '+identity)
            git_read(root, 'merge-base', '--is-ancestor', result, 'HEAD')
            if base is None:
                parents = git_read(root, 'rev-list', '--parents', '-n', '1', result).decode().split()
                if parents != [result]:
                    raise ValueError('Null base requires a real parentless initial commit: '+identity)
                commits = [result]
                changed = git_read(root, 'ls-tree', '-r', '--name-only', '-z', result)
            else:
                git_read(root, 'merge-base', '--is-ancestor', base, result)
                commits = git_read(root, 'rev-list', base+'..'+result).decode().splitlines()
                changed = git_read(root, 'diff', '--name-only', '--no-renames', '-z', base, result, '--')
            if len(commits) != 1:
                problems.append(issue('RESULT_COMMIT_COUNT', identity, 'This minimal direct contract requires one own result commit'))
            for commit in commits:
                message = git_read(root, 'show', '-s', '--format=%B', commit).decode('utf-8')
                for problem in validate_commit_message(message):
                    problems.append({**problem, 'repository': identity, 'commit': commit})
            paths = [value.decode('utf-8') for value in changed.split(b'\x00') if value]
            scopes = [(identity, relative_path(path)) for path in spec['scope']]
            for path in paths:
                if not in_scope((identity, relative_path(path)), scopes):
                    problems.append(issue('COMMIT_SCOPE', identity+'/'+path, 'Committed path is not owned by this task'))
            observed[identity] = {'result': result, 'commits': commits, 'paths': paths}
        for edge in edges:
            parent, child = edge['parent'], edge['child']
            link_path = relative_path(edge['path'])
            tree = git_read(Path(repositories[parent]['path']), 'ls-tree', '-z', repositories[parent]['result'], '--', link_path)
            entries = [entry for entry in tree.split(b'\x00') if entry]
            expected = repositories[child]['result']
            if len(entries) != 1 or entries[0].split(b'\t', 1)[0].decode() != '160000 commit '+expected:
                problems.append(issue('PARENT_GITLINK', parent+'/'+link_path, 'Committed direct parent gitlink must match child result '+expected))
    except (KeyError, ValueError, TypeError, UnicodeError) as error:
        problems.append(issue('GIT_EVIDENCE_INVALID', 'closure', str(error)))
    return {'closed': not problems, 'issues': problems, 'repositories': observed}
