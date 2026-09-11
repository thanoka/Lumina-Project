import requests
import os

# 1. Setup paths
script_dir = os.path.dirname(__file__)
image_path = os.path.join(script_dir, "big-city-higher-pay-key.jpg") 

headers = {
    "Bypass-Tunnel-Reminder": "true"
}


url =  "https://expansion-concrete-herb-herald.trycloudflare.com/process-frame"




if not os.path.exists(image_path):
    print(f"ERROR: Place your image at {image_path}")
else:
    with open(image_path, "rb") as f:
        files = {"file": (image_path, f, "image/jpeg")}
        response = requests.post(url, files=files)

    if response.status_code == 200:
        print("\n✅ Success! AI Brain responded:")
        detections = response.json()["detections"]
        
        if not detections:
            print("Nothing found in this frame.")
        
        for d in detections:
            label = d['label'].upper()
            loc = d['grid_location']
            size = d['size_label']
            conf = d['confidence']
            
            print(f"--- {label} ---")
            print(f"📍 Location: {loc}")
            print(f"📏 Size:     {size} ({d['size_threshold'] * 100:.1f}%)")
            print(f"🤖 Confidence: {conf}")
            print("-" * 20)
    else:
        print(f"❌ Error: {response.status_code}")
        print(response.text)