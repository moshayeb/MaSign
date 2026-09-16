# MaSign frontend

React + Vite, served as static files by the FastAPI app. Conventions (toasts,
error handling) are in `../docs/frontend.md`.

```bash
npm ci          # once
npm run dev     # http://localhost:5173, /api proxied to the API on :8000
npm test        # vitest
npm run build   # dist/, picked up by the Docker image / FastAPI
```
