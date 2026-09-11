import requests
import io
from PIL import Image

print("Creating dummy image...")
img = Image.new('RGB', (10, 10), color='red')
img_byte_arr = io.BytesIO()
img.save(img_byte_arr, format='JPEG')
img_byte_arr.seek(0)

print("Sending dummy image to Vision server...")
try:
    response = requests.post('http://localhost:7000/process-frame', files={'file': ('dummy.jpg', img_byte_arr, 'image/jpeg')})
    print("-----------------------------------------")
    print("STATUS CODE:", response.status_code)
    print("RESPONSE:", response.json())
    print("-----------------------------------------")
except Exception as e:
    print("CONNECTION ERROR:", e)
