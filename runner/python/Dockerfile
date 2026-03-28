FROM python:3.14.7-slim-bookworm@sha256:9ab8d9c8514b44f90cf0029dd42fdd7e9e211e639c8b995304cc04568dee900f
COPY runner/python/tracer.py runner/python/values.py /runner/python/
USER 65532:65532
WORKDIR /tmp
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ENTRYPOINT ["timeout", "--signal=KILL", "65s", "python", "-I", "-S", "/runner/python/tracer.py"]
