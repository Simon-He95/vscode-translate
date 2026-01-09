<p align="center">
<img height="200" src="./assets/kv.png" alt="vscode-translate">
</p>
<p align="center"> English | <a href="./README_zh.md">简体中文</a></p>

Vscode Extension  ——  Chinese and English sliding word translation

## Local (Offline) Translation

This extension can optionally call a local HTTP translate server.

1) (Recommended) Create venv and install deps:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r local_server/requirements.txt
pip install torch
```

2) Enable settings:

- `translate.useLocal`: true
- `translate.local.autoStart`: true

The default start command is `python3 -u local_server/app.py --host 127.0.0.1 --port 0`.

If you use venv, set:

- `translate.local.command`: `./.venv/bin/python -u local_server/app.py --host 127.0.0.1 --port 0`

### Fully Offline (No Network)

If you want **zero network access** (no model downloads), you must provide model files locally.

- Set `translate.local.offline`: true
- Provide one of:
	- `translate.local.model.root`: a folder that contains `en-zh/` and `zh-en/` model directories
	- OR `translate.local.model.enZh` and `translate.local.model.zhEn`: explicit local paths

Notes:
- In offline mode, the server uses `local_files_only=true` and will fail fast if files are missing.

## :coffee:

[buy me a cup of coffee](https://github.com/Simon-He95/sponsor)

## License

[MIT](./license)
