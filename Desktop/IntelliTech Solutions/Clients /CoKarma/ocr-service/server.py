import os
from flask import Flask, request, jsonify
from paddleocr import PaddleOCR

app = Flask(__name__)

# Loaded once, at process startup — not per-request. Model loading takes
# several seconds; doing it here means /health only starts responding
# once the model is actually usable (Flask can't accept connections
# until this line finishes), so the health-check polling on the Node
# side just needs to detect "the server responded at all" as proof of
# readiness, with no separate loading/ready state to track.
ocr = PaddleOCR(use_textline_orientation=False, lang='en')


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ready'})


@app.route('/ocr', methods=['POST'])
def ocr_endpoint():
    data = request.get_json(silent=True) or {}
    image_path = data.get('imagePath')
    if not image_path:
        return jsonify({'error': 'imagePath is required'}), 400
    if not os.path.isfile(image_path):
        return jsonify({'error': f'file not found: {image_path}'}), 500
    try:
        result = ocr.predict(image_path)
        lines = []
        for res in result:
            lines.extend(res.get('rec_texts', []))
        return jsonify({'text': '\n'.join(lines)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('OCR_SERVICE_PORT', 5001))
    app.run(host='127.0.0.1', port=port)
