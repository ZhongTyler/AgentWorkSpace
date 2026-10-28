"""Local-only adaptation of c1overzz/dsh-bili-scroll lib/asr.py (MIT).

Retains faster-whisper CPU/int8 + VAD. Replaces network/model autoload, joined
text and glob cleanup with pinned local models, full segments and immutable input.
Original and AGI_Ananas notices are retained under vendor/.
"""
import argparse
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time

ROOT=Path(__file__).resolve().parent
HOME=Path(os.environ.get('BILI_CAPTURE_HOME',str(ROOT/'runtime'))).resolve()

def peak_memory():
    if sys.platform!='win32':return None
    class Counters(ctypes.Structure):
        _fields_=[('cb',ctypes.c_ulong),('PageFaultCount',ctypes.c_ulong)]+[(n,ctypes.c_size_t) for n in ['PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage','QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage']]
    c=Counters();c.cb=ctypes.sizeof(c)
    handle=ctypes.windll.kernel32.GetCurrentProcess
    handle.restype=ctypes.c_void_p
    fn=ctypes.windll.psapi.GetProcessMemoryInfo;fn.argtypes=[ctypes.c_void_p,ctypes.POINTER(Counters),ctypes.c_ulong]
    return c.PeakWorkingSetSize if fn(handle(),ctypes.byref(c),c.cb) else None

def decode_local_pcm(raw):
    """Decode memory bytes only; media manifests cannot open network or local paths."""
    import av
    import io
    import numpy as np
    chunks=[];samples=0
    with av.open(io.BytesIO(raw),options={'protocol_whitelist':'pipe'}) as container:
        names=set(container.format.name.split(','))
        if not names.intersection({'mov','mp4','m4a','3gp','3g2','mj2','wav','flac','mp3','ogg','matroska','webm'}):raise ValueError('media_container_not_allowed')
        if not container.streams.audio:raise ValueError('media_has_no_audio')
        resampler=av.AudioResampler(format='s16',layout='mono',rate=16000)
        for frame in container.decode(audio=0):
            if len(frame.layout.channels)>8:raise ValueError('media_channel_limit')
            for converted in resampler.resample(frame):
                pcm=converted.to_ndarray().reshape(-1);samples+=len(pcm)
                if samples>600*16000:raise ValueError('media_duration_over_10_minute_limit')
                chunks.append(pcm)
        for converted in resampler.resample(None):
            pcm=converted.to_ndarray().reshape(-1);samples+=len(pcm)
            if samples>600*16000:raise ValueError('media_duration_over_10_minute_limit')
            chunks.append(pcm)
    if not samples:raise ValueError('media_empty_audio')
    return np.concatenate(chunks).astype(np.float32)/32768.0

def transcribe(source,model='small',language='auto',factory=None,context_terms=None):
    start=time.perf_counter();raw_source=Path(source).absolute()
    if any(p.is_symlink() or p.is_junction() for p in [raw_source,*raw_source.parents] if p.exists()):raise ValueError('local_media_link_denied')
    source=raw_source.resolve()
    allowed=Path(os.environ.get('BILI_CAPTURE_INPUT_ROOT',str(ROOT.parents[2]))).resolve()
    if not source.is_file() or not source.is_relative_to(allowed) or any(p.is_symlink() or p.is_junction() for p in [source,*source.parents] if p.exists()):raise ValueError('local_media_outside_allowed_root')
    if source.suffix.lower() not in ['.wav','.flac','.mp3','.m4a','.mp4','.ogg','.webm'] or not 0<source.stat().st_size<=40000000:raise ValueError('invalid_local_media')
    if not re.fullmatch(r'auto|[a-z]{2,3}',language) or model not in ['tiny','small']:raise ValueError('unverified_asr_profile')
    terms=context_terms or []
    if not isinstance(terms,list) or len(terms)>20 or any(not isinstance(x,str) or not 1<=len(x)<=64 or '\n' in x or '\r' in x for x in terms):raise ValueError('invalid_context_terms')
    model_dir=HOME/'models'/model;lock_path=ROOT/'asr-model-lock.json'
    if not lock_path.exists():raise ValueError('asr_model_not_prepared')
    lock=json.loads(lock_path.read_text(encoding='utf-8'))['profiles'][model]
    for row in lock['files']:
        p=model_dir/row['path']
        if not p.is_file() or p.stat().st_size!=row['bytes'] or hashlib.sha256(p.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('pinned_model_missing_or_changed')
    raw_hash=hashlib.sha256(source.read_bytes()).hexdigest()
    pcm=decode_local_pcm(source.read_bytes())
    if factory is None:
        # Offline is explicit; inference never downloads a model, token or configuration.
        os.environ['HF_HUB_OFFLINE']='1'
        from faster_whisper import WhisperModel
        factory=WhisperModel
    loaded_at=time.perf_counter()
    engine=factory(str(model_dir),device='cpu',compute_type='int8',cpu_threads=4,num_workers=1,local_files_only=True)
    inference_at=time.perf_counter()
    segments,info=engine.transcribe(pcm,language=None if language=='auto' else language,vad_filter=True,beam_size=5,initial_prompt=', '.join(terms) if terms else None)
    if not 0<info.duration<=600:raise ValueError('media_duration_over_10_minute_limit')
    out=[]
    for s in segments:
        if not math.isfinite(s.start) or not math.isfinite(s.end) or not 0<=s.start<=s.end<=info.duration+5:raise ValueError('invalid_asr_timestamps')
        out.append({'from':s.start,'to':s.end,'content':s.text,'avg_logprob':s.avg_logprob,'no_speech_prob':s.no_speech_prob})
    return {'status':'asr_read_requires_semantic_review','source_kind':'local_asr_not_native_subtitle','source_sha256':raw_hash,'source_bytes':source.stat().st_size,
            'model':model,'model_repository':lock['repository'],'model_revision':lock['revision'],'device':'cpu','compute_type':'int8',
            'requested_language':language,'detected_language':info.language,'duration':info.duration,'segments':out,
            'context_terms':terms,'context_terms_are_hints_not_source_evidence':True,
            'text':'\n'.join(s['content'] for s in out),'truncated':False,'automatic_quality_acceptance':False,
            'semantic_completeness_verified':False,'terms_numbers_conditions_negation_require_source_review':True,
            'input_preserved':source.is_file() and hashlib.sha256(source.read_bytes()).hexdigest()==raw_hash,
            'preparation_seconds':loaded_at-start,'model_load_seconds':inference_at-loaded_at,
            'inference_seconds':time.perf_counter()-inference_at,'elapsed_seconds':time.perf_counter()-start,
            'process_peak_working_set_bytes':peak_memory(),'network_during_inference':False}

def main():
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('--model',default='small');p.add_argument('--language',default='auto');p.add_argument('--terms',nargs='*');p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    try:
        from capture import save_new
        r=transcribe(a.source,a.model,a.language,context_terms=a.terms);save_new(a.output,r)
        print(json.dumps({k:v for k,v in r.items() if k not in ['segments','text']},ensure_ascii=False));return 0
    except Exception as e:
        reason=str(e) if re.fullmatch(r'[a-z0-9_]+',str(e)) else type(e).__name__
        print(json.dumps({'status':'stopped','reason':reason}));return 2

if __name__=='__main__':raise SystemExit(main())
