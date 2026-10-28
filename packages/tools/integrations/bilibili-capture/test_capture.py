import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import capture as c

META={'bvid':'BV1ZE4m1X7Zx','page':2,'cid':202,'duration':20,'title':'合成第二P'}
def platform(data):return lambda action,**kwargs:{'status':'platform_read','metadata':META,'data':data,'access':[]}

class CaptureContracts(unittest.TestCase):
    def test_source_identity(self):
        self.assertEqual(c.health()['status'],'pass');self.assertEqual(set(c.original_functions())-{'__builtins__'},{'_snapshot_entries','_crop_tile'})
    def test_human_language_priority_independent_of_order(self):
        ai={'lan':'ai-zh','id':1};human={'lan':'zh-CN','id':2};en={'lan':'en','id':3}
        for tracks in [[ai,human,en],[en,human,ai],[human,ai,en]]:self.assertEqual(c.choose_track(tracks)['id'],2)
        self.assertEqual(c.choose_track([ai,en])['id'],1)
    def test_complete_text_timestamps_and_part(self):
        body=[{'from':0,'to':19,'content':'甲'*13000+'末尾反例'}]
        data={'subtitle':{'subtitles':[{'id':2,'lan':'zh-CN','subtitle_url':'https://subtitle.bilibili.com/a.json'}]}}
        r=c.transcript(META['bvid'],2,transport=platform(data),fetch=lambda *a:json.dumps({'body':body}).encode())
        self.assertEqual(r['metadata']['cid'],202);self.assertEqual(r['metadata']['page'],2)
        self.assertTrue(r['text'].endswith('末尾反例'));self.assertEqual(r['segments'],body);self.assertFalse(r['truncated'])
    def test_empty_and_unavailable_are_different(self):
        self.assertEqual(c.transcript(META['bvid'],transport=platform({'subtitle':{'subtitles':[]}}))['status'],'subtitle_unavailable')
        r=c.transcript(META['bvid'],transport=platform({'subtitle':{'subtitles':[{'lan':'zh','subtitle_url':'https://subtitle.bilibili.com/a.json'}]}}),fetch=lambda *a:b'{"body":[]}')
        self.assertEqual(r['status'],'subtitle_empty')
    def test_access_stop_has_no_media_fallback(self):
        for status in ['authentication_required','upstream_http_412_no_retry']:
            with patch.object(c,'download') as f:
                r=c.transcript(META['bvid'],transport=lambda *a,**k:{'status':'stopped','reason':status})
                self.assertEqual(r['reason'],status);f.assert_not_called()
    def test_invalid_segment_boundaries(self):
        for x in [None,{'from':True,'to':1,'content':'x'},{'from':0,'to':float('inf'),'content':'x'},{'from':3,'to':2,'content':'x'}, {'from':0,'to':30,'content':'x'}]:
            with self.assertRaises(ValueError):c.safe_segments([x],20)
    def test_foreign_media_and_account_hosts_rejected_before_network(self):
        for kind,url in [('subtitle','https://example.com/x.json'),('storyboard','https://passport.bilibili.com/x'),('audio','https://bilivideo.com.evil.test/x'),('audio','http://a.bilivideo.com/x'),('audio','https://a.bilivideo.com:443/x')]:
            with patch.object(c.urllib.request,'build_opener') as f:
                with self.assertRaises(ValueError):c.download(url,kind,100)
                f.assert_not_called()
    def test_storyboard_pixels_actual_time_and_page(self):
        from PIL import Image
        im=Image.new('RGB',(40,10),'red');im.paste('blue',(20,0,40,10));b=io.BytesIO();im.save(b,format='PNG')
        data={'index':[0,10000],'img_x_size':20,'img_y_size':10,'image':['https://bimp.hdslb.com/a.jpg']}
        r,assets=c.storyboard(META['bvid'],page=2,at=[11],transport=platform(data),fetch=lambda *a:b.getvalue())
        self.assertEqual(r['frames'][0]['got_sec'],10);self.assertEqual(r['metadata']['page'],2)
        with Image.open(io.BytesIO(assets[0][1])) as decoded:self.assertGreater(decoded.getpixel((10,5))[2],200)
    def test_bad_storyboard_times_fail(self):
        for at in [[float('nan')],[-1],[],[0]*7]:
            with self.assertRaises(ValueError):c.storyboard(META['bvid'],at=at)
    def test_long_part_audio_is_not_downloaded(self):
        def t(*a,**k):return {'status':'platform_read','metadata':{**META,'duration':601},'data':{}}
        with patch.object(c,'download') as f:
            with self.assertRaises(ValueError):c.audio(META['bvid'],transport=t)
            f.assert_not_called()
    def test_precise_frame_invalid_time_and_duration_stop_before_media(self):
        for at in [None,[],[float('nan')],[-1],[0]*7]:
            with self.assertRaises(ValueError):c.precise_frames(META['bvid'],at=at)
        with patch.object(c,'download') as f:
            def t(*a,**k):return {'status':'platform_read','metadata':{**META,'duration':601},'data':{}}
            with self.assertRaises(ValueError):c.precise_frames(META['bvid'],at=[1],transport=t)
            f.assert_not_called()
    def test_output_is_new_atomic_and_preserves_existing(self):
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'BILI_CAPTURE_OUTPUT_ROOT':tmp}):
            p=Path(tmp)/'one';c.save_new(p,{'status':'synthetic'},[('frame-1.jpg',b'fixture')])
            before=(p/'evidence.json').read_bytes()
            with self.assertRaises(ValueError):c.save_new(p,{'status':'overwrite'})
            self.assertEqual((p/'evidence.json').read_bytes(),before)
            with self.assertRaises(ValueError):c.save_new(Path(tmp).parent/'outside-capture',{})
    def test_unsupported_profile_never_loads_model(self):
        import asr
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'BILI_CAPTURE_INPUT_ROOT':tmp}):
            p=Path(tmp)/'sample.wav';p.write_bytes(b'fixture')
            with self.assertRaisesRegex(ValueError,'unverified_asr_profile'):asr.transcribe(p,'large')
    def test_local_pcm_decode_and_no_manifest_network(self):
        import asr,wave,http.server,threading
        data=io.BytesIO()
        with wave.open(data,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(b'\0'*32000)
        self.assertEqual(len(asr.decode_local_pcm(data.getvalue())),16000)
        class Handler(http.server.BaseHTTPRequestHandler):
            count=0
            def do_GET(self):Handler.count+=1;self.send_response(404);self.end_headers()
            def log_message(self,*args):pass
        server=http.server.HTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        manifest=('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nhttp://127.0.0.1:'+str(server.server_port)+'/synthetic.mp3\n#EXT-X-ENDLIST\n').encode()
        try:
            with self.assertRaises(Exception):asr.decode_local_pcm(manifest)
            self.assertEqual(Handler.count,0)
        finally:server.shutdown();server.server_close();thread.join()
    def test_term_hints_reject_long_or_instruction_sized_input(self):
        import asr
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'BILI_CAPTURE_INPUT_ROOT':tmp}):
            p=Path(tmp)/'fixture.wav';p.write_bytes(b'fixture_not_decoded')
            for terms in [['x'*65],['x']*21,['x\ny']]:
                with self.assertRaisesRegex(ValueError,'invalid_context_terms'):asr.transcribe(p,context_terms=terms)
    def test_mcp_capture_limit_returns_busy_and_releases(self):
        import server
        @server.bounded_capture
        def work():return {'status':'synthetic'}
        server.capture_gate.acquire()
        try:self.assertEqual(work()['status'],'busy')
        finally:server.capture_gate.release()
        self.assertEqual(work()['status'],'synthetic')

if __name__=='__main__':unittest.main()
