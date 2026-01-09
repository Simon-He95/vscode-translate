import argparse
import os
import threading
import time
from typing import List, Literal, Optional

from flask import Flask, jsonify, request

# Lazy import heavy deps to make error messages clearer
try:
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer, pipeline
except Exception as e:  # pragma: no cover
    pipeline = None
    AutoTokenizer = None
    AutoModelForSeq2SeqLM = None
    _IMPORT_ERROR = e
else:
    _IMPORT_ERROR = None

app = Flask(__name__)

_server = None
_started_at = time.time()
_last_request_at = time.time()

TranslatorDirection = Literal["en-zh", "zh-en"]


def _is_truthy_env(name: str, default: str = "0") -> bool:
    v = os.environ.get(name, default)
    return str(v).strip().lower() not in ("", "0", "false", "no", "off")


def _resolve_model(direction: TranslatorDirection) -> str:
    # Explicit per-direction model path/name wins.
    if direction == "en-zh":
        explicit = os.environ.get("VSCODE_TRANSLATE_MODEL_EN_ZH", "").strip()
        default = "Helsinki-NLP/opus-mt-en-zh"
    else:
        explicit = os.environ.get("VSCODE_TRANSLATE_MODEL_ZH_EN", "").strip()
        default = "Helsinki-NLP/opus-mt-zh-en"

    if explicit:
        return explicit

    # Optional model root: <root>/en-zh and <root>/zh-en
    root = os.environ.get("VSCODE_TRANSLATE_MODEL_ROOT", "").strip()
    if root:
        candidate = os.path.join(root, direction)
        if os.path.exists(candidate):
            return candidate

    return default


def _touch():
    global _last_request_at
    _last_request_at = time.time()


def _load_translator(direction: TranslatorDirection):
    if pipeline is None:
        raise RuntimeError(
            "Failed to import transformers. Install dependencies first. "
            f"Original error: {_IMPORT_ERROR}"
        )

    model_id = _resolve_model(direction)
    offline = _is_truthy_env("VSCODE_TRANSLATE_OFFLINE", "0")

    try:
        if offline:
            if AutoTokenizer is None or AutoModelForSeq2SeqLM is None:
                raise RuntimeError(
                    "transformers AutoTokenizer/AutoModelForSeq2SeqLM not available; "
                    "check your transformers installation"
                )
            tokenizer = AutoTokenizer.from_pretrained(model_id, local_files_only=True)
            model = AutoModelForSeq2SeqLM.from_pretrained(model_id, local_files_only=True)
            return pipeline("translation", model=model, tokenizer=tokenizer)
        else:
            return pipeline("translation", model=model_id)
    except Exception as e:
        hint = (
            "Offline mode requires model files to exist locally. "
            "Set translate.local.model.enZh / zhEn to a local path, or set translate.local.model.root "
            "to a folder containing subfolders 'en-zh' and 'zh-en'."
        )
        raise RuntimeError(
            f"Failed to load translator for {direction}. model={model_id!r} offline={offline}. "
            f"{hint} Original error: {e}"
        )


_translators = {}


def _get_translator(direction: TranslatorDirection):
    if direction not in _translators:
        _translators[direction] = _load_translator(direction)
    return _translators[direction]


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "uptimeSec": int(time.time() - _started_at),
            "hasTransformers": pipeline is not None,
            "offline": _is_truthy_env("VSCODE_TRANSLATE_OFFLINE", "0"),
            "models": {
                "en-zh": _resolve_model("en-zh"),
                "zh-en": _resolve_model("zh-en"),
            },
            "loaded": sorted(list(_translators.keys())),
            "pid": os.getpid(),
        }
    )


@app.post("/translate")
def translate():
    _touch()
    data = request.get_json(force=True, silent=True) or {}
    texts: List[str] = data.get("texts") or []
    source = (data.get("sourceLang") or "auto").lower()
    target = (data.get("targetLang") or "auto").lower()

    if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
        return jsonify({"error": "texts must be string[]"}), 400

    # Minimal routing: only en<->zh is supported for MVP
    if source.startswith("en") and target.startswith("zh"):
        direction: TranslatorDirection = "en-zh"
    elif source.startswith("zh") and target.startswith("en"):
        direction = "zh-en"
    else:
        return jsonify({"error": "Only en<->zh supported in MVP"}), 400

    translator = _get_translator(direction)
    results = translator(texts)
    translated = [r.get("translation_text", "") for r in results]
    return jsonify({"translated": translated})


@app.post("/shutdown")
def shutdown():
    _touch()

    def _do_shutdown():
        # give response a chance to flush
        time.sleep(0.05)
        if _server is not None:
            _server.shutdown()

    threading.Thread(target=_do_shutdown, daemon=True).start()
    return jsonify({"ok": True})


def _idle_reaper(idle_timeout_ms: int):
    if idle_timeout_ms <= 0:
        return

    while True:
        time.sleep(1)
        idle_ms = (time.time() - _last_request_at) * 1000
        if idle_ms >= idle_timeout_ms:
            try:
                if _server is not None:
                    _server.shutdown()
            finally:
                return


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--idle-timeout-ms", type=int, default=int(os.environ.get("VSCODE_TRANSLATE_IDLE_TIMEOUT_MS", "0")))
    args = parser.parse_args()

    # Ensure logs flush immediately so the extension can parse READY line
    os.environ.setdefault("PYTHONUNBUFFERED", "1")

    from werkzeug.serving import make_server

    global _server
    _server = make_server(args.host, args.port, app)
    actual_port = _server.socket.getsockname()[1]

    # Signal readiness to the VS Code extension
    print(f"LOCAL_TRANSLATE_READY http://{args.host}:{actual_port}", flush=True)

    # Optional preload, but NEVER block READY on it.
    # Default is 0 to keep startup fast; users can set VSCODE_TRANSLATE_PRELOAD=1.
    preload = os.environ.get("VSCODE_TRANSLATE_PRELOAD", "0")
    if preload != "0":
        def _preload():
            try:
                _get_translator("en-zh")
                _get_translator("zh-en")
            except Exception as e:
                # best-effort preload
                print(f"PRELOAD_ERROR {e}", flush=True)

        threading.Thread(target=_preload, daemon=True).start()

    threading.Thread(target=_idle_reaper, args=(args.idle_timeout_ms,), daemon=True).start()

    _server.serve_forever()


if __name__ == "__main__":
    main()
