FROM ubuntu:24.04@sha256:224a1869083a311ef3f13648a154ba79832fbef6364d31493642ca03082da254
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends clang-18 lldb-18 python3 python3-lldb-18 libstdc++-13-dev && rm -rf /var/lib/apt/lists/*
RUN ln -s liblldb.so.1 /usr/lib/llvm-18/lib/liblldb.so
COPY runner/cpp/tracer.py runner/cpp/launch.py /runner/cpp/
COPY runner/python/values.py /runner/python/values.py
RUN dpkg-query -W clang-18 lldb-18 python3 python3-lldb-18 libstdc++-13-dev > /runner/runtime-packages.txt
USER 65532:65532
WORKDIR /work
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ENTRYPOINT ["timeout", "--signal=KILL", "90s", "python3", "-I", "/runner/cpp/launch.py"]
