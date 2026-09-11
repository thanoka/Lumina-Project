import requests
import wave
import struct

# Create a dummy valid wav file
def create_dummy_wav(filename):
    with wave.open(filename, 'w') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(44100)
        # write 1 sec of silence
        for _ in range(44100):
            wav_file.writeframes(struct.pack('h', 0))

create_dummy_wav('dummy.wav')

print("Sending dummy audio to STT server...")
with open('dummy.wav', 'rb') as f:
    try:
        response = requests.post('http://localhost:5000/transcribe', files={'file': ('dummy.wav', f, 'audio/wav')})
        print("-----------------------------------------")
        print("STATUS CODE:", response.status_code)
        print("RESPONSE:", response.json())
        print("-----------------------------------------")
    except Exception as e:
        print("CONNECTION ERROR:", e)
