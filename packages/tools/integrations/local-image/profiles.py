"""Finite audited Comfy profiles; no study script is a runtime dependency."""
PROFILE_VERSION = 'supervised-v1'
PROFILES = {
    'flux': {'title':'FLUX.2 klein 4B', 'steps':4, 'reference':True,
             'licenses':'Apache-2.0; references/content separately cleared'},
    'anima': {'title':'Anima Turbo 1.1', 'steps':8, 'reference':False,
              'licenses':'Model noncommercial; commercial generated offline images permitted; no commercial runtime eligibility'},
    'zimage': {'title':'Z-Image-Turbo INT8', 'steps':8, 'reference':False,
               'licenses':'Apache-2.0; final text requires literal QA'},
}

def node(kind, **inputs): return {'class_type':kind, 'inputs':inputs}

def graph(profile, prompt, width, height, seed, prefix, reference=None):
    if profile not in PROFILES: raise ValueError('Unknown fixed profile')
    if reference and not PROFILES[profile]['reference']: raise ValueError('Native reference editing unavailable for this profile')
    if profile=='flux':
        g={'1':node('UNETLoader',unet_name='flux-2-klein-4b-fp8.safetensors',weight_dtype='default'),
           '2':node('CLIPLoader',clip_name='qwen_3_4b_fp4_flux2.safetensors',type='flux2',device='default'),
           '3':node('VAELoader',vae_name='flux2-vae.safetensors'),
           '4':node('CLIPTextEncode',text=prompt,clip=['2',0]),
           '5':node('EmptyFlux2LatentImage',width=width,height=height,batch_size=1),
           '6':node('RandomNoise',noise_seed=seed),
           '7':node('BasicGuider',model=['1',0],conditioning=['4',0]),
           '8':node('KSamplerSelect',sampler_name='euler'),
           '9':node('Flux2Scheduler',steps=4,width=width,height=height),
           '10':node('SamplerCustomAdvanced',noise=['6',0],guider=['7',0],sampler=['8',0],sigmas=['9',0],latent_image=['5',0]),
           '11':node('VAEDecode',samples=['10',0],vae=['3',0]),
           '12':node('SaveImage',images=['11',0],filename_prefix=prefix)}
        if reference:
            g.update({'13':node('LoadImage',image=reference), '14':node('VAEEncode',pixels=['13',0],vae=['3',0]),
                      '15':node('ReferenceLatent',conditioning=['4',0],latent=['14',0])})
            g['7']['inputs']['conditioning']=['15',0]
        return g
    if profile=='anima':
        return {'1':node('UNETLoader',unet_name='anima-turbo-v1.1.safetensors',weight_dtype='default'),
                '2':node('CLIPLoader',clip_name='qwen_3_06b_base.safetensors',type='stable_diffusion',device='default'),
                '3':node('VAELoader',vae_name='qwen_image_vae.safetensors'),
                '4':node('CLIPTextEncode',text=prompt,clip=['2',0]),
                '5':node('CLIPTextEncode',text='worst quality, low quality, blurry, jpeg artifacts',clip=['2',0]),
                '6':node('EmptyLatentImage',width=width,height=height,batch_size=1),
                '8':node('KSampler',model=['1',0],positive=['4',0],negative=['5',0],latent_image=['6',0],seed=seed,steps=8,cfg=1.0,sampler_name='euler',scheduler='simple',denoise=1.0),
                '9':node('VAEDecode',samples=['8',0],vae=['3',0]),
                '12':node('SaveImage',images=['9',0],filename_prefix=prefix)}
    return {'1':node('UNETLoader',unet_name='z_image_turbo_int8_convrot.safetensors',weight_dtype='default'),
            '2':node('CLIPLoader',clip_name='qwen_3_4b_fp4_mixed.safetensors',type='lumina2',device='default'),
            '3':node('VAELoader',vae_name='ae.safetensors'),
            '4':node('CLIPTextEncode',text=prompt,clip=['2',0]),
            '5':node('ConditioningZeroOut',conditioning=['4',0]),
            '6':node('EmptySD3LatentImage',width=width,height=height,batch_size=1),
            '7':node('ModelSamplingAuraFlow',model=['1',0],shift=3.0),
            '8':node('KSampler',model=['7',0],positive=['4',0],negative=['5',0],latent_image=['6',0],seed=seed,steps=8,cfg=1.0,sampler_name='res_multistep',scheduler='simple',denoise=1.0),
            '9':node('VAEDecode',samples=['8',0],vae=['3',0]),
            '12':node('SaveImage',images=['9',0],filename_prefix=prefix)}
