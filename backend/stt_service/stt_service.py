import os
import uuid
import subprocess
from flask import jsonify, request
import speech_recognition as sr

FFMPEG_BIN = "ffmpeg"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMP_AUDIO_DIR = os.path.join(BASE_DIR, "temp_audio")
os.makedirs(TEMP_AUDIO_DIR, exist_ok=True)


def convert_to_wav(input_path: str, wav_path: str) -> bool:
    """Use ffmpeg directly via subprocess to convert any audio to WAV 16kHz mono 16-bit."""
    cmd = [
        FFMPEG_BIN, "-y",        # overwrite output
        "-i", input_path,        # input file
        "-ar", "16000",          # sample rate
        "-ac", "1",              # mono
        "-sample_fmt", "s16",    # 16-bit signed
        "-f", "wav",             # output format
        wav_path
    ]
    print(f"[STT] Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        print(f"[STT] ffmpeg STDERR: {result.stderr}")
        return False
    print(f"[STT] ffmpeg conversion OK -> {wav_path} ({os.path.getsize(wav_path)} bytes)")
    return True


def transcribe_audio(audio_file) -> tuple[str, str | None]:
    """แปลงไฟล์เสียง (FileStorage) เป็นข้อความ
    คืน (text, None) เมื่อสำเร็จ หรือ ("", error_message) เมื่อล้มเหลว
    """
    uid = uuid.uuid4().hex
    original_ext = os.path.splitext(audio_file.filename or "voice.wav")[1] or ".wav"
    input_path = os.path.join(TEMP_AUDIO_DIR, f"{uid}_input{original_ext}")
    wav_path = os.path.join(TEMP_AUDIO_DIR, f"{uid}_converted.wav")

    try:
        audio_file.save(input_path)
        file_size = os.path.getsize(input_path)
        print(f"[STT] saved: {input_path} ({file_size} bytes, ext={original_ext})")

        if file_size < 100:
            return "", "ไฟล์เสียงสั้นเกินไป กรุณาลองใหม่"

        # Always convert with ffmpeg subprocess (bypasses pydub issues)
        if original_ext.lower() == ".wav":
            print("[STT] File is already .wav, skipping ffmpeg conversion")
            wav_path = input_path
        else:
            if not convert_to_wav(input_path, wav_path):
                return "", "ไม่สามารถแปลงไฟล์เสียงได้ (ffmpeg error)"

            # Verify the converted file exists and has content
            if not os.path.exists(wav_path) or os.path.getsize(wav_path) < 100:
                return "", "ไฟล์เสียงที่แปลงแล้วมีปัญหา"

        r = sr.Recognizer()
        with sr.AudioFile(wav_path) as source:
            audio_data = r.record(source)

        text = r.recognize_google(audio_data, language="th-TH")
        print(f"[STT] result: {text}")
        return text, None

    except sr.UnknownValueError:
        return "", "ฟังไม่ออก ลองพูดใหม่อีกครั้ง"
    except sr.RequestError as e:
        return "", f"Google STT error: {e}"
    except Exception as e:
        print(f"[STT] error: {e}")
        import traceback; traceback.print_exc()
        return "", str(e)
    finally:
        for p in [input_path, wav_path]:
            try:
                if p and os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass


def transcribe_api():
    """POST /transcribe  — รับ FormData file → คืน JSON {"status", "text"}"""
    if 'file' not in request.files:
        return jsonify({"status": "error", "text": "ไม่พบไฟล์เสียง"}), 400

    text, error = transcribe_audio(request.files['file'])
    if error:
        return jsonify({"status": "error", "text": error}), 422
    return jsonify({"status": "success", "text": text})