import os, sys, subprocess, tempfile, base64, json, re
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS

# ── License check — must pass before server starts ───────────────────────────
try:
    from license_check import check_and_exit_if_invalid
    _lic = check_and_exit_if_invalid(Path(__file__).parent)
    print(f"[LICENSE] Valid — {_lic['client_name']} — expires {_lic['expiry']} ({_lic['days_left']} days left)")
except ImportError:
    pass  # license_check.py not present (dev mode)
# ─────────────────────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app, origins="*", methods=["GET","POST","OPTIONS"], allow_headers=["Content-Type"])

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'capital_gains_extractor.py')

@app.route('/', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'message': 'Capital Gains Server v5'})

@app.route('/process', methods=['GET','POST','OPTIONS'])
def process():
    if request.method in ('OPTIONS','GET'):
        return jsonify({'status': 'ok'}), 200

    files = request.files.getlist('files')
    if not files:
        return jsonify({'success': False, 'error': 'No files received'}), 400

    # Get optional date range
    fy_start = request.form.get('fy_start', '')
    fy_end = request.form.get('fy_end', '')

    # Save each file using original filename in a unique temp dir
    # so source_name_from_file() returns the original file name (not a cg_ prefixed one)
    import tempfile as _tempfile
    tmp_dir = _tempfile.mkdtemp()
    saved = []
    for f in files:
        safe_name = re.sub(r'[^\w.\- ]', '_', f.filename).strip() or 'upload.pdf'
        tmp_path = os.path.join(tmp_dir, safe_name)
        f.save(tmp_path)
        saved.append(tmp_path)

    out          = tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx').name
    computax_out = tempfile.NamedTemporaryFile(delete=False, suffix='.xls').name

    cmd = [sys.executable, SCRIPT] + saved + ['-o', out, '--computax-output', computax_out]
    if fy_start: cmd += ['--fy-start', fy_start]
    if fy_end:   cmd += ['--fy-end',   fy_end]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        m = re.search(r'\{[\s\S]*\}', result.stdout)
        if not m:
            err_text = (result.stdout + result.stderr)[-500:]
            return jsonify({'success': False, 'error': 'Script error: ' + err_text}), 500

        data = json.loads(m.group(0))
        
        # Capture any ERROR lines from stderr for the portal to show
        errors = [l.replace('[ERROR] ','').strip() 
                  for l in result.stderr.split('\n') 
                  if l.strip().startswith('[ERROR]')]
        if errors:
            data['errors'] = errors
        file_b64     = None
        computax_b64 = None
        try:
            with open(out, 'rb') as xf:
                file_b64 = base64.b64encode(xf.read()).decode()
        except: pass
        try:
            with open(computax_out, 'rb') as xf:
                computax_b64 = base64.b64encode(xf.read()).decode()
        except: pass

        return jsonify({'success': True, **data,
                        'file_base64': file_b64,
                        'computax_base64': computax_b64})
    except subprocess.TimeoutExpired:
        return jsonify({'success': False, 'error': 'Processing timed out'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        try:
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except: pass
        try: os.unlink(out)
        except: pass
        try: os.unlink(computax_out)
        except: pass

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
