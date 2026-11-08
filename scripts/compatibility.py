"""Read-only capability audit. Existing providers are reviewed data, never commands."""
from pathlib import Path
import re
from urllib.parse import quote

from workspace import ContractError, STATE, digest, encoded, load, package_name, read, safe, state

BRIDGE = 'agent-workspace-compatibility.md'

PACKAGE_REVIEW_CRITERIA = {
    'responsibility-overlap': 'Compare the requested task and existing module/workflow responsibilities; reuse capabilities before recommending duplicates.',
    'inputs-outputs-and-entrypoints': 'Review actual inputs, outputs, protocols, invocation and navigation; matching names do not prove interoperability.',
    'authority-and-data-ownership': 'Keep host decisions, user data, directories and state ownership explicit; do not create competing sources of truth.',
    'integration-and-recovery': 'Propose a case-specific boundary and reversible next step; unresolved integration is not approval to merge, replace or migrate.'
}


def contract(incoming):
    value = incoming.get('compatibility')
    if not isinstance(value, dict) or value.get('schema_version') != 1:
        raise ContractError('This release has no supported compatibility contract')
    capabilities, components = value.get('capabilities', {}), value.get('components', {})
    if set(components) != set(incoming['components']) or not capabilities:
        raise ContractError('Compatibility component inventory differs')
    for capability, definition in capabilities.items():
        if not re.fullmatch(r'[a-z][a-z0-9-]*', capability) or not definition.get('criteria'):
            raise ContractError('Malformed capability criteria')
    for item in components.values():
        for key in ('provides', 'requires', 'optional'):
            if not isinstance(item.get(key), list) or not set(item[key]) <= set(capabilities):
                raise ContractError('Unknown capability in dependency contract')
    if not set(value.get('needs', {}).values()) <= set(capabilities):
        raise ContractError('Unknown need capability')
    return value


def reviewed_providers(target, definition, profile):
    if profile is None:
        return []
    value = load(profile) if isinstance(profile, Path) else profile
    if not isinstance(value, dict) or set(value) != {'schema_version', 'providers'} or value['schema_version'] != 1 or not isinstance(value['providers'], list):
        raise ContractError('Unsupported existing-workspace profile')
    ids, providers = set(), []
    for item in value['providers']:
        if not isinstance(item, dict) or not re.fullmatch(r'[a-z][a-z0-9-]*', item.get('id', '')) or item['id'] in ids:
            raise ContractError('Provider needs a unique portable ID')
        ids.add(item['id'])
        capabilities = item.get('capabilities')
        if not isinstance(capabilities, list) or not capabilities or not set(capabilities) <= set(definition['capabilities']):
            raise ContractError('Unknown provider capability')
        if item.get('assurance') != 'reviewed' or not isinstance(item.get('reason'), str) or not item['reason'].strip():
            raise ContractError('Existing substitutes need an explicit semantic review and reason')
        if not isinstance(item.get('checks'), dict):
            raise ContractError('Provider review needs a criteria map')
        for capability in capabilities:
            if set(item.get('checks', {}).get(capability, [])) != set(definition['capabilities'][capability]['criteria']):
                raise ContractError('Provider review does not cover every required criterion: ' + capability)
        evidence = item.get('evidence')
        if not isinstance(evidence, list) or not evidence:
            raise ContractError('Existing substitute needs local evidence')
        for entry in evidence:
            if not isinstance(entry, dict) or set(entry) != {'path', 'sha256'}:
                raise ContractError('Evidence requires a local path and its checksum')
            path = safe(target, entry['path'])
            if entry['path'].casefold().startswith(('.git/', '.agent-workspace/')) or path.name == '.git':
                raise ContractError('Provider evidence must be a workspace document, not installation metadata')
            if not re.fullmatch(r'[0-9a-f]{64}', entry.get('sha256', '')) or digest(read(path)) != entry['sha256']:
                raise ContractError('Provider evidence changed or is missing: ' + entry['path'])
        providers.append(item)
    return providers


def candidates(target):
    """Bounded entry-document discovery; never execute modules or scan user content."""
    names = ['AGENTS.md', 'README.md', 'COMMAND_MANUAL.md', 'AI_INDEX.md']
    def entries(folder):
        if not folder.is_dir():
            return []
        return [child for child in sorted(folder.iterdir())
                if not child.name.startswith('.') and child.name not in ('node_modules', 'vendor')
                and child.is_dir() and not child.is_symlink()
                and not getattr(child.lstat(), 'st_file_attributes', 0) & 0x400][:100]
    # Modules can live outside modules/, and workflows can be distributed as skills.
    for folder in (target, safe(target, 'modules')):
        for child in entries(folder):
            names.extend((child / name).relative_to(target).as_posix() for name in ('README.md', 'AGENTS.md'))
    for name in ('.agents/skills', '.claude/skills'):
        try:
            folder = safe(target, name)
            for child in entries(folder):
                names.append((child / 'SKILL.md').relative_to(target).as_posix())
        except ContractError:
            continue
    found = []
    for name in dict.fromkeys(names):
        try:
            path = safe(target, name)
            if path.is_file():
                found.append({'path': name, 'sha256': digest(read(path)), 'assurance': 'candidate-only'})
        except ContractError:
            continue
    return found


def package_reviews(definition, selected, recommended, providers, installed_valid):
    """Queue semantic review; provider evidence is not a package integration decision."""
    review_components = selected | {item['component'] for item in recommended}
    reviews = []
    for name in sorted(review_components - {'meta'}):
        provides = set(definition['components'][name]['provides'])
        overlaps = [{'provider': item['id'], 'capabilities': sorted(provides & set(item['capabilities'])),
                     'evidence': item['evidence']} for item in providers if provides & set(item['capabilities'])]
        reviews.append({'component': name, 'selection': 'selected' if name in selected else 'recommended',
                        'provides': sorted(provides), 'assurance': 'needs-agent-review',
                        'installed_baseline': name in installed_valid, 'existing_providers': overlaps})
    return reviews


def audit(incoming, target, packages, needs=(), profile=None):
    definition = contract(incoming)
    installed = state(target)
    selected = set((installed or {}).get('components', {})) | {package_name(name, incoming) for name in packages}
    if not selected <= set(incoming['components']):
        raise ContractError('Unknown selected component')
    if not set(needs) <= set(definition['needs']):
        raise ContractError('Unknown need; choose: ' + ', '.join(sorted(definition['needs'])))
    if profile is None and installed and installed.get('mode') == 'compatible':
        profile = installed.get('profile')
    providers = reviewed_providers(target, definition, profile)
    available = {}
    for item in providers:
        for capability in item['capabilities']:
            available.setdefault(capability, []).append({'provider': item['id'], 'assurance': 'reviewed-substitute', 'evidence': item['evidence']})
    # Existing managed components must still have their declared baseline bytes.
    installed_valid = set()
    for name in (installed or {}).get('components', {}):
        owned = [(path, item) for path, item in installed['files'].items() if item['component'] == name and path != BRIDGE]
        if owned and all(digest(read(safe(target, path))) == item['sha256'] for path, item in owned):
            installed_valid.add(name)
        external = (installed or {}).get('external_modules', {}).get(name)
        if external:
            from federation import external_valid
            if external_valid(target, external):
                installed_valid.add(name)
    for name in selected:
        # Newly selected components will be installed; modified existing providers need review.
        if name not in (installed or {}).get('components', {}) or name in installed_valid:
            for capability in definition['components'][name]['provides']:
                available.setdefault(capability, []).append({'provider': name, 'assurance': 'selected-package' if name not in installed_valid else 'installed-baseline'})
    required, reuse = [], []
    for name in sorted(selected):
        for capability in definition['components'][name]['requires']:
            if capability in available:
                reuse.append({'component': name, 'capability': capability, 'providers': available[capability]})
            else:
                options = [key for key, item in definition['components'].items() if capability in item['provides']]
                required.append({'required_by': name, 'capability': capability, 'install_options': options, 'alternative': 'Review an existing equivalent provider'})
    recommended = []
    for need in sorted(set(needs)):
        capability = definition['needs'][need]
        if capability in available:
            reuse.append({'need': need, 'capability': capability, 'providers': available[capability]})
        else:
            for name, item in definition['components'].items():
                if capability in item['provides']:
                    recommended.append({'component': name, 'need': need, 'reason': definition['capabilities'][capability]['description'], 'missing_if_selected': [dependency for dependency in item['requires'] if dependency not in available]})
    optional = [{'component': name, 'capabilities': definition['components'][name]['optional']} for name in sorted(selected) if definition['components'][name]['optional']]
    return {'mode': 'compatible', 'version': incoming['version'], 'selected': sorted(selected), 'required': required, 'recommended': recommended, 'optional': optional, 'reuse': reuse, 'candidates': candidates(target), 'criteria': definition['capabilities'], 'package_review': package_reviews(definition, selected, recommended, providers, installed_valid), 'package_review_criteria': PACKAGE_REVIEW_CRITERIA, 'profile': {'schema_version': 1, 'providers': providers}, 'ready': not required, 'writes': 0}


def bridge(selected, providers, external=None):
    lines = ['# Existing workspace integration / 已有工作区接入', '',
             'Read this entry when using the installed packages. / 使用接入包时读取此入口。', '',
             'Current user instructions and host rules keep authority. Package rules add domain requirements; this entry does not replace root AGENTS.md. / 当前用户指令与宿主规则保持权威；包只补领域要求，不替换根 AGENTS.md。', '',
             'Meta, when selected, is the complete edition under modules/meta. Read modules/meta/AGENTS.md as scoped supplemental guidance; its relative links refer to modules/meta, not the host root. Skills there are loaded explicitly as needed, not automatically registered. / 若选择 meta，完整版位于 modules/meta；其中相对引用以该目录为准，Skill 按需显式读取。', '',
             'Before adding or connecting a package, review similar host modules and workflows for responsibility overlap, inputs/outputs, entrypoints, authority, data ownership and recovery. A dependency profile or installed file baseline is not an integration decision. Reuse, coexistence and adapters are case-specific proposals, not automatic migrations. / 增加或接线业务包前，审阅现有同类模块和工作流的职责、输入输出、调用入口、权威、数据归属与恢复；依赖 profile 或文件基线不等于兼容决定。复用、并存或适配按实际需要提案，不自动迁移。', '',
             '## Installed components / 已装组件', '']
    for name in sorted(selected):
        location = (external or {}).get(name, {}).get('path', 'modules/' + name)
        entry = 'README.md' if location == '.' else location + '/README.md'
        lines.append('- [' + name + '](' + entry + ')')
    lines.extend(['', '## Reused host providers / 复用宿主能力', ''])
    for item in providers:
        # Render only validated identifiers and evidence links, never arbitrary review prose.
        lines.append('- ' + item['id'] + ': ' + ', '.join(item['capabilities']))
        lines.extend('  - [' + entry['path'].replace('[', '\\[').replace(']', '\\]') + '](' + quote(entry['path'], safe='/') + ')' for entry in item['evidence'])
    lines.extend(['', 'No existing module is executed or imported by the installer. Optional integrations still require their package protocol and task authorization. / 安装器不执行或导入已有模块；可选接线仍按对应协议和任务授权进行。', ''])
    return '\n'.join(lines).encode('utf-8')
