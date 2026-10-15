"""Loopback reference adapter. A production website supplies its own identity gateway."""
import json,secrets,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from service import load,execute
def serve(config_path,key_file,port,allow_hybrid=False):
 cfg,store=load(config_path,'hybrid' if allow_hybrid else 'bm25');keys=json.loads(key_file.read_text(encoding='utf-8'));lock=threading.RLock()
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def respond(self,status,value):
   raw=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
  def do_GET(self):self.respond(405,{'error':'authenticated POST required'})
  def do_POST(self):
   if self.headers.get('Origin') not in [None,f'http://127.0.0.1:{port}']:return self.respond(403,{'error':'origin_denied'})
   profile=next((v for k,v in keys.items() if secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+k)),None)
   if profile not in cfg['profiles']:return self.respond(401,{'error':'authentication_required'})
   action={'/v1/search':'search','/v1/context':'context','/v1/read':'read'}.get(self.path)
   if not action:return self.respond(404,{'error':'route_unavailable; answer generation belongs to host'})
   try:
    length=int(self.headers.get('Content-Length','0'))
    if not 0<length<=8192:return self.respond(413,{'error':'request_budget'})
    request=json.loads(self.rfile.read(length))
    if not isinstance(request,dict) or 'action' in request:raise ValueError('unsupported request')
    if request.get('mode')=='hybrid' and not allow_hybrid:return self.respond(503,{'error':'hybrid_disabled'})
    with lock:result=execute(cfg,store,{**request,'action':action},profile)
    self.respond(200,result)
   except (ValueError,KeyError,TypeError,OSError):self.respond(400,{'error':'invalid_scope_or_stale_request'})
 server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
 try:server.serve_forever()
 finally:server.server_close();store.close()
