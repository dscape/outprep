/* Maia-3 browser inference worker. See THIRD_PARTY_NOTICES.md. */
importScripts("/ort/ort.wasm.min.js");

ort.env.logLevel = "error";
ort.env.wasm.wasmPaths = "/ort/";
ort.env.wasm.numThreads = 1;

const MODEL_URL = "/models/maia3-simplified.onnx";
const MODEL_VERSION = "maia3-simplified-405bf76c";
const MODEL_SHA256 = "405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856";
const DB_NAME = "outprep-maia-models";
const STORE_NAME = "models";
let session = null;
let initialization = null;

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      initialization ||= initialize();
      await initialization;
      postMessage({ type: "ready" });
      return;
    }

    if (message.type === "inference") {
      initialization ||= initialize();
      await initialization;
      const tokens = new Float32Array(message.tokens);
      const result = await session.run({
        tokens: new ort.Tensor("float32", tokens, [1, 64, 12]),
        elo_self: new ort.Tensor("float32", Float32Array.of(message.selfRating), [1]),
        elo_oppo: new ort.Tensor("float32", Float32Array.of(message.opponentRating), [1]),
      });
      const logits = new Float32Array(result.logits_move.data);
      postMessage(
        { type: "result", id: message.id, logits: logits.buffer },
        [logits.buffer],
      );
    }
  } catch (error) {
    postMessage({
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

async function initialize() {
  postMessage({ type: "status", status: "loading-model" });
  let model = await loadCachedModel();
  if (model) {
    try {
      await verifyModel(model);
    } catch {
      await deleteCachedModel().catch(() => {});
      model = null;
    }
  }
  if (!model) {
    model = await downloadModel();
    await verifyModel(model);
    await cacheModel(model).catch(() => {});
  }
  session = await ort.InferenceSession.create(model, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
}

async function downloadModel() {
  const response = await fetch(MODEL_URL, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Maia model download failed (${response.status})`);
  if (!response.body) return response.arrayBuffer();

  const total = Number(response.headers.get("Content-Length") || 0);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0) {
      postMessage({
        type: "status",
        status: "downloading-model",
        progress: Math.min(100, Math.round((received / total) * 100)),
      });
    }
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function verifyModel(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== MODEL_SHA256) {
    throw new Error("Maia model integrity check failed");
  }
}

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "version" });
      }
    };
  });
}

async function loadCachedModel() {
  try {
    const database = await openDatabase();
    const record = await new Promise((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(MODEL_VERSION);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return record?.model || null;
  } catch {
    return null;
  }
}

async function deleteCachedModel() {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, "readwrite")
      .objectStore(STORE_NAME)
      .delete(MODEL_VERSION);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
}

async function cacheModel(model) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, "readwrite")
      .objectStore(STORE_NAME)
      .put({ version: MODEL_VERSION, model, savedAt: Date.now() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
}
