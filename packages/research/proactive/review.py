"""Read actual weekly run receipts; never schedule tasks or infer missing outcomes."""
import argparse
from datetime import date, datetime
import hashlib
import importlib.util
import json
from pathlib import Path

_cost_spec = importlib.util.spec_from_file_location('research_cost', Path(__file__).with_name('cost.py'))
_cost_module = importlib.util.module_from_spec(_cost_spec)
_cost_spec.loader.exec_module(_cost_module)
summarize_cost = _cost_module.summarize

ROUTES = ('research', 'game-research')


def local_file(base, value):
    path = (base / value).resolve(strict=True)
    if not path.is_relative_to(base.resolve()) or not path.is_file():
        raise ValueError('Evidence must be a file within its record directory')
    return path


def status(runs, reviews):
    completed = {}
    for path in sorted(runs.glob('*.json')):
        item = json.loads(path.read_text(encoding='utf-8-sig'))
        if item.get('kind') != 'weekly_research_run':
            continue
        if item.get('trigger') != 'weekly' or item.get('status') != 'completed':
            continue
        if item.get('schema_version') != 1 or item.get('route') not in ROUTES:
            raise ValueError('Unknown weekly run schema or route: ' + path.name)
        scheduled = date.fromisoformat(item['scheduled_date'])
        stamp = datetime.fromisoformat(item['completed_at'].replace('Z', '+00:00'))
        if stamp.tzinfo is None or stamp.date() < scheduled:
            raise ValueError('Completion needs an actual timezone-aware timestamp')
        report = local_file(runs, item['report'])
        if report.suffix != '.md' or not report.read_text(encoding='utf-8-sig').strip():
            raise ValueError('Completed run needs a nonempty research report')
        key = item['route'] + ':' + item['scheduled_date']
        if key in completed:
            raise ValueError('Repeated execution in the same route/scheduled date: ' + key)
        cost_path = runs / (item['scheduled_date'] + '-' + item['route'] + '.cost.json')
        cost = 'unknown'
        if cost_path.exists():
            cost = summarize_cost(json.loads(local_file(runs, cost_path.name).read_text(encoding='utf-8-sig')))
            if cost['run_key'] != key:
                raise ValueError('Cost trace belongs to another scheduled run')
        completed[key] = {'key': key, 'receipt': path.name, 'report': item['report'],
                          'receipt_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                          'metrics': item.get('metrics', {}),
                          'tool_usage': item.get('tool_usage', 'unknown'),
                          'model_decision': item.get('model_decision', 'unknown'),
                          'tool_health': item.get('tool_health', 'unknown'),
                          'cost_trace': cost,
                          'cadence_assessment': item.get('cadence_assessment', {})}
    reviewed = set()
    for path in sorted(reviews.glob('*.json')):
        item = json.loads(path.read_text(encoding='utf-8-sig'))
        if item.get('kind') != 'weekly_research_review':
            continue
        if item.get('schema_version') != 1 or item.get('status') not in ('recorded', 'awaiting_decision'):
            raise ValueError('Invalid review record')
        report = local_file(reviews, item['report'])
        if report.suffix != '.md' or not report.read_text(encoding='utf-8-sig').strip():
            raise ValueError('Review requires an actual report')
        keys = item.get('run_keys', [])
        if len(keys) != 8 or len(set(keys)) != 8:
            raise ValueError('Joint review requires four actual runs per route')
        if any(key not in completed or key in reviewed for key in keys):
            raise ValueError('Review contains absent or previously reviewed runs')
        if any(sum(key.startswith(route + ':') for key in keys) != 4 for route in ROUTES):
            raise ValueError('Joint review must cover both routes equally')
        reviewed.update(keys)
    available = {route: sorted(key for key in completed if key.startswith(route + ':') and key not in reviewed)
                 for route in ROUTES}
    due = all(len(available[route]) >= 4 for route in ROUTES)
    selected = [key for route in ROUTES for key in available[route][:4]] if due else []
    return {'schema_version': 1, 'status': 'review_due' if due else 'observing',
            'completed_counts': {route: sum(k.startswith(route + ':') for k in completed) for route in ROUTES},
            'unreviewed_counts': {route: len(available[route]) for route in ROUTES},
            'remaining': {route: max(0, 4 - len(available[route])) for route in ROUTES},
            'selected_runs': [completed[key] for key in selected],
            'boundary': 'Missing adoption, human effort or cost stays unknown. Do not count manual pilots, blocked attempts or repeated scheduled dates; do not automatically change sources or frequency.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=Path, default=Path(__file__).parent / 'runs')
    parser.add_argument('--reviews', type=Path, default=Path(__file__).parent / 'reviews')
    args = parser.parse_args()
    try:
        print(json.dumps(status(args.runs, args.reviews), ensure_ascii=False, indent=2))
    except (ValueError, KeyError, OSError) as error:
        parser.exit(2, str(error) + '\n')
