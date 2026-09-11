import io
import os
import uvicorn
import time
from google.cloud import vision
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageDraw
from ultralytics import YOLO
from dotenv import load_dotenv

load_dotenv('.env.local')
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.getenv("GOOGLE_VISION", "google_key.json")

SCAN_DIR = "scanned"
os.makedirs(SCAN_DIR, exist_ok=True)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ocr_client = vision.ImageAnnotatorClient()
model = YOLO('yolo26m.pt') 
text_model = YOLO('text_detector.pt')

# 🎯 NEW: Mapping to match your "location_in_frame" data format
def get_grid_location(x_pct, y_pct):
    if 0.30 <= x_pct <= 0.70 and 0.30 <= y_pct <= 0.70: return "center"
    
    # Top Row
    if y_pct < 0.30:
        if x_pct < 0.30: return "top_left"
        if x_pct > 0.70: return "top_right"
        return "top_center"
    
    # Bottom Row
    if y_pct > 0.70:
        if x_pct < 0.30: return "bottom_left"
        if x_pct > 0.70: return "bottom_right"
        return "bottom_center"
        
    # Middle Sides
    if x_pct < 0.30: return "center_left"
    if x_pct > 0.70: return "center_right"
    
    return "unknown"

@app.post("/process-frame")
async def process_frame(file: UploadFile = File(...)):
    contents = await file.read()
    img_pil = Image.open(io.BytesIO(contents)).convert("RGB")
    W, H = img_pil.width, img_pil.height
    
    safety_results = model(img_pil, conf=0.4)
    text_results = text_model(img_pil, conf=0.5)

    detections = []
    
    # 🛡️ SAFETY DETECTIONS (Infrastructure)
    for r in safety_results:
        for box in r.boxes:
            label = model.names[int(box.cls[0])]
            x_c, y_c, w_b, h_b = box.xywh[0].tolist()
            size_pct = (w_b * h_b) / (W * H)
            grid = get_grid_location(x_c / W, y_c / H)
            
            detections.append({
                "label": label,
                "grid_location": grid,
                "size_pct": round(size_pct, 4), # For Arrival/Warning threshold checks
                "type": "safety"
            })

    # 🗺️ TEXT/SIGN DETECTIONS (Navigation)
    final_ocr_text = ""
    for r in text_results:
        for box in r.boxes:
            conf = float(box.conf[0])
            if conf > 0.75:
                x_c, y_c, w_b, h_b = box.xywh[0].tolist()
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                size_pct = (w_b * h_b) / (W * H)
                grid = get_grid_location(x_c / W, y_c / H)
                
                detected_content = ""
                # Only perform expensive OCR if it's potentially a landmark
                try:
                    crop_img = img_pil.crop((max(0, x1-5), max(0, y1-5), min(W, x2+5), min(H, y2+5)))
                    crop_buffer = io.BytesIO()
                    crop_img.save(crop_buffer, format="JPEG")
                    image = vision.Image(content=crop_buffer.getvalue())
                    response = ocr_client.text_detection(image=image)
                    if response.text_annotations:
                        detected_content = response.text_annotations[0].description.replace("\n", " ").strip().upper()
                        if grid == "center":
                            final_ocr_text = detected_content
                except Exception as e:
                    print(f"OCR Error: {e}")

                detections.append({
                    "label": "SIGN",
                    "grid_location": grid,
                    "size_pct": round(size_pct, 4),
                    "text_content": detected_content,
                    "type": "text"
                })

    return {
        "status": "success",
        "detections": detections,
        "can_read_sign": len(final_ocr_text) > 0,
        "sign_text": final_ocr_text 
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=7000, reload=False)