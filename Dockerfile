# SAT-SA in a container (Linux). The image is built once with internet access; the running
# container makes no outbound connections. The synthetic demo panel and its analysis are built
# into the image, so the app is ready as soon as the container starts.
#
#   docker build -t satsa .
#   docker run --rm -p 8000:8000 satsa        # then open http://localhost:8000
#
# The optional local LLM is not included: explanations use the verified template path.
FROM python:3.13-slim

ENV PYTHONIOENCODING=utf-8 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY satsa satsa
COPY data/samples data/samples
COPY reports/validation.json reports/guide.json reports/
RUN python -m satsa.pipeline

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "satsa.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
