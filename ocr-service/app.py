"""Local OCR service for scanned PDFs and images.

POST /ocr  (multipart field: file) -> {"pages": [{"pageNumber", "text", "confidence"}]}

Engine selection: RapidOCR (onnxruntime, bundled Chinese models) is preferred because it
installs from a single wheel; PaddleOCR is used when RapidOCR is unavailable. Both are
optional so the service can start and report a clear error instead of crashing.
"""

import argparse
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image

app = FastAPI(title='Local contract OCR', docs_url=None, redoc_url=None)
ALLOWED_SUFFIXES = {'.pdf', '.png', '.jpg', '.jpeg', '.webp'}
MAX_BYTES = 12 * 1024 * 1024
MAX_PDF_PAGES = 30
_engine = None


def build_engine():
    global _engine
    if _engine is not None:
        return _engine
    try:
        from rapidocr_onnxruntime import RapidOCR
        _engine = ('rapidocr', RapidOCR())
        return _engine
    except ImportError:
        pass
    try:
        from paddleocr import PaddleOCR
        _engine = ('paddleocr', PaddleOCR(
            lang='ch',
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        ))
        return _engine
    except ImportError as error:
        raise RuntimeError('未安装 OCR 引擎，请先执行 pip install -r requirements.txt') from error


def recognize(image_path: Path):
    """Return (lines, scores) for one image."""
    kind, engine = build_engine()
    if kind == 'rapidocr':
        result, _ = engine(str(image_path))
        lines = [str(item[1]).strip() for item in (result or []) if str(item[1]).strip()]
        scores = [float(item[2]) for item in (result or [])]
        return lines, scores
    results = engine.predict(str(image_path))
    lines, scores = [], []
    for item in results:
        data = item.res if hasattr(item, 'res') else item
        lines.extend(str(text).strip() for text in data.get('rec_texts', []) if str(text).strip())
        scores.extend(float(score) for score in data.get('rec_scores', []))
    return lines, scores


def page_payload(page_number: int, lines, scores):
    return {
        'pageNumber': page_number,
        'text': '\n'.join(lines),
        'confidence': round(sum(scores) / len(scores), 4) if scores else None,
    }


def recognize_file(path: Path, suffix: str):
    if suffix != '.pdf':
        lines, scores = recognize(path)
        return [page_payload(1, lines, scores)]

    import pypdfium2 as pdfium
    document = pdfium.PdfDocument(str(path))
    try:
        if len(document) > MAX_PDF_PAGES:
            raise HTTPException(status_code=413, detail=f'PDF 超过 {MAX_PDF_PAGES} 页，请拆分后再上传')
        pages = []
        for index in range(len(document)):
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as temporary:
                image_path = Path(temporary.name)
            try:
                document[index].render(scale=2).to_pil().convert('RGB').save(image_path)
                lines, scores = recognize(image_path)
            finally:
                image_path.unlink(missing_ok=True)
            pages.append(page_payload(index + 1, lines, scores))
        return pages
    finally:
        document.close()


@app.get('/health')
def health():
    kind = None
    try:
        kind = build_engine()[0]
    except RuntimeError:
        pass
    return {'ok': True, 'engine': kind}


@app.post('/ocr')
async def recognize_upload(file: UploadFile = File(...)):
    suffix = Path(file.filename or '').suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail='Unsupported file type')
    content = await file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail='File too large')

    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temporary:
            temporary.write(content)
            temporary_path = Path(temporary.name)
        pages = recognize_file(temporary_path, suffix)
        if not any(page['text'].strip() for page in pages):
            raise HTTPException(status_code=422, detail='No text recognized')
        return {'pages': pages}
    except HTTPException:
        raise
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail='OCR processing failed') from error
    finally:
        if temporary_path:
            temporary_path.unlink(missing_ok=True)


if __name__ == '__main__':
    import uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=4100)
    arguments = parser.parse_args()
    uvicorn.run(app, host=arguments.host, port=arguments.port)
