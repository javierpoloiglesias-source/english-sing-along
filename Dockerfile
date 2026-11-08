FROM python:3.11-slim
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH \
    ESA_PUBLIC=1 ESA_REMOTE_TRANSLATE=1 ESA_DATA_DIR=/home/user/datos PYTHONUNBUFFERED=1
WORKDIR /home/user/app
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=user backend ./backend
COPY --chown=user frontend ./frontend
RUN python -c "import cmudict; cmudict.dict()" || true
EXPOSE 7860
CMD sh -c "python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-7860}"
