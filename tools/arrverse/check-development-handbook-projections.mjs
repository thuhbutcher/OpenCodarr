#!/usr/bin/env node
// Offline local evidence only. Inputs are explicit files and independently
// selected expectations; matching receipts does not authenticate a Git origin.
import { createHash } from "node:crypto"
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs"

export const MAX_FILE_BYTES = 262144
const ORIGIN_REPOSITORY = "thuhbutcher/ArrVerseReconstruction"
const ORIGIN_PATH = "OpenBrainarr/docs/reconstruction/DEVELOPMENT_SERVICE_HANDBOOK.md"
const CODARR_REPOSITORY = "thuhbutcher/OpenCodarr"
const CODARR_PATH = "docs/arrverse/DEVELOPMENT_SERVICE_HANDBOOK.md"
const FORMAT = "development-handbook-projection-receipt"
const FORMAT_STATUS = "occurrence-local evidence; not a registered owner protocol"
const COMMIT_BINDING = "the containing commit; external projection pins its exact commit"
const OPTIONS = {
  "--brain-handbook": "brainHandbook",
  "--brain-binding": "brainBinding",
  "--codarr-handbook": "codarrHandbook",
  "--codarr-binding": "codarrBinding",
  "--expected-origin-commit": "expectedOriginCommit",
  "--expected-revision": "expectedRevision",
  "--expected-sha256": "expectedSha256",
  "--expected-bytes": "expectedBytes",
}
const USAGE = "node check-development-handbook-projections.mjs " +
  "--brain-handbook <file> --brain-binding <file> " +
  "--codarr-handbook <file> --codarr-binding <file> " +
  "--expected-origin-commit <40-lowercase-hex> --expected-revision <revision> " +
  "--expected-sha256 <64-lowercase-hex> --expected-bytes <positive-integer>"

class HandbookError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function fail(code) {
  throw new HandbookError(code)
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) fail(code)
}

function boundedText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 &&
    value.trim().length > 0 && value.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(value)
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

// Reuses the SDK's regularBytes/readEnvelopeFile boundary: lstat + descriptor
// checks, no-follow/nonblocking open where supported, limit+1 read, fatal UTF-8.
// Raw bytes are hashed without line-ending, BOM, Unicode or JSON normalization.
function readBoundedUtf8(filename) {
  let fd
  try {
    if (!lstatSync(filename).isFile()) fail("INPUT_NOT_REGULAR")
    fd = openSync(filename, constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    if (!fstatSync(fd).isFile()) fail("INPUT_NOT_REGULAR")
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
    let size = 0
    while (size < buffer.length) {
      const read = readSync(fd, buffer, size, buffer.length - size, null)
      if (read === 0) break
      size += read
    }
    if (size > MAX_FILE_BYTES) fail("INPUT_BUDGET")
    const bytes = buffer.subarray(0, size)
    try {
      return { bytes, text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) }
    } catch {
      fail("INPUT_UTF8")
    }
  } catch (error) {
    if (error instanceof HandbookError) throw error
    fail("INPUT_UNREADABLE")
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function readBinding(file) {
  try {
    return parseOwnerJson(file.text)
  } catch (error) {
    if (error instanceof WireError && error.code === "DUPLICATE_JSON_KEY")
      fail("BINDING_DUPLICATE_KEY")
    fail("BINDING_JSON_INVALID")
  }
}

function checkBinding(binding, client, expected) {
  exactKeys(binding, [
    "format", "formatStatus", "revision", "sha256", "bytes", "origin", "projection",
    "guidanceLoader", "sourceState", "installedOpenCode", "nativeActivation", "effectAuthority",
  ], "BINDING_SHAPE")
  if (binding.format !== FORMAT || binding.formatStatus !== FORMAT_STATUS ||
      !boundedText(binding.guidanceLoader)) fail("BINDING_FORMAT")
  if (binding.revision !== expected.expectedRevision) fail("BINDING_REVISION")
  if (binding.sha256 !== expected.expectedSha256) fail("BINDING_DIGEST")
  if (!Number.isSafeInteger(binding.bytes) || binding.bytes !== expected.expectedBytes)
    fail("BINDING_LENGTH")
  if (binding.sourceState !== "AUTHORED" || binding.installedOpenCode !== "NOT_APPLIED" ||
      binding.nativeActivation !== "UNVERIFIED" || binding.effectAuthority !== false)
    fail("BINDING_EVIDENCE_CEILING")

  exactKeys(binding.origin, client === "OpenBrainarr"
    ? ["repository", "sourcePath", "commitBinding"]
    : ["repository", "sourcePath", "commit", "url"], "ORIGIN_SHAPE")
  if (binding.origin.repository !== ORIGIN_REPOSITORY ||
      binding.origin.sourcePath !== ORIGIN_PATH) fail("ORIGIN_IDENTITY")
  if (client === "OpenBrainarr" && binding.origin.commitBinding !== COMMIT_BINDING)
    fail("ORIGIN_COMMIT_BINDING")
  if (client === "OpenCodarr" &&
      (binding.origin.commit !== expected.expectedOriginCommit ||
       binding.origin.url !== "https://github.com/" + ORIGIN_REPOSITORY + "/blob/" +
         expected.expectedOriginCommit + "/" + ORIGIN_PATH)) fail("ORIGIN_COMMIT")

  exactKeys(binding.projection, ["repository", "path"], "PROJECTION_SHAPE")
  if (binding.projection.repository !== (client === "OpenBrainarr" ? ORIGIN_REPOSITORY : CODARR_REPOSITORY) ||
      binding.projection.path !== (client === "OpenBrainarr" ? ORIGIN_PATH : CODARR_PATH))
    fail("PROJECTION_IDENTITY")
}

export function checkDevelopmentHandbookProjections(options) {
  exactKeys(options, Object.values(OPTIONS), "EXPECTED_SELECTION_INVALID")
  if (typeof options.expectedOriginCommit !== "string" ||
      !/^[0-9a-f]{40}$/.test(options.expectedOriginCommit) ||
      !boundedText(options.expectedRevision) ||
      typeof options.expectedSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(options.expectedSha256) ||
      !Number.isSafeInteger(options.expectedBytes) ||
      options.expectedBytes < 1 || options.expectedBytes > MAX_FILE_BYTES ||
      ["brainHandbook", "brainBinding", "codarrHandbook", "codarrBinding"].some(
        (key) => typeof options[key] !== "string" || options[key].length === 0 || options[key].includes("\0")))
    fail("EXPECTED_SELECTION_INVALID")

  const brain = readBoundedUtf8(options.brainHandbook)
  const codarr = readBoundedUtf8(options.codarrHandbook)
  const brainBinding = readBoundedUtf8(options.brainBinding)
  const codarrBinding = readBoundedUtf8(options.codarrBinding)
  checkBinding(readBinding(brainBinding), "OpenBrainarr", options)
  checkBinding(readBinding(codarrBinding), "OpenCodarr", options)
  if (!brain.bytes.equals(codarr.bytes)) fail("HANDBOOK_BYTES_DIFFER")
  if (brain.bytes.length !== options.expectedBytes) fail("HANDBOOK_LENGTH")
  if (sha256(brain.bytes) !== options.expectedSha256) fail("HANDBOOK_DIGEST")

  return {
    format: "development-handbook-projection-check",
    formatStatus: FORMAT_STATUS,
    status: "PASS_LOCAL_SOURCE_CONSISTENCY",
    revision: options.expectedRevision,
    expectedOrigin: {
      repository: ORIGIN_REPOSITORY,
      sourcePath: ORIGIN_PATH,
      commit: options.expectedOriginCommit,
      selection: "CALLER_SUPPLIED",
    },
    handbook: { sha256: options.expectedSha256, bytes: brain.bytes.length, rawBytesEqual: true, utf8Valid: true },
    bindings: [
      { client: "OpenBrainarr", sha256: sha256(brainBinding.bytes), bytes: brainBinding.bytes.length },
      { client: "OpenCodarr", sha256: sha256(codarrBinding.bytes), bytes: codarrBinding.bytes.length },
    ],
    sourceAuthentication: false,
    ownerApplication: false,
    authorityEffect: "NONE",
    installedOpenCode: "NOT_APPLIED",
    nativeActivation: "UNVERIFIED",
  }
}

function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log(USAGE)
    return 0
  }
  const options = {}
  if (args.length !== Object.keys(OPTIONS).length * 2) {
    console.error("HANDBOOK_USAGE: " + USAGE)
    return 64
  }
  for (let i = 0; i < args.length; i += 2) {
    const name = Object.hasOwn(OPTIONS, args[i]) ? OPTIONS[args[i]] : undefined
    if (!name || Object.hasOwn(options, name) || !args[i + 1] || args[i + 1].startsWith("--")) {
      console.error("HANDBOOK_USAGE: " + USAGE)
      return 64
    }
    options[name] = args[i + 1]
  }
  if (!/^[1-9][0-9]*$/.test(options.expectedBytes)) {
    console.error("HANDBOOK_USAGE: " + USAGE)
    return 64
  }
  options.expectedBytes = Number(options.expectedBytes)
  try {
    console.log(JSON.stringify(checkDevelopmentHandbookProjections(options), null, 2))
    return 0
  } catch (error) {
    console.error(JSON.stringify({
      status: "REJECTED",
      code: error instanceof HandbookError ? error.code : "INPUT_REJECTED",
      sourceAuthentication: false,
      ownerApplication: false,
      authorityEffect: "NONE",
      installedOpenCode: "NOT_APPLIED",
      nativeActivation: "UNVERIFIED",
    }))
    return 2
  }
}

// The strict JSON boundary below is reused from the selected SDK source:
// ArrVerseCodeShare@577683f865c41de26a1dc92e40291bb34eaa8cfa
// implementation/arrverse-sdk-r1-taskarr-monitarr-20260925/read-boundary/json.ts
// Git blob f89e4e13b9fa5c561cd89caaeba66b827bac5950.
// Its TypeScript-erased JavaScript is inlined, with export modifiers removed,
// so either mirrored checker is standalone. This is not a new SDK contract.
class WireError extends Error {
    code;
    field;
    constructor(code, field = "$"){
        super(`${code}:${field}`), this.code = code, this.field = field;
    }
}
const forbidden = new Set([
    "constructor",
    "prototype",
    "__proto__",
    "then"
]);
function jsonSnapshot(value) {
    let nodes = 0;
    const active = new Set();
    function copy(v, depth) {
        if (++nodes > 100000 || depth > 32) throw new WireError("JSON_BUDGET");
        if (v === null || typeof v === "boolean" || typeof v === "string") return v;
        if (typeof v === "number") {
            if (!Number.isFinite(v) || Number.isInteger(v) && !Number.isSafeInteger(v)) throw new WireError("UNSAFE_JSON_NUMBER");
            return v;
        }
        if (typeof v !== "object" || active.has(v)) throw new WireError("NOT_JSON_DATA");
        if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new WireError("NOT_PLAIN_JSON");
        if (Object.getOwnPropertySymbols(v).length || Array.isArray(v) && (Object.keys(v).length !== v.length || !Object.keys(v).every((k, i)=>k === String(i)))) throw new WireError("NOT_JSON_ARRAY_OR_SYMBOL");
        active.add(v);
        const out = Array.isArray(v) ? [] : Object.create(null);
        for (const key of Object.keys(v)){
            if (forbidden.has(key)) throw new WireError("UNSAFE_JSON_KEY");
            const descriptor = Object.getOwnPropertyDescriptor(v, key);
            if (!("value" in descriptor)) throw new WireError("JSON_ACCESSOR");
            out[key] = copy(descriptor.value, depth + 1);
        }
        active.delete(v);
        return Object.freeze(out);
    }
    return copy(value, 0);
}
function validateNumberLexeme(raw) {
    const value = Number(raw);
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) throw new WireError("UNSAFE_JSON_NUMBER");
    const [mantissa, exponent = "0"] = raw.replace(/^-/, "").split(/[eE]/);
    const digits = mantissa.replace(".", "");
    if (/^0+$/.test(digits)) return;
    if (value === 0) throw new WireError("JSON_NUMBER_UNDERFLOW");
    if (!Number.isInteger(value)) return;
    const significant = digits.replace(/^0+/, "");
    const fractionDigits = mantissa.includes(".") ? mantissa.length - mantissa.indexOf(".") - 1 : 0;
    const scale = Number(exponent) - fractionDigits;
    if (!Number.isSafeInteger(scale)) throw new WireError("LOSSY_JSON_INTEGER");
    let integral;
    if (scale < 0) {
        const trim = -scale;
        if (trim >= significant.length || !/^[0]+$/.test(significant.slice(significant.length - trim))) throw new WireError("LOSSY_JSON_INTEGER");
        integral = significant.slice(0, significant.length - trim);
    } else {
        if (significant.length + scale > 16) throw new WireError("LOSSY_JSON_INTEGER");
        integral = significant + "0".repeat(scale);
    }
    if (integral !== String(Math.abs(value))) throw new WireError("LOSSY_JSON_INTEGER");
}
function parseOwnerJson(text) {
    if (text.length > 4194304) throw new WireError("JSON_BUDGET");
    const parsed = JSON.parse(text);
    let i = 0;
    const space = ()=>{
        while(/\s/.test(text[i] ?? '') && i < text.length)i++;
    };
    function string() {
        const start = i++;
        while(i < text.length){
            const ch = text[i++];
            if (ch === '\\') i++;
            else if (ch === '"') return JSON.parse(text.slice(start, i));
        }
        throw new WireError('JSON_STRING');
    }
    function scan(depth) {
        if (depth > 32) throw new WireError('JSON_BUDGET');
        space();
        if (text[i] === '"') {
            string();
            return;
        }
        if (text[i] === '{') {
            i++;
            space();
            const seen = new Set();
            if (text[i] === '}') {
                i++;
                return;
            }
            while(i < text.length){
                space();
                const key = string();
                if (seen.has(key)) throw new WireError('DUPLICATE_JSON_KEY');
                seen.add(key);
                space();
                i++;
                scan(depth + 1);
                space();
                if (text[i++] === '}') return;
            }
        } else if (text[i] === '[') {
            i++;
            space();
            if (text[i] === ']') {
                i++;
                return;
            }
            while(i < text.length){
                scan(depth + 1);
                space();
                if (text[i++] === ']') return;
            }
        } else {
            const start = i;
            while(i < text.length && !/[\s,\]}]/.test(text[i]))i++;
            if (/[-0-9]/.test(text[start])) validateNumberLexeme(text.slice(start, i));
        }
    }
    scan(0);
    return jsonSnapshot(parsed);
}

// Node's entrypoint identity includes CLI aliases; argv path equality does not.
if (typeof import.meta.main !== "boolean")
  throw new Error("HANDBOOK_RUNTIME_UNSUPPORTED: Node.js 24.2.0+ is required")
if (import.meta.main) process.exitCode = main(process.argv.slice(2))
