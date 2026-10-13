"""Verify unload/restart, two MCP clients sharing one GPU process, and total VRAM."""
import asyncio
from contextlib import AsyncExitStack
import json
from pathlib import Path
import subprocess
import time

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from local_runtime import BASE, status


def gpu():
    return subprocess.check_output(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], text=True).strip()


async def main():
    output=BASE.parent.parent/'experiments/intern-decision-pilot-20261012/lifecycle-receipt.json'
    inputs=json.loads((output.parent/'inputs.json').read_text(encoding='utf-8'))
    report={'before':status(), 'total_gpu_before_mib':gpu()}
    assert not report['before']['model_loaded']
    params=StdioServerParameters(command=str(BASE/'runtime/client/Scripts/python.exe'),
        args=['-X','utf8','-B',str(BASE/'mcp_server.py')])
    async with AsyncExitStack() as stack:
        a,b=await stack.enter_async_context(stdio_client(params))
        first=await stack.enter_async_context(ClientSession(a,b))
        await first.initialize()
        started=time.perf_counter()
        result=await first.call_tool('decision_predict',inputs[0]['request'])
        assert not result.isError
        report['restart_mcp_ms']=round((time.perf_counter()-started)*1000,2)
        report['first_client_service']=status()
        c,d=await stack.enter_async_context(stdio_client(params))
        second=await stack.enter_async_context(ClientSession(c,d))
        await second.initialize()
        started=time.perf_counter()
        result=await second.call_tool('decision_predict',inputs[1]['request'])
        assert not result.isError
        report['second_client_warm_mcp_ms']=round((time.perf_counter()-started)*1000,2)
        report['second_client_service']=status()
        assert report['first_client_service']['pid']==report['second_client_service']['pid']
        report['total_gpu_loaded_mib']=gpu()
        result=await second.call_tool('decision_unload',{})
        assert not result.isError
        deadline=time.monotonic()+15
        while status()['model_loaded'] and time.monotonic()<deadline:
            await asyncio.sleep(.5)
        report['after_unload']=status()
        assert not report['after_unload']['model_loaded']
    report['total_gpu_after_mib']=gpu()
    output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    asyncio.run(main())
