"""Static adapter for explicitly registered Python freeze-map construction.

Never import/eval a generator. Unsupported construction fails closed; this is
source-layout evidence, not proof that an artifact was built or is healthy.
"""
import ast
from pathlib import PurePosixPath
import posixpath


def output_path(value):
    if (not isinstance(value, str) or not value or '\\' in value or ':' in value
            or value.startswith('/') or any(p in ('', '.', '..') for p in value.split('/'))):
        raise ValueError('Non-canonical export path: ' + repr(value))
    return value


def link_output(source_output, path):
    if not path:
        return output_path(source_output)
    value = posixpath.normpath(posixpath.join(str(PurePosixPath(source_output).parent), path))
    return output_path(value)


def shape(node):
    return ast.dump(node, include_attributes=False)


def expression(text):
    return ast.parse(text, mode='eval').body


def path_value(node, engine):
    if isinstance(node, ast.Name) and node.id == 'engine':
        return engine
    if isinstance(node, ast.Attribute) and node.attr == 'parent':
        return path_value(node.value, engine).parent
    if (isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute)
            and node.value.attr == 'parents' and isinstance(node.slice, ast.Constant)
            and type(node.slice.value) is int and 0 <= node.slice.value < 8):
        parents = path_value(node.value.value, engine).parents
        if node.slice.value < len(parents):
            return parents[node.slice.value]
        raise ValueError('Export source parent is outside its path')
    if (isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div)
            and isinstance(node.right, ast.Constant) and isinstance(node.right.value, str)):
        return path_value(node.left, engine) / output_path(node.right.value)
    raise ValueError('Unsupported dynamic export source expression')


def python_freeze(generator, text, contained):
    tree = ast.parse(text)
    assignments = [node for node in tree.body if isinstance(node, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == 'TEMPLATES' for t in node.targets)]
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'freeze']
    if len(assignments) != 1 or len(functions) != 1:
        raise ValueError('Expected one literal TEMPLATES and freeze function')
    literal = assignments[0].value
    if not isinstance(literal, ast.Dict):
        raise ValueError('TEMPLATES must be a literal dictionary')
    templates = {}
    for key, value in zip(literal.keys, literal.values):
        target, source = output_path(ast.literal_eval(key)), output_path(ast.literal_eval(value))
        if target.casefold() in {p.casefold() for p in templates}:
            raise ValueError('Duplicate template output')
        templates[target] = source
    function = functions[0]
    expected = ast.parse('''def freeze(bundle, out):
    engine = Path(__file__).resolve().parent
    source = {"runtime/agenttrpg/" + name: engine / name for name in ENGINE_FILES}
''').body[0].body
    if len(function.body) < 4 or any(shape(a) != shape(b) for a, b in zip(function.body[:2], expected)):
        raise ValueError('Unsupported freeze source initialization')
    updates = []
    for node in function.body[2:]:
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
                and shape(node.value.func) == shape(expression('source.update'))):
            if len(node.value.args) != 1 or node.value.keywords:
                raise ValueError('Unsupported source update')
            updates.append(node.value.args[0])
    # Only the reviewed top-level construction may write source/TEMPLATES.
    allowed_updates = {id(node) for node in function.body[2:4]}
    parents = {id(child): parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)) and node.id in ('source', 'TEMPLATES'):
            if node not in assignments[0].targets and node not in function.body[1].targets:
                raise ValueError('Export map is reassigned')
        if isinstance(node, ast.Subscript) and isinstance(node.ctx, (ast.Store, ast.Del)):
            if isinstance(node.value, ast.Name) and node.value.id in ('source', 'TEMPLATES'):
                raise ValueError('Export map has a dynamic write')
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id in ('source', 'TEMPLATES'):
            parent = parents[id(node)]
            if isinstance(parent, ast.Attribute) and parent.value is node:
                call = parents.get(id(parent))
                statement = parents.get(id(call))
                readonly = parent.attr in ('items', 'keys', 'values')
                construction = parent.attr == 'update' and id(statement) in allowed_updates
                if not isinstance(call, ast.Call) or call.func is not parent or not (readonly or construction):
                    raise ValueError('Unsupported export map access')
            elif not ((isinstance(parent, ast.Subscript) and parent.value is node)
                      or (node.id == 'TEMPLATES' and isinstance(parent, ast.Starred))):
                raise ValueError('Export map alias/escape is not statically supported')
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name) and call.func.value.id in ('source', 'TEMPLATES'):
                if id(node) not in allowed_updates:
                    raise ValueError('Export map has an unsupported mutation')
    if len(updates) != 2 or not isinstance(updates[0], ast.DictComp) or not isinstance(updates[1], ast.Dict):
        raise ValueError('Unsupported freeze source updates')
    comp = updates[0]
    pattern = expression('{target: engine.parent / "package" / name for target, name in TEMPLATES.items()}')
    if (len(comp.generators) != 1 or shape(comp.key) != shape(pattern.key)
            or shape(comp.generators[0]) != shape(pattern.generators[0]) or not isinstance(comp.value, ast.BinOp)
            or not isinstance(comp.value.op, ast.Div) or shape(comp.value.right) != shape(expression('name'))):
        raise ValueError('Unsupported template copy mapping')
    template_root = contained(path_value(comp.value.left, generator.parent))
    outputs = {target: contained(template_root / name) for target, name in templates.items()}
    if len({str(p).casefold() for p in outputs.values()}) != len(outputs):
        raise ValueError('One source has multiple output locations')
    for key, value in zip(updates[1].keys, updates[1].values):
        target = output_path(ast.literal_eval(key))
        if target.casefold() in {p.casefold() for p in outputs}:
            raise ValueError('Duplicate export output')
        try:
            outputs[target] = contained(path_value(value, generator.parent))
        except ValueError:
            if target.endswith('.md'):
                raise
            outputs[target] = None  # e.g. caller-supplied content.json; no false verification
    return template_root, {outputs[target]: target for target in templates if target.endswith('.md')}, outputs
