"""Bounded Bilibili evidence capture; no account access, posting or autonomous schedule."""
import argparse
import ast
import hashlib
import html
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import warnings
import zipfile

ROOT=Path(__file__).resolve().parent
HOME=Path(os.environ.get('BILI_CAPTURE_HOME',str(ROOT/'runtime'))).resolve()
BV=re.compile(r'^BV[A-Za-z0-9]{10}$')
SHA=lambda b:hashlib.sha256(b).hexdigest()


def original_functions():
    lock=json.loads((ROOT/'dsh-source-lock.json').read_text(encoding='utf-8'))
    raw=(ROOT/'vendor/dsh-bili-scroll-2.2.2.zip').read_bytes()
    if SHA(raw)!=lock['archive_sha256']:raise ValueError('original_source_changed')
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        name=next(n for n in z.namelist() if n.endswith('/vendor/bilibili-mcp/mcp_server.py'))
        tree=ast.parse(z.read(name).decode('utf-8'))
    names={'_snapshot_entries','_crop_tile'}
    nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
    if {n.name for n in nodes}!=names:raise ValueError('original_component_missing')
    ns={};exec(compile(ast.Module(body=nodes,type_ignores=[]),'pinned-dsh-pure-components','exec'),ns)
    return ns


def health():
    lock=json.loads((ROOT/'dsh-source-lock.json').read_text(encoding='utf-8'))
    ok=SHA((ROOT/'vendor/dsh-bili-scroll-2.2.2.zip').read_bytes())==lock['archive_sha256']
    return {'status':'pass' if ok else 'changed','revision':lock['revision'],'network':False,
            'credentials':False,'model_loaded':False,'mcp_client_registration':'not_checked',
            'asr_prepared':(HOME/'models/small/model.bin').is_file()}


def platform(action,**kwargs):
    node=shutil.which('node')
    if not node:raise ValueError('node_unavailable')
    p=subprocess.run([node,str(ROOT/'platform.mjs')],input=json.dumps({'action':action,**kwargs}),
                     text=True,encoding='utf-8',capture_output=True,timeout=85)
    if len(p.stdout)>3000000:raise ValueError('platform_output_too_large')
    try:return json.loads(p.stdout)
    except ValueError:raise ValueError('platform_worker_failed') from None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def download(url,kind,cap):
    u=urllib.parse.urlsplit(url)
    hosts={'subtitle':{'aisubtitle.hdslb.com','subtitle.bilibili.com'},
           'storyboard':{'i0.hdslb.com','i1.hdslb.com','i2.hdslb.com','i3.hdslb.com','bimp.hdslb.com','boss.hdslb.com'}}
    allowed=u.hostname in hosts.get(kind,set()) if kind!='audio' else bool(u.hostname and u.hostname.endswith('.bilivideo.com'))
    if not allowed or u.scheme!='https' or u.username or u.password or u.port:raise ValueError('media_host_denied')
    req=urllib.request.Request(url,headers={'Referer':'https://www.bilibili.com/','User-Agent':'Mozilla/5.0'})
    opener=urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req,timeout=25) as r:
            if r.status!=200:raise ValueError('media_http_'+str(r.status))
            chunks=[];n=0;deadline=time.monotonic()+45
            while True:
                chunk=r.read(min(65536,cap+1-n))
                if not chunk:break
                chunks.append(chunk);n+=len(chunk)
                if n>cap:raise ValueError('media_size_limit')
                if time.monotonic()>deadline:raise ValueError('media_total_deadline')
            b=b''.join(chunks)
    except urllib.error.HTTPError as e:raise ValueError('media_http_'+str(e.code)+'_no_retry') from None
    except urllib.error.URLError:raise ValueError('media_network_unavailable_no_retry') from None
    if len(b)>cap:raise ValueError('media_size_limit')
    return b


def safe_segments(body,duration):
    if not isinstance(duration,(int,float)) or not math.isfinite(duration) or duration<=0:raise ValueError('invalid_duration')
    if not isinstance(body,list) or len(body)>100000:raise ValueError('invalid_segments')
    out=[];last=-1
    for x in body:
        if not isinstance(x,dict):raise ValueError('invalid_segment')
        start,end=x.get('from'),x.get('to');text=x.get('content')
        if (isinstance(start,bool) or isinstance(end,bool) or not isinstance(start,(int,float)) or not isinstance(end,(int,float))
            or not math.isfinite(start) or not math.isfinite(end) or not 0<=start<=end<=duration+5 or start<last
            or not isinstance(text,str) or len(text)>20000):raise ValueError('segment_identity_or_time_invalid')
        last=start;out.append({'from':start,'to':end,'content':text})
    return out


def choose_track(tracks,language='zh'):
    if not re.fullmatch(r'[a-zA-Z]{2,3}(?:-[a-zA-Z]+)?',language):raise ValueError('invalid_language')
    if not isinstance(tracks,list) or len(tracks)>200 or any(not isinstance(x,dict) for x in tracks):raise ValueError('invalid_tracks')
    def score(t):
        code=str(t.get('lan',''));human=not code.startswith('ai-');base=code.removeprefix('ai-')
        return (0 if base==language or base.startswith(language+'-') else 1,0 if human else 1,code)
    return min(tracks,key=score) if tracks else None


def transcript(bvid,page=1,language='zh',transport=platform,fetch=download):
    r=transport('subtitles',bvid=bvid,page=page)
    if r['status']!='platform_read':return r
    meta=r['metadata'];tracks=r['data'].get('subtitle',{}).get('subtitles',[]);track=choose_track(tracks,language)
    if track is None:return {'status':'subtitle_unavailable','metadata':meta,'tracks_returned':0,'access':r['access'],
                             'not_proof_video_has_no_subtitles':True,'description_fallback':False}
    url=track.get('subtitle_url','');url='https:'+url if url.startswith('//') else url
    raw=fetch(url,'subtitle',4000000);data=json.loads(raw)
    seg=safe_segments(data.get('body'),meta['duration'])
    return {'status':'subtitle_read_requires_visual_review' if seg else 'subtitle_empty','metadata':meta,
            'track':{k:track.get(k) for k in ['id','lan','lan_doc']},
            'subtitle_kind':'platform_ai' if str(track.get('lan','')).startswith('ai-') else 'platform_track_origin_unverified',
            'segments':seg,'text':'\n'.join(x['content'] for x in seg),'truncated':False,'source_bytes_sha256':SHA(raw),
            'speech_coverage_fraction':round(max((x['to'] for x in seg),default=0)/meta['duration'],4),
            'coverage_is_not_proof_of_completeness':True,'access':r['access'],'frames_read':False}


def storyboard(bvid,page=1,at=None,num=3,transport=platform,fetch=download):
    if not isinstance(num,int) or not 1<=num<=6:raise ValueError('frame_count_out_of_range')
    if at is not None and (not isinstance(at,list) or not 1<=len(at)<=6 or any(isinstance(t,bool) or not isinstance(t,(int,float)) or not math.isfinite(t) or t<0 for t in at)):raise ValueError('invalid_frame_times')
    r=transport('storyboard',bvid=bvid,page=page)
    if r['status']!='platform_read':return r,[]
    data=r['data'];meta=r['metadata'];duration=meta['duration'];original=original_functions()
    entries=original['_snapshot_entries'](data,duration)
    if not entries and data.get('pvdata'):
        url=data['pvdata'];url='https:'+url if url.startswith('//') else url
        raw=fetch(url,'storyboard',40000)
        if not raw or len(raw)%2:raise ValueError('invalid_storyboard_index')
        entries=[(float(t),i) for i,t in enumerate(struct.unpack('>'+str(len(raw)//2)+'H',raw))]
    if not entries:return {'status':'storyboard_unavailable','metadata':meta,'access':r['access']},[]
    if len(entries)>20000 or any(not math.isfinite(t) or not 0<=t<=duration+5 for t,_ in entries):raise ValueError('invalid_storyboard_times')
    covered=min(duration,max(t for t,_ in entries));targets=at if at is not None else [covered*(i+1)/(num+1) for i in range(num)]
    tw,th=int(data.get('img_x_size') or 480),int(data.get('img_y_size') or 270)
    if not 1<=tw<=2048 or not 1<=th<=2048:raise ValueError('invalid_tile_geometry')
    from PIL import Image
    Image.MAX_IMAGE_PIXELS=25000000;warnings.simplefilter('error',Image.DecompressionBombWarning)
    sheets=data.get('image') or [];cache={};frames=[];assets=[]
    def sheet(n):
        if n not in cache:
            if not 0<=n<len(sheets) or len(cache)>=6:raise ValueError('storyboard_sheet_limit')
            u=sheets[n];u='https:'+u if u.startswith('//') else u
            raw=fetch(u,'storyboard',8000000)
            with Image.open(io.BytesIO(raw)) as im: im.load();size=im.size
            if size[0]%tw or size[1]%th or min(size)<1:raise ValueError('sheet_geometry_mismatch')
            cache[n]=(raw,size)
        return cache[n]
    first,size=sheet(0);capacity=(size[0]//tw)*(size[1]//th)
    for n,want in enumerate(targets):
        if want>duration:raise ValueError('requested_frame_outside_part')
        got,tile=min(entries,key=lambda e:abs(e[0]-want));raw,_=sheet(tile//capacity)
        jpg=original['_crop_tile'](raw,tile%capacity,tw,th)
        name=f'frame-{n+1}.jpg';assets.append((name,jpg));frames.append({'file':name,'want_sec':want,'got_sec':got,'delta_sec':abs(want-got),'sha256':SHA(jpg),'bytes':len(jpg)})
    return {'status':'storyboard_read_requires_visual_review','metadata':meta,'covered_sec':covered,'frames':frames,
            'sampling':'platform_storyboard_not_precise_decoded_frames','full_viewing':False,'access':r['access']},assets


def audio(bvid,page=1,transport=platform,fetch=download):
    r=transport('audio',bvid=bvid,page=page)
    if r['status']!='platform_read':return r,[]
    if r['metadata']['duration']>600:raise ValueError('audio_over_10_minute_limit')
    tracks=r['data'].get('dash',{}).get('audio') or []
    if not tracks:return {'status':'public_audio_unavailable','metadata':r['metadata']},[]
    track=min(tracks,key=lambda x:x.get('bandwidth',float('inf')));url=track.get('baseUrl') or track.get('base_url')
    raw=fetch(url,'audio',40000000)
    return {'status':'audio_captured','metadata':r['metadata'],'file':'audio.m4a','sha256':SHA(raw),'bytes':len(raw),'source_host':urllib.parse.urlsplit(url).hostname,'access':r['access']},[('audio.m4a',raw)]


def precise_frames(bvid,page=1,at=None,transport=platform,fetch=download):
    if not isinstance(at,list) or not 1<=len(at)<=6 or any(isinstance(t,bool) or not isinstance(t,(int,float)) or not math.isfinite(t) or t<0 for t in at):raise ValueError('invalid_frame_times')
    r=transport('audio',bvid=bvid,page=page) # same guarded public playurl response contains video and audio
    if r['status']!='platform_read':return r,[]
    meta=r['metadata']
    if meta['duration']>600 or max(at)>meta['duration']:raise ValueError('video_duration_or_seek_limit')
    tracks=[t for t in r['data'].get('dash',{}).get('video',[]) if 0<t.get('width',0)<=1920 and 0<t.get('height',0)<=1080]
    if not tracks:return {'status':'public_video_unavailable','metadata':meta},[]
    # Prefer readable 720p if publicly returned, without asking for a paid quality.
    best=min(tracks,key=lambda t:(0 if t.get('height',0)>=720 else 1,t.get('bandwidth',float('inf'))))
    url=best.get('baseUrl') or best.get('base_url');raw=fetch(url,'audio',40000000)
    import av
    frames=[];assets=[]
    with av.open(io.BytesIO(raw),options={'protocol_whitelist':'pipe'}) as container:
        if not set(container.format.name.split(',')).intersection({'mov','mp4','matroska','webm'}):raise ValueError('video_container_not_allowed')
        stream=container.streams.video[0];origin=float((stream.start_time or 0)*stream.time_base)
        for i,want in enumerate(at):
            container.seek(int((want+origin)/stream.time_base),stream=stream,backward=True)
            previous=None;chosen=None
            for frame in container.decode(stream):
                if frame.pts is None:continue
                got=float(frame.pts*stream.time_base)-origin
                if got>=want:
                    chosen=min([x for x in [previous,(got,frame)] if x is not None],key=lambda x:abs(x[0]-want));break
                previous=(got,frame)
            if chosen is None:chosen=previous
            if chosen is None:raise ValueError('video_frame_not_decoded')
            got,frame=chosen;b=io.BytesIO();frame.to_image().save(b,format='JPEG',quality=95);jpg=b.getvalue()
            name=f'frame-{i+1}.jpg';assets.append((name,jpg));frames.append({'file':name,'want_sec':want,'got_sec':got,'delta_sec':abs(want-got),'sha256':SHA(jpg),'bytes':len(jpg),'width':frame.width,'height':frame.height})
    return {'status':'decoded_frames_read_requires_visual_review','metadata':meta,'frames':frames,
            'source_video_sha256':SHA(raw),'source_video_bytes':len(raw),'source_video_id':best.get('id'),
            'sampling':'decoded_video_frames_with_actual_pts','full_viewing':False,'access':r['access']},assets


def save_new(folder,result,assets=()):
    raw_folder=Path(folder).absolute()
    if any(p.is_symlink() or p.is_junction() for p in [raw_folder,*raw_folder.parents] if p.exists()):raise ValueError('output_link_denied')
    folder=raw_folder.resolve()
    # Outputs are caller-selected research assets, never a general overwrite/write-file tool.
    allowed=Path(os.environ.get('BILI_CAPTURE_OUTPUT_ROOT',str(ROOT.parents[2]))).resolve()
    if not folder.is_relative_to(allowed) or any(p.is_symlink() or p.is_junction() for p in [folder,*folder.parents] if p.exists()):raise ValueError('output_outside_allowed_root_or_link')
    if folder.exists():raise ValueError('output_already_exists')
    folder.parent.mkdir(parents=True,exist_ok=True)
    stage=folder.parent/('.'+folder.name+'.'+uuid.uuid4().hex+'.partial');stage.mkdir(exist_ok=False)
    for name,raw in assets:
        if Path(name).name!=name:raise ValueError('invalid_asset_name')
        with (stage/name).open('xb') as f:f.write(raw)
    with (stage/'evidence.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    stage.rename(folder)
    return folder


def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['health','search','transcript','frames','precise-frames','audio'])
    p.add_argument('--bvid');p.add_argument('--page',type=int,default=1);p.add_argument('--language',default='zh');p.add_argument('--keyword');p.add_argument('--limit',type=int,default=5)
    p.add_argument('--at',type=float,nargs='+');p.add_argument('--num',type=int,default=3);p.add_argument('--output',type=Path)
    a=p.parse_args();start=time.perf_counter()
    try:
        if a.output and a.output.exists():raise ValueError('output_already_exists')
        assets=[]
        if a.action=='health':r=health()
        elif a.action=='search':r=platform('search',keyword=a.keyword,limit=a.limit)
        else:
            if not BV.fullmatch(a.bvid or '') or not 1<=a.page<=1000:raise ValueError('invalid_video_identity')
            if a.action=='transcript':r=transcript(a.bvid,a.page,a.language)
            elif a.action=='frames':r,assets=storyboard(a.bvid,a.page,a.at,a.num)
            elif a.action=='precise-frames':r,assets=precise_frames(a.bvid,a.page,a.at)
            else:r,assets=audio(a.bvid,a.page)
        r['elapsed_seconds']=round(time.perf_counter()-start,4)
        if a.output:save_new(a.output,r,assets)
        print(json.dumps(r,ensure_ascii=False))
        return 2 if r['status'] in ['stopped','changed'] else 0
    except Exception as e:
        # Do not echo temporary media URLs, arbitrary upstream messages or credential paths.
        reason=str(e) if re.fullmatch(r'[A-Za-z0-9_]+',str(e)) else type(e).__name__
        r={'status':'stopped','reason':reason,'elapsed_seconds':round(time.perf_counter()-start,4)}
        if a.output and not a.output.exists():
            try:save_new(a.output,r)
            except (ValueError,OSError):pass
        print(json.dumps(r));return 2

if __name__=='__main__':raise SystemExit(main())
