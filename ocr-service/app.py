import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile

app = FastAPI(title='Local contract OCR', docs_url=None, redoc_url=None)
ocr_instance = None
ALLOWED_SUFFIXES = {'.pdf', '.png', '.jpg', '.jpeg', '.webp'}
MAX_BYTES = 12 * 1024 * 1024


def get_ocr():
    global ocr_instance
    if ocr_instance is None:
        from paddleocr import PaddleOCR
        ocr_instance = PaddleOCR(
            lang='ch',
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
    return ocr_instance


def normalize_results(results):
    grouped = {}
    for item in results:
        data = item.res if hasattr(item, 'res') else item
        page_number = int(data.get('page_index') or 0) + 1
        texts = [str(text).strip() for text in data.get('rec_texts', []) if str(text).strip()]
        scores = [float(score) for score in data.get('rec_scores', [])]
        page = grouped.setdefault(page_number, {'texts': [], 'scores': []})
        page['texts'].extend(texts)
        page['scores'].extend(scores)
    return [
        {
            'pageNumber': page_number,
            'text': '\n'.join(page['texts']),
            'confidence': round(sum(page['scores']) / len(page['scores']), 4) if page['scores'] else None,
        }
        for page_number, page in sorted(grouped.items())
    ]


@app.get('/health')
def health():
    return {'ok': True}


@app.post('/ocr')
async def recognize(file: UploadFile = File(...)):
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
        pages = normalize_results(get_ocr().predict(str(temporary_path)))
        if not pages:
            raise HTTPException(status_code=422, detail='No text recognized')
        return {'pages': pages}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail='OCR processing failed') from error
    finally:
        if temporary_path:
            temporary_path.unlink(missing_ok=True)
