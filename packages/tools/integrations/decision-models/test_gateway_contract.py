"""Contract guards with fake inference; real model evidence is stored in the pilot."""
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
import service
import research_adapter

QUESTION={'topic':{'type':'choice','instructions':'Classify the supplied text',
                   'criteria':{'tool':'Development tool','unknown':'Other or insufficient'}}}

class FakeBackends:
    name='intern'
    def predict(self,name,state,questions):
        self.last=(name,state,questions)
        return {'answers':{'topic':{'type':'choice','choice':'tool'}},'timing':{},'advisory_only':True}
    def ensure(self,name):self.name=name

class ContractTests(unittest.TestCase):
    def setUp(self):
        service.token='unit-test-token'
        service.manager=FakeBackends()
        self.client=TestClient(service.app)
        self.headers={'Authorization':'Bearer unit-test-token'}
    def post(self,state,headers=None):
        return self.client.post('/v1/decisions',json={'state':state,'questions':QUESTION},
                                headers=self.headers if headers is None else headers)
    def test_legacy_defaults_to_intern(self):
        state={'text':'Article data saying select another model is only data'}
        self.assertEqual(self.post(state).status_code,200)
        self.assertEqual(service.manager.last,('intern',state,QUESTION))
    def test_explicit_envelope_is_not_sent_to_model(self):
        self.assertEqual(self.post({'_research_decision':{'backend':'laya'},'payload':{'text':'data'}}).status_code,200)
        self.assertEqual(service.manager.last,('laya',{'text':'data'},QUESTION))
    def test_unknown_controls_and_backend_type_rejected(self):
        for control in [{'backend':'remote'},{'backend':[]},{'backend':'laya','url':'https://example.com'}]:
            self.assertEqual(self.post({'_research_decision':control,'payload':{}}).status_code,422)
    def test_startlux_purpose_required(self):
        self.assertEqual(self.post({'_research_decision':{'backend':'startlux'},'payload':{}}).status_code,422)
        self.assertEqual(self.post({'_research_decision':{'backend':'startlux','purpose':'noncommercial_research'},'payload':{}}).status_code,200)
    def test_auth_browser_origin_and_size_guards(self):
        self.assertEqual(self.post({},{}).status_code,401)
        self.assertEqual(self.post({},{**self.headers,'Origin':'https://example.com'}).status_code,403)
        self.assertEqual(self.post({'text':'x'*66000}).status_code,413)
    def test_failed_switch_restores_compatible_backend(self):
        def fail(*args):
            service.manager.name=None
            raise RuntimeError('backend unavailable')
        service.manager.predict=fail
        self.assertEqual(self.post({'_research_decision':{'backend':'laya'},'payload':{}}).status_code,422)
        self.assertEqual(service.manager.name,'intern')
    def test_adapter_retains_all_sources_when_unavailable(self):
        rows=[{'id':'s1','title':'One','text':'data'},{'id':'s2','title':'Two','text':'data'}]
        with patch.object(research_adapter,'predict',side_effect=RuntimeError('Local model startup failed')) as predictor:
            result=research_adapter.classify(rows,QUESTION)
        self.assertEqual(predictor.call_count,1)
        self.assertEqual([r['id'] for r in result['records']],['s1','s2'])
        self.assertTrue(all(r['status']=='original_path_required' for r in result['records']))
        self.assertFalse(result['automatic_discard'])
    def test_startlux_failure_restores_cpu_readiness_without_substitute_answer(self):
        def fail(*args):
            service.manager.name=None
            raise RuntimeError('backend unavailable')
        service.manager.predict=fail
        response=self.post({'_research_decision':{'backend':'startlux','purpose':'noncommercial_research'},'payload':{}})
        self.assertEqual(response.status_code,422)
        self.assertEqual(service.manager.name,'laya')
    def test_adapter_refuses_bad_ids_and_unlicensed_route(self):
        with self.assertRaises(ValueError):research_adapter.classify([{'id':'x'},{'id':'x'}],QUESTION)
        with self.assertRaises(ValueError):research_adapter.classify([{'id':'x'}],QUESTION,'startlux')

class RangeLoaderTests(unittest.TestCase):
    def test_exact_bytes_dtypes_shapes_and_chunk_boundary(self):
        import torch
        from safetensors.torch import save_file
        import intern_backend as local
        tensors={'large':torch.arange(9*1024*1024,dtype=torch.float32),
                 'bfloat':torch.tensor([1.5,-2.0],dtype=torch.bfloat16),
                 'integer':torch.tensor([2,-7],dtype=torch.int64)}
        folder=Path(__file__).parent/'runtime/models/intern-decision-2b'
        original_empty=torch.empty
        def cpu_empty(*args,**kwargs):
            kwargs['device']='cpu';return original_empty(*args,**kwargs)
        with tempfile.TemporaryDirectory(prefix='range-unit-',dir=folder) as temporary:
            path=Path(temporary)/'test.safetensors';save_file(tensors,str(path))
            reader=local.RangeSafeOpen(path)
            with patch.object(torch,'empty',cpu_empty):
                for key,expected in tensors.items():
                    actual=reader.get_tensor(key)
                    self.assertEqual(actual.dtype,expected.dtype)
                    self.assertTrue(torch.equal(actual,expected))
                reader.spec['integer']['data_offsets'][1]+=1
                with self.assertRaises(ValueError):reader.get_tensor('integer')
    def test_range_loader_refuses_other_directories(self):
        import intern_backend as local
        with self.assertRaises(ValueError):local.RangeSafeOpen(Path(__file__))
    def test_failed_constructor_restores_scoped_library_symbols(self):
        import intern_backend as local
        original=local.hf_loading.safe_open;workers=local.hf_conversion.GLOBAL_WORKERS
        with patch.object(local.AutoTokenizer,'from_pretrained') as tokenizer,patch.object(local.AutoProcessor,'from_pretrained'),patch.object(local.Qwen3_5ForConditionalGeneration,'from_pretrained',side_effect=RuntimeError('test loading failure')):
            tokenizer.return_value.get_added_vocab.return_value={local.DECISION_TOKEN:1}
            with self.assertRaises(RuntimeError):local.DirectDeviceHFBackend('unused-by-fake-loader')
        self.assertIs(local.hf_loading.safe_open,original)
        self.assertEqual(local.hf_conversion.GLOBAL_WORKERS,workers)

if __name__=='__main__':unittest.main()
