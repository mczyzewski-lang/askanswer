# Models

## selfie_segmenter.onnx

Person/background segmentation used for **background blur** behind the expert.

- Source: MediaPipe *Selfie Segmenter* (square, 256×256, float16) —
  `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`
- License: Apache License 2.0 (Google MediaPipe).
- Converted to ONNX (NCHW, opset 17) with `scripts/convert-selfie-segmenter.py`
  (custom converter: the MediaPipe `Convolution2DTransposeBias` op becomes ONNX `ConvTranspose`).
- Input `input` [1,256,256,3] RGB in 0..1 (NHWC); output `mask` [1,1,256,256], 0 = background, 1 = person.

Re-create: `python3 scripts/convert-selfie-segmenter.py selfie_segmenter.tflite models/selfie_segmenter.onnx`
(needs `pip install tflite onnx numpy`).
