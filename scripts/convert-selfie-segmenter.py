"""
Usage: python3 scripts/convert-selfie-segmenter.py selfie_segmenter.tflite models/selfie_segmenter.onnx
Convert MediaPipe selfie_segmenter.tflite (fp16 weights, NHWC) to ONNX (NCHW) for onnxruntime-node."""
import sys, struct
import numpy as np
import tflite
import onnx
from onnx import helper, TensorProto, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
buf = open(src, "rb").read()
m = tflite.Model.GetRootAsModel(buf, 0)
g = m.Subgraphs(0)
OPN = {v: k for k, v in tflite.BuiltinOperator.__dict__.items() if not k.startswith("_")}
TT = {0: np.float32, 1: np.float16, 2: np.int32, 3: np.uint8, 4: np.int64}

def tensor(i): return g.Tensors(i)
def shape(i): return [int(x) for x in tensor(i).ShapeAsNumpy()] if tensor(i).ShapeLength() else []
def data(i):
    t = tensor(i); b = m.Buffers(t.Buffer())
    if b.DataLength() == 0: return None
    return np.frombuffer(b.DataAsNumpy().tobytes(), dtype=TT[t.Type()]).reshape(shape(i) or [-1])

consts = {}  # tensor idx -> float32/int numpy (NHWC layout as stored)
nodes, inits = [], []
names = lambda i: f"t{i}"
counter = [0]
def uniq(p): counter[0] += 1; return f"{p}_{counter[0]}"

def const_name(arr, nm=None):
    nm = nm or uniq("c"); inits.append(numpy_helper.from_array(arr, nm)); return nm

def act(name, code):
    if code == 0: return name
    out = uniq("act")
    if code == 1: nodes.append(helper.make_node("Relu", [name], [out]))
    elif code == 3: nodes.append(helper.make_node("Clip", [name, const_name(np.array(0, np.float32)), const_name(np.array(6, np.float32))], [out]))
    else: raise NotImplementedError(f"activation {code}")
    return out

def same_pads(inp, k, s, d=1):
    out = -(-inp // s)
    total = max((out - 1) * s + (k - 1) * d + 1 - inp, 0)
    return total // 2, total - total // 2

def nchw_const(arr):
    if arr.ndim == 4: return np.transpose(arr, (0, 3, 1, 2))
    if arr.ndim == 1: return arr.reshape(1, -1, 1, 1)
    if arr.ndim == 3: return np.transpose(arr, (2, 0, 1))[None]
    return arr

alias = {}
def ref(i):
    if i in alias: return alias[i]
    if i in consts:
        a = consts[i]
        return const_name(nchw_const(a.astype(np.float32)) if a.dtype != np.int32 else a)
    return names(i)

inp = g.Inputs(0)
nodes.append(helper.make_node("Transpose", ["input"], [names(inp)], perm=[0, 3, 1, 2]))

for oi in range(g.OperatorsLength()):
    op = g.Operators(oi); oc = m.OperatorCodes(op.OpcodeIndex())
    code = max(oc.BuiltinCode(), oc.DeprecatedBuiltinCode()); name = OPN.get(code, code)
    ins = [op.Inputs(j) for j in range(op.InputsLength())]; outs = [op.Outputs(j) for j in range(op.OutputsLength())]
    o = names(outs[0])
    bo = op.BuiltinOptions()
    if name == "DEQUANTIZE":
        consts[outs[0]] = data(ins[0]).astype(np.float32); continue
    def w(i): return consts[i] if i in consts else data(i).astype(np.float32)
    if name in ("CONV_2D", "DEPTHWISE_CONV_2D"):
        if name == "CONV_2D":
            opt = tflite.Conv2DOptions(); opt.Init(bo.Bytes, bo.Pos)
        else:
            opt = tflite.DepthwiseConv2DOptions(); opt.Init(bo.Bytes, bo.Pos)
        W = w(ins[1]); B = w(ins[2]) if len(ins) > 2 and ins[2] >= 0 else None
        ih, iw = shape(ins[0])[1:3]
        if name == "CONV_2D":
            Wn = np.transpose(W, (0, 3, 1, 2)); group = 1
        else:
            Wn = np.transpose(W, (3, 0, 1, 2)); group = shape(ins[0])[3]
        kh, kw = Wn.shape[2:]
        sh, sw = opt.StrideH(), opt.StrideW()
        dh, dw = opt.DilationHFactor() or 1, opt.DilationWFactor() or 1
        if opt.Padding() == 0:  # SAME
            ph = same_pads(ih, kh, sh, dh); pw = same_pads(iw, kw, sw, dw); pads = [ph[0], pw[0], ph[1], pw[1]]
        else: pads = [0, 0, 0, 0]
        args = [ref(ins[0]), const_name(Wn)] + ([const_name(B)] if B is not None else [])
        tmp = uniq("conv")
        nodes.append(helper.make_node("Conv", args, [tmp], strides=[sh, sw], pads=pads, dilations=[dh, dw], group=group, kernel_shape=[kh, kw]))
        alias[outs[0]] = act(tmp, opt.FusedActivationFunction())
    elif name in ("ADD", "MUL"):
        opt = (tflite.AddOptions if name == "ADD" else tflite.MulOptions)(); fused = 0
        if bo is not None: opt.Init(bo.Bytes, bo.Pos); fused = opt.FusedActivationFunction()
        a = ref(ins[0]) if ins[0] not in consts else const_name(nchw_const(consts[ins[0]]))
        b = ref(ins[1]) if ins[1] not in consts else const_name(nchw_const(consts[ins[1]]))
        tmp = uniq(name.lower())
        nodes.append(helper.make_node("Add" if name == "ADD" else "Mul", [a, b], [tmp]))
        alias[outs[0]] = act(tmp, fused)
    elif name == "RELU":
        nodes.append(helper.make_node("Relu", [ref(ins[0])], [o]))
    elif name == "HARD_SWISH":
        nodes.append(helper.make_node("HardSwish", [ref(ins[0])], [o]))
    elif name == "LOGISTIC":
        nodes.append(helper.make_node("Sigmoid", [ref(ins[0])], [o]))
    elif name == "AVERAGE_POOL_2D":
        opt = tflite.Pool2DOptions(); opt.Init(bo.Bytes, bo.Pos)
        kh, kw = opt.FilterHeight(), opt.FilterWidth(); sh, sw = opt.StrideH(), opt.StrideW()
        ih, iw = shape(ins[0])[1:3]
        if opt.Padding() == 0:
            ph = same_pads(ih, kh, sh); pw = same_pads(iw, kw, sw); pads = [ph[0], pw[0], ph[1], pw[1]]
        else: pads = [0, 0, 0, 0]
        tmp = uniq("pool")
        nodes.append(helper.make_node("AveragePool", [ref(ins[0])], [tmp], kernel_shape=[kh, kw], strides=[sh, sw], pads=pads, count_include_pad=0))
        alias[outs[0]] = act(tmp, opt.FusedActivationFunction())
    elif name == "RESIZE_BILINEAR":
        opt = tflite.ResizeBilinearOptions(); opt.Init(bo.Bytes, bo.Pos)
        n, h, wdt, c = shape(outs[0])
        mode = "align_corners" if opt.AlignCorners() else ("half_pixel" if opt.HalfPixelCenters() else "asymmetric")
        sizes = const_name(np.array([n, c, h, wdt], np.int64))
        nodes.append(helper.make_node("Resize", [ref(ins[0]), "", "", sizes], [o], mode="linear", coordinate_transformation_mode=mode))
    elif name == 32 or name == "CUSTOM":
        cc = oc.CustomCode()
        assert cc == b"Convolution2DTransposeBias", cc
        raw = op.CustomOptionsAsNumpy().tobytes()
        padding, stride_w, stride_h = struct.unpack("<3i", raw[:12])
        W = w(ins[1]); B = w(ins[2])  # W: [O, H, W, I]
        Wn = np.transpose(W, (3, 0, 1, 2))  # [I, O, kH, kW]
        kh, kw = Wn.shape[2:]
        ih, iw = shape(ins[0])[1:3]; oh, ow = shape(outs[0])[1:3]
        def tp(inp_, out_, k, s):
            total = max((inp_ - 1) * s + k - out_, 0); return total // 2, total - total // 2
        ph, pw = tp(ih, oh, kh, stride_h), tp(iw, ow, kw, stride_w)
        nodes.append(helper.make_node("ConvTranspose", [ref(ins[0]), const_name(Wn), const_name(B)], [o], strides=[stride_h, stride_w], pads=[ph[0], pw[0], ph[1], pw[1]], kernel_shape=[kh, kw]))
    else:
        raise NotImplementedError(name)

out_t = g.Outputs(0)
nodes.append(helper.make_node("Identity", [ref(out_t)], ["mask"]))
s_in = shape(inp); s_out = shape(out_t)
graph = helper.make_graph(nodes, "selfie_segmenter",
    [helper.make_tensor_value_info("input", TensorProto.FLOAT, s_in)],
    [helper.make_tensor_value_info("mask", TensorProto.FLOAT, [s_out[0], s_out[3], s_out[1], s_out[2]])], inits)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], producer_name="askby-tflite2onnx")
model.ir_version = 8
# fp16 storage to halve the file; onnx Cast nodes would add overhead, so keep fp32 (file ~0.5 MB)
onnx.checker.check_model(model)
onnx.save(model, dst)
print("ok", s_in, "->", s_out, len(nodes), "nodes")
