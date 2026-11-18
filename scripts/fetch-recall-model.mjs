// Downloads the sentence-embedding model used for on-device recall
// (Snowflake/snowflake-arctic-embed-xs) and stores its weights as f16, which
// halves the bundle. The app widens them to f32 when loading.
import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "Snowflake/snowflake-arctic-embed-xs";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "resources", "recall-model");

async function download(file) {
  const response = await fetch(`https://huggingface.co/${REPO}/resolve/main/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function readSafetensors(buffer) {
  const headerLength = Number(buffer.readBigUInt64LE(0));
  const header = JSON.parse(buffer.subarray(8, 8 + headerLength).toString("utf8"));
  const base = 8 + headerLength;
  const tensors = {};
  for (const [name, info] of Object.entries(header)) {
    if (name === "__metadata__") continue;
    const [start, end] = info.data_offsets;
    tensors[name] = { dtype: info.dtype, shape: info.shape, data: buffer.subarray(base + start, base + end) };
  }
  return tensors;
}

function writeSafetensors(tensors) {
  const header = {};
  let offset = 0;
  for (const [name, tensor] of Object.entries(tensors)) {
    header[name] = { dtype: tensor.dtype, shape: tensor.shape, data_offsets: [offset, offset + tensor.data.length] };
    offset += tensor.data.length;
  }
  let json = JSON.stringify(header);
  json += " ".repeat((8 - (json.length % 8)) % 8);
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([length, Buffer.from(json), ...Object.values(tensors).map((tensor) => tensor.data)]);
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(value) {
  f32[0] = value;
  const bits = u32[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  const mantissa = bits & 0x7fffff;
  if (exponent >= 31) return sign | 0x7c00;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    const shifted = (mantissa | 0x800000) >> (1 - exponent);
    return sign | ((shifted + 0x1000) >> 13);
  }
  return sign | (exponent << 10) | ((mantissa + 0x1000) >> 13);
}

function halfTensor(tensor) {
  if (tensor.dtype !== "F32") return tensor;
  const values = new Float32Array(tensor.data.buffer.slice(tensor.data.byteOffset, tensor.data.byteOffset + tensor.data.length));
  const out = Buffer.alloc(values.length * 2);
  for (let index = 0; index < values.length; index++) out.writeUInt16LE(toHalf(values[index]), index * 2);
  return { dtype: "F16", shape: tensor.shape, data: out };
}

async function main() {
  const target = join(OUT, "model.safetensors");
  if (process.argv.includes("--if-missing")) {
    try { await access(target); console.log("Recall model already present."); return; } catch { /* download */ }
  }
  await mkdir(OUT, { recursive: true });
  const [tokenizer, config, model] = await Promise.all(["tokenizer.json", "config.json", "model.safetensors"].map(download));
  const tensors = readSafetensors(model);
  const converted = Object.fromEntries(Object.entries(tensors).map(([name, tensor]) => [name, halfTensor(tensor)]));
  const output = writeSafetensors(converted);
  await writeFile(target, output);
  await writeFile(join(OUT, "tokenizer.json"), tokenizer);
  await writeFile(join(OUT, "config.json"), config);
  console.log(`Saved ${REPO} as f16 (${(output.length / 1e6).toFixed(1)} MB) to ${OUT}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
