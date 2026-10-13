"""Real localhost/stdio smoke and diagnostic cases. No private project inputs."""
import argparse
import asyncio
import json
import math
from pathlib import Path
import statistics
import time

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from local_runtime import BASE, predict, request, status, stop


def fixtures():
    topic = {'topic': {'type': 'choice', 'instructions': '按反馈明确指出的问题分类；无法判断时选unknown。',
                      'criteria': {'combat': '攻击、战斗操作的问题', 'ui': '界面文字、按钮显示的问题', 'unknown': '没有足够信息确定问题'}}}
    rows = []
    for name, text, label in [
        ('combat', '攻击按键按下后经常没有响应，希望改善攻击操作。', 'combat'),
        ('ui', '菜单文字太小，装备面板上的按钮也看不清。', 'ui'),
        ('negation-ui', '不是攻击操作的问题，我说的是菜单文字太小。', 'ui'),
        ('negation-combat', '菜单文字没问题，真正的问题是攻击按键经常失灵。', 'combat'),
        ('missing', '不知道怎么描述，总之有点奇怪。', 'unknown'),
    ]:
        rows.append({'id': name, 'request': {'state': {'feedback': text}, 'questions': topic}, 'expected': {'topic': label}})
    questions = {
        'can_enter': {'type': 'noul', 'instructions': '只有玩家持有钥匙且门未损坏才能开门。条件满足吗？'},
        'action': {'type': 'choice', 'instructions': '按条件选择：持有钥匙且门未损坏才开门，否则等待。',
                   'criteria': {'open': '开门', 'wait': '等待'}},
    }
    for name, key, broken, expected in [('eligible', True, False, True), ('no-key', False, False, False), ('broken', True, True, False)]:
        rows.append({'id': name, 'request': {'state': {'持有钥匙': key, '门已损坏': broken}, 'questions': questions},
                     'expected': {'can_enter': 'yes' if expected else 'no', 'action': 'open' if expected else 'wait'}})
    return rows


def validate(result):
    assert result['advisory_only'] is True
    assert result['calibration']['status'] == 'unfitted-HF'
    for answer in result['answers'].values():
        probabilities = answer['probabilities']
        assert probabilities and all(math.isfinite(v) and 0 <= v <= 1 for v in probabilities.values())
        assert abs(sum(probabilities.values()) - 1) < 1e-4


async def run(output, status_only):
    output.mkdir(parents=True, exist_ok=True)
    report = {'kind': 'synthetic-diagnostic-not-general-benchmark', 'before': status(), 'cases': []}
    params = StdioServerParameters(command=str(BASE / 'runtime/client/Scripts/python.exe'),
        args=['-X', 'utf8', '-B', str(BASE / 'mcp_server.py')])
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            initialized = await session.initialize()
            report['mcp_protocol'] = initialized.protocolVersion
            catalog = await session.list_tools()
            report['tools'] = [t.name for t in catalog.tools]
            assert set(report['tools']) == {'decision_status', 'decision_predict', 'decision_unload'}
            first = await session.call_tool('decision_status', {})
            assert not first.isError
            report['mcp_status'] = first.model_dump(mode='json')
            if not status_only:
                cases = fixtures()
                (output / 'inputs.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
                for index, item in enumerate(cases):
                    start = time.perf_counter()
                    if index == 0:
                        called = await session.call_tool('decision_predict', item['request'])
                        assert not called.isError, called
                        result = called.structuredContent
                        if not result:
                            result = json.loads(next(c.text for c in called.content if c.type == 'text'))
                        transport = 'independent-stdio-MCP'
                    else:
                        result = predict(**item['request'])
                        transport = 'HTTP'
                    elapsed = (time.perf_counter()-start)*1000
                    validate(result)
                    if index == 0:
                        report['after_first_mcp_predict'] = status()
                    got = {field: answer.get('choice', 'yes' if answer.get('noul', 0) >= .5 else 'no') for field, answer in result['answers'].items()}
                    report['cases'].append({'id': item['id'], 'transport': transport, 'elapsed_ms': round(elapsed, 2),
                        'expected': item['expected'], 'got': got, 'correct': got == item['expected'], 'result': result})
                    print(item['id'], got, round(elapsed, 1), 'ms', flush=True)
                report['loaded'] = status()
                assert report['loaded']['pid'] == report['after_first_mcp_predict']['pid']
                score_request = json.loads((output.parent/'score-input.json').read_text(encoding='utf-8'))
                score_result = predict(**score_request)
                validate(score_result)
                assert 0 <= score_result['answers']['severity']['score'] <= 2
                report['score_smoke'] = score_result
                # Validate actual service boundaries, not a mirrored unit implementation.
                rejects = []
                invalid = [
                    ('images', {'state': {}, 'questions': cases[0]['request']['questions'], 'images': ['private.png']}),
                    ('empty-questions', {'state': {}, 'questions': {}}),
                    ('reserved-marker', {'state': {'text': '<decision>'}, 'questions': cases[0]['request']['questions']}),
                    ('embedded-answer', {'state': {}, 'questions': {'q': {'type': 'noul', 'instructions': 'Test', 'answer': {'label': 'yes'}}}}),
                    ('overlength', {'state': {'text': '测试内容。'*3000}, 'questions': cases[0]['request']['questions']}),
                ]
                import httpx
                for name, payload in invalid:
                    try:
                        request('POST', '/v1/decisions', payload)
                        raise AssertionError('Invalid input accepted: ' + name)
                    except httpx.HTTPStatusError as e:
                        assert e.response.status_code in {413, 422}
                        rejects.append({'case': name, 'status': e.response.status_code})
                report['rejections'] = rejects
                from local_runtime import URL, connection
                with httpx.Client(trust_env=False) as client:
                    unauth = client.get(URL+'/health')
                    origin = client.get(URL+'/health', headers={'Authorization': 'Bearer '+connection()['token'], 'Origin': 'https://example.com'})
                assert unauth.status_code == 401 and origin.status_code == 403
                report['access_boundaries'] = {'unauthenticated': unauth.status_code, 'browser_origin': origin.status_code}
                warm = [c['elapsed_ms'] for c in report['cases'][1:]]
                report['summary'] = {'case_correct': sum(c['correct'] for c in report['cases']), 'case_total': len(cases),
                    'warm_http_median_ms': round(statistics.median(warm), 2), 'warm_http_max_ms': max(warm),
                    'cold_mcp_including_startup_ms': report['cases'][0]['elapsed_ms']}
                unloaded = await session.call_tool('decision_unload', {})
                assert not unloaded.isError
                deadline = time.monotonic()+15
                while status().get('model_loaded') and time.monotonic() < deadline:
                    await asyncio.sleep(.5)
                report['after_unload'] = status()
                assert not report['after_unload']['model_loaded']
    (output/'receipt.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report.get('summary', {'status_only': True}), ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--status-only', action='store_true')
    args = parser.parse_args()
    asyncio.run(run(args.output, args.status_only))
