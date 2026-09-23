"""Kelvoy <-> DGX Spark bridge service.

Placeholder only: the actual GPU/model integration protocol against DGX
Spark is not yet decided (see README.md in this directory). For now this
just proves the service boots and can be health-checked, mirroring
visionary's comfyui-bridge shape (independent Flask service, own
pyproject.toml/uv.lock, run via waitress in production).
"""

from flask import Flask, jsonify

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(port=8188, debug=True)
