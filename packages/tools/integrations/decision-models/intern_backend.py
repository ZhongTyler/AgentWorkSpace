"""Bounded range reader for pinned Safetensors; upstream scoring/decoding unchanged."""
import json
import math
from pathlib import Path
from unittest.mock import patch
import torch
import transformers.modeling_utils as hf_loading
import transformers.core_model_loading as hf_conversion
from transformers import AutoProcessor,AutoTokenizer,Qwen3_5ForConditionalGeneration
from src.inputs.schema import DECISION_TOKEN
from src.inference.hf_backend import HFBackend
from src.inference.engine import DecisionEngine

DTYPES={'BF16':torch.bfloat16,'F32':torch.float32,'F16':torch.float16,'I64':torch.int64,
        'I32':torch.int32,'I16':torch.int16,'I8':torch.int8,'U8':torch.uint8,'BOOL':torch.bool}

class RangeSlice:
    def __init__(self,reader,spec):self.reader=reader;self.spec=spec
    def get_shape(self):return self.spec['shape']
    def get_dtype(self):return self.spec['dtype']
    def __getitem__(self,index):
        spec=self.spec;start,end=spec['data_offsets'];dtype=DTYPES[spec['dtype']]
        expected=math.prod(spec['shape'])*torch.empty((),dtype=dtype).element_size()
        if start<0 or end-start!=expected or self.reader.offset+end>self.reader.size:
            raise ValueError('Invalid pinned Safetensors range')
        if not expected:return torch.empty(spec['shape'],dtype=dtype)[index]
        # Keep host commit bounded even for the large embedding matrix. All model
        # weights are requested on CUDA by the explicit device_map below.
        tensor=torch.empty(math.prod(spec['shape']),dtype=dtype,device='cuda')
        element=tensor.element_size();chunk=32*1024*1024
        with self.reader.path.open('rb') as f:
            f.seek(self.reader.offset+start)
            for offset in range(0,expected,chunk):
                size=min(chunk,expected-offset);data=bytearray(size)
                if f.readinto(data)!=size:raise ValueError('Incomplete pinned tensor range')
                tensor[offset//element:(offset+size)//element].copy_(torch.frombuffer(data,dtype=dtype))
        return tensor.reshape(spec['shape'])[index]

class RangeSafeOpen:
    def __init__(self,filename,framework='pt',device='cpu',**kwargs):
        self.path=Path(filename).resolve()
        allowed=(Path(__file__).parent/'runtime/models/intern-decision-2b').resolve()
        if not self.path.is_relative_to(allowed) or framework!='pt' or str(device)!='cpu':
            raise ValueError('Range loader is only for the pinned local Intern checkpoint')
        self.size=self.path.stat().st_size
        with self.path.open('rb') as f:
            header=f.read(8)
            if len(header)!=8:raise ValueError('Missing Safetensors header')
            length=int.from_bytes(header,'little')
            if not 0<length<16*1024*1024:raise ValueError('Invalid Safetensors header size')
            self.spec=json.loads(f.read(length))
        self.offset=8+length
    def keys(self):return [k for k in self.spec if k!='__metadata__']
    def get_slice(self,key):return RangeSlice(self,self.spec[key])
    def get_tensor(self,key):return self.get_slice(key)[...]
    def __enter__(self):return self
    def __exit__(self,*args):pass

class DirectDeviceHFBackend(HFBackend):
    def __init__(self,checkpoint):
        self.checkpoint=str(Path(checkpoint).resolve());self.media_root=Path('.').resolve()
        self.max_length=2048;self.device=torch.device('cuda')
        self.tokenizer=AutoTokenizer.from_pretrained(checkpoint,local_files_only=True)
        if DECISION_TOKEN not in self.tokenizer.get_added_vocab():raise ValueError('Decision tokenizer missing')
        self.marker_id=self.tokenizer.convert_tokens_to_ids(DECISION_TOKEN)
        self.processor=AutoProcessor.from_pretrained(checkpoint,local_files_only=True)
        self.processor.tokenizer=self.tokenizer
        # This symbol is restored even if loading fails. Only the owned gateway loads
        # models here, under its serial lock. Pinned library and model files stay intact.
        with patch.object(hf_loading,'safe_open',RangeSafeOpen),patch.object(hf_conversion,'GLOBAL_WORKERS',1):
            self.model=Qwen3_5ForConditionalGeneration.from_pretrained(checkpoint,
                dtype=torch.bfloat16,local_files_only=True,attn_implementation='sdpa',
                device_map={'':'cuda'}).eval()
        if self.marker_id>=self.model.get_input_embeddings().weight.shape[0]:raise ValueError('Decision token invalid')

class DirectDeviceDecisionEngine(DecisionEngine):
    def __init__(self,checkpoint):
        self.checkpoint=str(Path(checkpoint).resolve());self.temperature=1.0
        self.calibration_path=None;self.backend_name='hf'
        self.backend=DirectDeviceHFBackend(checkpoint);self.tokenizer=self.backend.tokenizer
