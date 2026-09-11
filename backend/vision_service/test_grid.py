"""
Grid Reference Test — draws left | center | right zones on the test image
and overlays YOLO detection boxes with their grid labels.

Usage:
    python test_grid.py

Output:
    grid_reference.jpg  — annotated image saved in the same directory
"""
import os
import io
from PIL import Image, ImageDraw, ImageFont
from ultralytics import YOLO

# ── Paths ──
SCRIPT_DIR = os.path.dirname(__file__)
IMAGE_PATH = os.path.join(SCRIPT_DIR, "big-city-higher-pay-key.jpg")
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "grid_reference.jpg")

# ── Models ──
model = YOLO(os.path.join(SCRIPT_DIR, "yolo26m.pt"))
text_model = YOLO(os.path.join(SCRIPT_DIR, "text_detector.pt"))


# ── Grid logic (same as main.py) ──
def get_grid_location(x_pct, y_pct):
    """3-column simplified grid for navigation alignment."""
    if x_pct < 0.30:
        return "left"
    elif x_pct > 0.70:
        return "right"
    else:
        return "center"


def get_zone_color(zone):
    """Color per zone for the overlay."""
    colors = {
        "left":   (255, 100, 100),   # Red-ish
        "center": (100, 255, 100),   # Green-ish
        "right":  (100, 150, 255),   # Blue-ish
    }
    return colors.get(zone, (200, 200, 200))


def main():
    if not os.path.exists(IMAGE_PATH):
        print(f"❌ Image not found: {IMAGE_PATH}")
        return

    # ── Load image ──
    img = Image.open(IMAGE_PATH).convert("RGB")
    W, H = img.size
    draw = ImageDraw.Draw(img, "RGBA")

    # ── Draw grid zone overlays (semi-transparent) ──
    # Left zone: 0 → 30%
    draw.rectangle([0, 0, int(W * 0.30), H],
                   fill=(255, 80, 80, 40))
    # Right zone: 70% → 100%
    draw.rectangle([int(W * 0.70), 0, W, H],
                   fill=(80, 120, 255, 40))
    # Center zone: 30% → 70% (subtle green)
    draw.rectangle([int(W * 0.30), 0, int(W * 0.70), H],
                   fill=(80, 255, 80, 25))

    # ── Draw vertical divider lines ──
    line_x_left  = int(W * 0.30)
    line_x_right = int(W * 0.70)

    for x in [line_x_left, line_x_right]:
        draw.line([(x, 0), (x, H)], fill=(255, 255, 0), width=3)

    # ── Zone labels at top ──
    try:
        font_big = ImageFont.truetype("arial.ttf", 32)
        font_sm  = ImageFont.truetype("arial.ttf", 16)
    except OSError:
        font_big = ImageFont.load_default()
        font_sm  = font_big

    # Left label
    draw.text((int(W * 0.15) - 30, 10), "LEFT", fill=(255, 100, 100), font=font_big)
    draw.text((int(W * 0.15) - 30, 46), "0% – 30%", fill=(255, 200, 200), font=font_sm)

    # Center label
    draw.text((int(W * 0.50) - 50, 10), "CENTER", fill=(100, 255, 100), font=font_big)
    draw.text((int(W * 0.50) - 40, 46), "30% – 70%", fill=(200, 255, 200), font=font_sm)

    # Right label
    draw.text((int(W * 0.85) - 40, 10), "RIGHT", fill=(100, 150, 255), font=font_big)
    draw.text((int(W * 0.85) - 40, 46), "70% – 100%", fill=(200, 200, 255), font=font_sm)

    # ── Run YOLO detections ──
    safety_results = model(img, conf=0.4)
    text_results   = text_model(img, conf=0.5)

    all_detections = []

    # Safety detections
    for r in safety_results:
        for box in r.boxes:
            label = model.names[int(box.cls[0])]
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            x_c, y_c, w_b, h_b = box.xywh[0].tolist()
            size_pct = (w_b * h_b) / (W * H)
            zone = get_grid_location(x_c / W, y_c / H)

            all_detections.append({
                "label": label, "zone": zone, "size_pct": size_pct,
                "box": (x1, y1, x2, y2), "type": "safety"
            })

    # Text detections
    for r in text_results:
        for box in r.boxes:
            conf = float(box.conf[0])
            if conf > 0.5:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                x_c, y_c, w_b, h_b = box.xywh[0].tolist()
                size_pct = (w_b * h_b) / (W * H)
                zone = get_grid_location(x_c / W, y_c / H)

                all_detections.append({
                    "label": "SIGN", "zone": zone, "size_pct": size_pct,
                    "box": (x1, y1, x2, y2), "type": "text"
                })

    # ── Draw detection boxes ──
    for det in all_detections:
        x1, y1, x2, y2 = det["box"]
        color = get_zone_color(det["zone"])
        outline_color = color

        # Draw box
        draw.rectangle([x1, y1, x2, y2], outline=outline_color, width=2)

        # Label background
        tag = f"{det['label']} [{det['zone']}] {det['size_pct']*100:.1f}%"
        bbox = draw.textbbox((x1, y1 - 18), tag, font=font_sm)
        draw.rectangle([bbox[0]-2, bbox[1]-2, bbox[2]+2, bbox[3]+2],
                       fill=(0, 0, 0, 180))
        draw.text((x1, y1 - 18), tag, fill=color, font=font_sm)

    # ── Save ──
    img.save(OUTPUT_PATH, quality=92)
    print(f"\n✅ Grid reference image saved: {OUTPUT_PATH}")
    print(f"   Image size: {W} × {H}")
    print(f"   Left boundary:  x = {line_x_left}px  (30%)")
    print(f"   Right boundary: x = {line_x_right}px (70%)")
    print(f"   Total detections: {len(all_detections)}")

    # ── Print detections ──
    print(f"\n{'─' * 50}")
    for det in all_detections:
        icon = "🪧" if det["type"] == "text" else "🛡️"
        print(f"  {icon} {det['label']:15s}  zone={det['zone']:8s}  size={det['size_pct']*100:.2f}%")
    print(f"{'─' * 50}")


if __name__ == "__main__":
    main()
