"""Synthetic stateful MCP for lifecycle/transport checks; no network or data."""
import json
import os
import subprocess
import sys
import time

value=0
for line in sys.stdin:
    msg=json.loads(line);method=msg.get('method')
    if 'id' not in msg:continue
    result={}
    if method=='initialize':
        result={'protocolVersion':'2025-06-18','capabilities':{'tools':{}},'serverInfo':{'name':'demand-fixture','version':'1'}}
    elif method=='tools/list':
        result={'tools':[{'name':'probe','description':'Synthetic lifecycle probe','inputSchema':{'type':'object','additionalProperties':True}}]}
    elif method=='tools/call':
        args=msg['params'].get('arguments',{})
        if args.get('crash'):os._exit(7)
        if args.get('progress'):
            print(json.dumps({'jsonrpc':'2.0','method':'notifications/progress','params':{'progressToken':args['progress'],'progress':1}}),flush=True)
        if args.get('callback'):
            print(json.dumps({'jsonrpc':'2.0','id':'callback-1','method':'roots/list','params':{}}),flush=True)
            callback=json.loads(sys.stdin.readline())
            assert callback['id']=='callback-1' and 'result' in callback
        if args.get('descendant'):
            child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(300)'],
                stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        time.sleep(args.get('sleep',0))
        value+=1
        result={'content':[{'type':'text','text':json.dumps({'pid':os.getpid(),'value':value,'tag':args.get('tag'),'child':child.pid if args.get('descendant') else None,
            'environment_matches':os.environ.get('SKY_CUA_NATIVE_PIPE_DIRECTORY')==args.get('expected_pipe') if 'expected_pipe' in args else None,
            'metadata_matches':msg['params'].get('_meta',{}).get('sentinel')==args.get('expected_meta') if 'expected_meta' in args else None})}]}
    else:
        print(json.dumps({'jsonrpc':'2.0','id':msg['id'],'error':{'code':-32601,'message':'Unknown fixture method'}}),flush=True);continue
    print(json.dumps({'jsonrpc':'2.0','id':msg['id'],'result':result}),flush=True)
