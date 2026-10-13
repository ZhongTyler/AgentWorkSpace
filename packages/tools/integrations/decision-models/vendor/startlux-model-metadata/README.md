---
license: cc-by-nc-4.0
base_model: startlux-models/StartLux-Decision-v1-4B
base_model_relation: quantized
tags:
- gguf
- llama.cpp
- decision-model
- typed-decisions
---

# StartLux-Decision-v1-4B-Q8_0-GGUF

[StartLux-Decision-v1-4B](https://huggingface.co/startlux-models/StartLux-Decision-v1-4B) in Q8_0 (8-bit) as a GGUF file for
llama.cpp. The decision server in this repository turns it into the same typed decisions, with a probability for every
option, as the original model.

## Precisions

<div align="center">

| Repository | Bits | Size | Same decision as the original | JevBench public, of 231 | |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **StartLux-Decision-v1-4B-Q8_0-GGUF** (this repository) | 8-bit | 4.48 GB | 100.0% | 204 (88.3%) | recommended |
| [StartLux-Decision-v1-4B-Q4_K_M-GGUF](https://huggingface.co/startlux-models/StartLux-Decision-v1-4B-Q4_K_M-GGUF) | 4-bit | 2.71 GB | 98.3% | 201 (87.0%) | smallest |
| [StartLux-Decision-v1-4B-BF16-GGUF](https://huggingface.co/startlux-models/StartLux-Decision-v1-4B-BF16-GGUF) | 16-bit | 8.42 GB | 100.0% | 204 (88.3%) | the original weights, unchanged |
| [StartLux-Decision-v1-4B](https://huggingface.co/startlux-models/StartLux-Decision-v1-4B) (original weights) | | | | 204 (88.3%) | for comparison |

</div>

"Same decision" is the share of the 231 public JevBench items on which the file picks the same answer as the original
weights run through the `startlux_decision` package, with the same prompts, readout and temperatures. Q8_0 and Q4_K_M
are llama.cpp's standard quantizations of BF16, without an importance matrix.

## Download and run

```bash
hf download startlux-models/StartLux-Decision-v1-4B-Q8_0-GGUF --local-dir StartLux-Decision-v1-4B-Q8_0-GGUF
cd StartLux-Decision-v1-4B-Q8_0-GGUF
pip install -r requirements.txt                     # transformers and torch; a CPU build of torch is enough

# llama.cpp serves the weights; the decision server puts the prompt format, readout and calibration on top
llama-server -m StartLux-Decision-4B-Q8_0.gguf -ngl 99 -c 16384 --parallel 4 --port 8081 &
python -m startlux_decision.gguf_server --model-dir . --llama http://127.0.0.1:8081 --port 8090
```

`-ngl 99` puts every layer on the GPU (CUDA or Metal); leave it out on a CPU-only machine. llama.cpp has to be recent
enough for this model (build b10454 or newer).

Requests and responses use the TypeSafe `/v1/systemone` format:

```bash
curl -s localhost:8090/v1/systemone -H 'Content-Type: application/json' -d '{
  "state": {"ticket": "I was charged twice for order #4411 and the app still shows it as unpaid."},
  "questions": {
    "team":   {"type": "choice", "instructions": "Which team should handle this ticket?",
               "criteria": {"billing": "Payments, refunds and invoices",
                            "shipping": "Delivery and tracking",
                            "technical": "App, login and account problems"}},
    "urgent": {"type": "noul", "instructions": "Should this ticket be answered today?"}
  }
}'
```

Plain chat with a GGUF file does not give these decisions: the option-letter readout and the per-type temperatures live
in `gguf_server.py`, not in the weights. The file holds the text decoder only.

## License

The model weights are released under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/): free for
research and other non-commercial use, with attribution. Commercial use requires a separate license from
StartLux Labs; contact [contact@startlux.com](mailto:contact@startlux.com). The inference code in
`startlux_decision/` is Apache-2.0. See [LICENSE](https://huggingface.co/startlux-models/StartLux-Decision-v1-4B-Q8_0-GGUF/blob/main/LICENSE) and [NOTICE](https://huggingface.co/startlux-models/StartLux-Decision-v1-4B-Q8_0-GGUF/blob/main/NOTICE).
