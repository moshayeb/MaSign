// The version shown in the footer (MAS-125). It mirrors `frontend/package.json`
// and the FastAPI `version` in `app/main.py`; a test fails if this and
// package.json drift apart, so bumping one bumps the other.
export const APP_VERSION = '0.1.0'
