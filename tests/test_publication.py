"""Read-only source export contract, also callable by each source repository."""
import argparse
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from publish import export, git, inventory, stage
from workspace import ContractError, encoded


def verify(source):
    source = source.absolute()
    before = git(source, 'status', '--porcelain', '--untracked-files=all', '--ignore-submodules=all')
    with tempfile.TemporaryDirectory(prefix='agentworkspace-publication-contract-') as temporary:
        base = Path(temporary)
        output = base / 'prepared'
        output.mkdir()
        manifest, dirty = stage(source, output)
        files = inventory(output)
        expected = manifest.get('expected_file_count_without_marker', manifest.get('expected_file_count')) + 1
        assert len(files) == expected, 'Explicit inventory plus provenance marker must match'
        for name in files:
            assert not name.startswith(('sessions/', 'workspace/sessions/', '.git/', 'runtime/')), name
            if (output / name).suffix.lower() in {'.png', '.wav', '.ogg', '.ttf', '.otf', '.jpg', '.webp'}:
                continue
            if manifest['component_id'] == 'research' and name.startswith('integrations/mcp/vendor/') and name.endswith(('.tgz', '.tar.gz')):
                continue
            text = (output / name).read_text(encoding='utf-8-sig')
            assert 'C:\\Users\\Admin' not in text and 'E:\\TylerWorkSpace' not in text and 'E:/TylerWorkSpace' not in text, name
        invalid = base / 'invalid-source'
        (invalid / 'release-input').mkdir(parents=True)
        broken = json.loads(json.dumps(manifest))
        broken['copy_files'].insert(0, {'source': 'release-input/curated/../../../escape', 'target': 'escape'})
        (invalid / 'release-input/manifest.json').write_bytes(encoded(broken))
        refused = base / 'refused'
        refused.mkdir()
        try:
            stage(invalid, refused)
        except ContractError:
            pass
        else:
            raise AssertionError('Escaping source was accepted')
        if dirty:
            target = base / 'distribution'
            (target / 'scripts').mkdir(parents=True)
            (target / 'scripts/workspace.py').write_text('# fixture\n')
            (target / 'AGENTS.md').write_text('# fixture\n')
            try:
                export(source, target, True)
            except ContractError as error:
                assert 'Commit source' in str(error), str(error)
            else:
                raise AssertionError('Dirty source was published')
            assert not (target / manifest['output_path']).exists()
    assert before == git(source, 'status', '--porcelain', '--untracked-files=all', '--ignore-submodules=all'), 'Source mutated during export contract'
    print(json.dumps({'component': manifest['component_id'], 'files': expected, 'source_unchanged': True, 'preview_validated': True, 'source_escape_rejected': True, 'dirty_apply_rejected': dirty}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    verify(parser.parse_args().source)
