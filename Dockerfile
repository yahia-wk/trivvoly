# Trivvoly for a hosting provider. Put it behind HTTPS (the provider's proxy), set PUBLIC_URL,
# and mount a volume at /data so running games survive restarts.

# 1. Build the screens
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci --no-audit --no-fund
COPY shared/ /src/shared/
COPY frontend/ ./
RUN npm run build

# 2. Run the game server
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TRUST_PROXY=1 \
    DATABASE_URL=sqlite:////data/trivvoly.db
COPY backend/ backend/
# Editable install: the server finds quizzes/, shared/ and frontend/dist/ next to backend/
RUN pip install --no-cache-dir -e ./backend
COPY quizzes/ quizzes/
COPY shared/ shared/
COPY --from=frontend /src/frontend/dist frontend/dist
RUN useradd --create-home trivvoly && mkdir -p /data && chown trivvoly /data
USER trivvoly
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:3000/healthz')"
CMD ["python", "-m", "trivvoly"]
