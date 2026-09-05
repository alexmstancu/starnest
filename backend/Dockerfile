# The backend container.
#
# Two stages: dependencies resolve once and cache, application code changes constantly and
# copies last. Editing a source file must not re-resolve the dependency tree.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS dependencies

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Only the manifest, so this layer is invalidated by a dependency change and nothing else.
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev


FROM python:3.12-slim-bookworm AS runtime

# postgresql-client is here for pg_dump: arch.md 9.5 requires a backup before every
# migration, and manually entered values -- visa verdicts, quota research, exclusion
# reasons -- cannot be re-fetched at any price. It is the one thing worth the image size.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client \
 && rm -rf /var/lib/apt/lists/*

# Never run as root. Nothing in this application needs it.
RUN useradd --create-home --uid 1000 app
WORKDIR /app

COPY --from=dependencies --chown=app:app /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# The layout mirrors the repository deliberately, so one path expression finds the SQL in
# development and in the container alike: from backend/src/starnest/main.py, three parents up
# is the root, and storage/ sits beside backend/.
COPY --chown=app:app backend/src/ ./backend/src/
COPY --chown=app:app storage/ ./storage/

USER app
EXPOSE 8000

# Binds to every interface INSIDE the container, which is not a loosening of reqs.md 10:
# the container's network namespace is private, and compose publishes the port to
# 127.0.0.1 only. That published binding is the actual security boundary.
#
# No migration runs here. arch.md 7.4 is explicit -- a process that migrates when it boots
# will one day migrate when you did not intend it to. Migrations are the `migrate` service
# in compose.yaml, invoked deliberately. The application refuses to start against a schema
# it does not recognise, which is what makes the omission safe rather than merely tidy.
# `--factory`, because the composition root builds the app when called rather than at import.
# A module-level instance would open a connection pool the moment anything imported the module.
CMD ["uvicorn", "--factory", "starnest.main:create_app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--app-dir", "/app/backend/src"]
