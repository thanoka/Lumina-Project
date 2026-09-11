import sys
import os
from flask import Flask, jsonify
from flask_cors import CORS
from stt_service import transcribe_api

sys.stdout.reconfigure(encoding='utf-8')

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(BASE_DIR, "temp_audio"), exist_ok=True)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({"ok": True, "services": ["stt"]})


@app.route('/transcribe', methods=['POST'])
def transcribe():
    """รับ audio file → คืน JSON {"status", "text"}"""
    return transcribe_api()


if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=False)