"""Text-only pilot around the pinned upstream HF engine. No external handoff."""
import json
import os
from pathlib import Path
import sys
import threading
import time

from fastapi import Depends, FastAPI, HTTPException, Request
import uvicorn

from local_runtime import BASE, IDENTITY, STATE

sys.path.insert(0, str(BASE / 'runtime/upstream'))
from src.inputs.schema import compile_row

lock = json.loads((BASE / 'source-lock.json').read_text(encoding='utf-8'))
token = json.loads(STATE.read_text(encoding='utf-8'))['token']
inference_lock = threading.Lock()
last_used = time.monotonic()
manager = None
server = None


def authorize(request: Request):
    import secrets
    if request.headers.get('origin'):
        raise HTTPException(403, 'Browser-origin requests are disabled in this pilot')
    if not secrets.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + token):
        raise HTTPException(401, 'Local service token required')


app = FastAPI(title='Research Local Decisions', dependencies=[Depends(authorize)])


@app.middleware('http')
async def bound_body(request: Request, call_next):
    if request.method == 'POST':
        from fastapi.responses import JSONResponse
        body = await request.body()
        if len(body) > 65536:
            return JSONResponse(status_code=413, content={'detail': 'Maximum request is 64KiB'})
    return await call_next(request)


@app.get('/health')
def health():
    import torch
    current = manager.name if manager else None
    current_lock = lock['model'] if current == 'intern' else (
        json.loads((BASE / (current + '-model-lock.json')).read_text(encoding='utf-8')) if current else {})
    return {'integration': IDENTITY, 'status': 'ready' if current else 'loading', 'model_loaded': bool(current),
            'pid': os.getpid(), 'backend': current,
            'model': current_lock.get('id', current_lock.get('model')), 'revision': current_lock.get('revision'),
            'device': str(manager.engine.backend.device) if current=='intern' else ('cpu' if current=='laya' else torch.cuda.get_device_name(0)),
            'resource_note': manager.resource_note if manager else None,
            'allocated_mib': round(torch.cuda.memory_allocated()/2**20, 1),
            'reserved_mib': round(torch.cuda.memory_reserved()/2**20, 1),
            'peak_allocated_mib': round(torch.cuda.max_memory_allocated()/2**20, 1),
            'allocation_scope': 'gateway PyTorch only; excludes owned llama.cpp child',
            'owned_llama_pid': manager.process.pid if manager and manager.process else None,
            'idle_unload_seconds': 600, 'calibration': 'backend-specific; not locally calibrated', 'text_only': True}


@app.post('/v1/decisions')
def decide(payload: dict):
    global last_used
    if set(payload) != {'state', 'questions'}:
        raise HTTPException(422, 'Only state and questions are accepted; no images, targets or URLs')
    questions = payload['questions']
    state = payload['state']
    backend = 'intern'
    if isinstance(state, dict) and '_research_decision' in state:
        if set(state) != {'_research_decision', 'payload'}:
            raise HTTPException(422, 'Backend envelope requires only _research_decision and payload')
        control = state['_research_decision']
        if not isinstance(control, dict) or set(control) - {'backend', 'purpose'}:
            raise HTTPException(422, 'Unknown backend control field')
        backend = control.get('backend', 'intern')
        if not isinstance(backend, str) or backend not in {'intern', 'laya', 'startlux'}:
            raise HTTPException(422, 'Unknown local backend')
        if backend == 'startlux' and control.get('purpose') != 'noncommercial_research':
            raise HTTPException(422, 'StartLux is restricted to explicit noncommercial_research')
        state = state['payload']
    if not isinstance(questions, dict) or not 1 <= len(questions) <= 8:
        raise HTTPException(422, 'Supply 1-8 questions')
    if any(not isinstance(q, dict) or set(q)-{'type', 'instructions', 'criteria'} for q in questions.values()):
        raise HTTPException(422, 'Questions accept only type, instructions and criteria; no embedded answer')
    try:
        compiled = compile_row({'state': state, 'questions': questions}, include_targets=False)
        if any(len(options) > 20 for options in compiled.symbols.values()):
            raise ValueError('At most 20 options per question in this pilot')
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc
    if not inference_lock.acquire(timeout=1):
        raise HTTPException(429, 'Local GPU is busy; retry later')
    try:
        last_used = time.monotonic()
        started = time.perf_counter()
        result = manager.predict(backend, state, questions)
        result.update(integration=IDENTITY)
        result['timing']['service_ms'] = round((time.perf_counter()-started)*1000, 2)
        return result
    except (ValueError, TypeError, KeyError, RuntimeError, MemoryError, OSError) as exc:
        if manager.name is None:
            # Keep old MCP clients recoverable after a failed backend switch.
            # ensure_started in older clients requires a real loaded backend.
            try:
                # Recover readiness only; the failed request stays failed. Do not
                # immediately allocate another GPU model after a StartLux load error.
                manager.ensure('laya' if backend=='startlux' else 'intern')
            except Exception:
                server.should_exit = True
        raise HTTPException(422, str(exc)) from exc
    finally:
        last_used = time.monotonic()
        inference_lock.release()


@app.post('/shutdown')
def shutdown():
    if inference_lock.locked():
        raise HTTPException(409, 'Inference in progress')
    server.should_exit = True
    return {'integration': IDENTITY, 'status': 'stopping'}


def idle_watch():
    while not server.should_exit:
        time.sleep(5)
        if not inference_lock.locked() and time.monotonic()-last_used > 600:
            server.should_exit = True


if __name__ == '__main__':
    from backends import Backends
    manager = Backends()
    # Compatibility: already-running MCP clients wait for model_loaded before their first request.
    manager.ensure('intern')
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=18762, workers=1, access_log=False))
    threading.Thread(target=idle_watch, daemon=True).start()
    try:
        server.run()
    finally:
        manager.close()
