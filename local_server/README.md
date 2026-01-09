# Local Translate Server (MVP)

This is a tiny local HTTP server used by the VS Code extension to perform offline EN<->ZH translation.

## Requirements

- Python 3.9+
- Dependencies:

```bash
pip install -r local_server/requirements.txt
# transformers also needs torch; install the right one for your platform:
pip install torch
```

## Run

```bash
python3 -u local_server/app.py --host 127.0.0.1 --port 0
```

When ready, it prints:

```
LOCAL_TRANSLATE_READY http://127.0.0.1:<port>
```

## API

- `GET /health`
- `POST /translate` body:

```json
{ "texts": ["hello"], "sourceLang": "en", "targetLang": "zh" }
```

- `POST /shutdown`

## Offline Mode (No Network)

The server supports a strict offline mode controlled by env vars:

- `VSCODE_TRANSLATE_OFFLINE=1` to enforce `local_files_only`.
- Provide model locations:
	- `VSCODE_TRANSLATE_MODEL_ROOT=/abs/path/to/root` with subfolders `en-zh/` and `zh-en/`, OR
	- `VSCODE_TRANSLATE_MODEL_EN_ZH=/abs/path/to/en-zh-model`
	- `VSCODE_TRANSLATE_MODEL_ZH_EN=/abs/path/to/zh-en-model`
