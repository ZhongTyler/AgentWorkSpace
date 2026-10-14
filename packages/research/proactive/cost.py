"""Record observed phase boundaries, not inferred model activity or billing."""
import argparse
from datetime import date, datetime, timezone
import json
import os
from pathlib import Path
import uuid

ROUTES = ('research', 'game-research')
PHASES = ('discovery', 'ingestion', 'review', 'content_repair', 'workflow_recovery',
          'coordination_wait', 'approval_wait', 'closure', 'unallocated')


def timestamp(value):
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('Phase timestamps must include a timezone')
    return stamp


def summarize(trace):
    if trace.get('schema_version') != 1 or trace.get('kind') != 'research_cost_trace':
        raise ValueError('Unknown cost trace schema')
    if trace.get('route') not in ROUTES:
        raise ValueError('Unknown research route')
    date.fromisoformat(trace['scheduled_date'])
    events = trace['events']
    if not events or events[0].get('phase') not in PHASES:
        raise ValueError('Cost trace needs an observed initial phase')
    durations = {phase: 0.0 for phase in PHASES}
    intervals = []
    for index, event in enumerate(events):
        current = timestamp(event['at'])
        if event.get('phase') not in (*PHASES, None):
            raise ValueError('Unknown cost phase')
        if event.get('resumed', False) not in (True, False):
            raise ValueError('Invalid resume marker')
        if event.get('phase') is None and index != len(events) - 1:
            raise ValueError('Closed cost trace cannot accept later events')
        if index:
            previous = events[index - 1]
            seconds = (current - timestamp(previous['at'])).total_seconds()
            if seconds < 0:
                raise ValueError('Cost events must be chronological')
            # An interrupted host gives no evidence for the gap since its last mark.
            phase = 'unallocated' if event.get('resumed') else previous['phase']
            durations[phase] += seconds
            intervals.append({'start': previous['at'], 'end': event['at'], 'phase': phase,
                              'seconds': seconds, 'declared_phase': previous['phase']})
    closed = events[-1].get('phase') is None
    span = (timestamp(events[-1]['at']) - timestamp(events[0]['at'])).total_seconds()
    return {'schema_version': 1, 'run_key': trace['route'] + ':' + trace['scheduled_date'],
            'status': 'closed' if closed else 'open',
            'coverage': 'partial' if not closed or durations['unallocated'] else 'observed_boundaries',
            'first_observed_at': events[0]['at'], 'last_observed_at': events[-1]['at'],
            'observed_span_seconds': span,
            'phase_seconds': {p: round(v, 6) for p, v in durations.items()},
            'intervals': intervals, 'open_phase': None if closed else events[-1]['phase'],
            'active_model_seconds': None, 'human_minutes': None, 'monetary_cost': None,
            'boundary': 'Observed phase wall-clock only; includes in-phase tool waits. '
                        'Not CPU/model active time, human review minutes, billing or proof of run completion. '
                        'Outside the first/last marks and an open tail remain unmeasured. '
                        'Parallel agents are not summed; interrupted gaps are unallocated.'}


def record(path, route, scheduled_date, phase, evidence=None, resumed=False, now=None):
    date.fromisoformat(scheduled_date)
    if route not in ROUTES or phase not in (*PHASES, None):
        raise ValueError('Unknown route or phase')
    if path.exists():
        trace = json.loads(path.read_text(encoding='utf-8-sig'))
        summary = summarize(trace)
        if summary['run_key'] != route + ':' + scheduled_date:
            raise ValueError('Cost trace belongs to another scheduled run')
        if summary['status'] == 'closed':
            raise ValueError('Closed cost trace is preserved; do not restart or rewrite history')
    else:
        if phase is None or resumed:
            raise ValueError('Start with a phase; absent historical measurements cannot be recovered')
        trace = {'schema_version': 1, 'kind': 'research_cost_trace',
                 'route': route, 'scheduled_date': scheduled_date, 'events': []}
    event = {'at': now or datetime.now(timezone.utc).isoformat(), 'phase': phase}
    if evidence:
        event['evidence'] = evidence
    if resumed:
        event['resumed'] = True
    trace['events'].append(event)
    summary = summarize(trace)  # Validate before any write; failed changes preserve bytes.
    path.parent.mkdir(parents=True, exist_ok=True)
    scratch = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        scratch.write_text(json.dumps(trace, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        os.replace(scratch, path)
    finally:
        scratch.unlink(missing_ok=True)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('mark', 'finish', 'summary'))
    parser.add_argument('--route', required=True, choices=ROUTES)
    parser.add_argument('--scheduled-date', required=True)
    parser.add_argument('--phase', choices=PHASES)
    parser.add_argument('--evidence')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--runs', type=Path, default=Path(__file__).parent / 'runs')
    args = parser.parse_args()
    try:
        date.fromisoformat(args.scheduled_date)
        # ISO roundtrip also prevents alternate filenames / path traversal.
        if date.fromisoformat(args.scheduled_date).isoformat() != args.scheduled_date:
            raise ValueError('Use YYYY-MM-DD scheduled date')
        path = args.runs / (args.scheduled_date + '-' + args.route + '.cost.json')
        if args.action == 'summary':
            result = summarize(json.loads(path.read_text(encoding='utf-8-sig')))
            if result['run_key'] != args.route + ':' + args.scheduled_date:
                raise ValueError('Cost trace belongs to another scheduled run')
        else:
            if args.action == 'mark' and not args.phase:
                raise ValueError('mark requires --phase')
            if args.action == 'finish' and args.phase:
                raise ValueError('finish cannot start a phase')
            result = record(path, args.route, args.scheduled_date,
                            args.phase if args.action == 'mark' else None,
                            args.evidence, args.resume)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    main()
