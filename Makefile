# Every command the project has. `make` on its own lists them.
#
# Two projects live here and they share nothing (arch.md 6.1):
#
#   backend/     Python, uv, pytest        -- the REST API and all domain logic
#   ui/   TypeScript, npm, vitest   -- a client of the contract, over HTTP only
#
# Recipes are prefixed accordingly. `make check` runs everything both sides can prove.

.DEFAULT_GOAL := help
.PHONY: help up down logs serve acquire rank migrate rollback backup \
        test test-storage test-acceptance live coverage coverage-open lint format boundaries audit openapi check \
        ui-install ui-lint ui-typecheck ui-test ui-coverage ui-coverage-open ui-check ui-client \
        e2e e2e-report \
        docker-build docker-up docker-migrate docker-down env \
        schema-diagram schema-diagram-open

BACKEND := backend
UI      := ui
# The SQL is a system asset, not a Python implementation detail (reqs.md Q200).
STORAGE := storage

# .env is the single source of technical configuration (arch.md 7.5). `-include` so that
# `make env` still works before it exists.
-include .env

# yoyo names its driver in the URL scheme and psycopg3 does not: a plain postgresql://
# resolves to yoyo's psycopg2 backend, which is not installed and never will be. The
# application keeps the standard form, so the translation happens here rather than in a
# second variable that could drift out of step.
MIGRATION_URL := $(subst postgresql://,postgresql+psycopg://,$(DATABASE_URL))
# Pinned rather than @latest: a diagram that changes because a tool released overnight
# is a diff nobody asked for, and this is documentation about a schema that did not move.
LIAM    := @liam-hq/cli@0.7.24
SCHEMA_DOCS := docs/schema

COV     := --cov=starnest --cov-branch \
           --cov-report=term-missing --cov-report=html --cov-report=xml --cov-report=json

help:  ## Show this list
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# --- Local development ---------------------------------------------------------

env:  ## Create .env from the example, if it does not exist yet
	@test -f .env && echo ".env already exists — leaving it alone" \
	  || (cp .env.example .env && echo "created .env — fill in the password and the API key")

up:  ## Start PostgreSQL only. The backend and UI run from the command line
	docker compose up -d database

serve:  ## Run the API from the command line, against the database in Docker
	cd $(BACKEND) && uv run python -c "from starnest.main import run; run()"

acquire:  ## Fetch real figures from every source, then the stand-ins. One run, explicit like migrate
	cd $(BACKEND) && uv run python scripts/acquire.py

rank:  ## Print the ranking from what is stored. SET=local_employment for another criteria set
	cd $(BACKEND) && uv run python scripts/rank.py $(SET)

down:  ## Stop everything, keeping the data volume
	docker compose down

logs:  ## Follow the database statement log (arch.md 10.7 — this IS the audit)
	docker compose logs -f database

# --- Schema --------------------------------------------------------------------
# Migrations run by an explicit command, never at startup (arch.md 7.4). Back up first:
# manually entered values cannot be re-fetched at any price (arch.md 9.5).

migrate: backup  ## Back up, then apply pending migrations
	cd $(BACKEND) && uv run yoyo apply --batch --database "$(MIGRATION_URL)" ../$(STORAGE)/migrations

rollback:  ## Roll back the most recent migration
	cd $(BACKEND) && uv run yoyo rollback --batch --database "$(MIGRATION_URL)" ../$(STORAGE)/migrations

backup:  ## pg_dump to ./backups
	@mkdir -p backups
	docker compose --profile tools run --rm backup

# --- Backend tests -------------------------------------------------------------

test:  ## Fast unit tests, no coverage
	cd $(BACKEND) && uv run pytest -m "not storage and not acceptance and not live"

test-storage:  ## Tests against a real PostgreSQL — the constraints ARE the behaviour
	cd $(BACKEND) && uv run pytest -m storage

test-acceptance:  ## The HTTP contract, end to end against a live backend
	cd $(BACKEND) && uv run pytest -m acceptance

live:  ## Real third-party sources, on purpose: the fixtures still match, and Gate B's coverage holds
	cd $(BACKEND) && uv run pytest -m live

# `live` is excluded: those tests call real third-party sources, and a gate that fails because
# Eurostat was slow says nothing about this code (arch.md 6.7). Until 2026-09-11 it ran them.
coverage:  ## Full suite with coverage, live sources excluded. Fails below 85% lines and branches
	cd $(BACKEND) && uv run pytest -m "not live" $(COV)
	@echo ""
	@echo "  HTML report: backend/htmlcov/index.html   (make coverage-open)"

coverage-open: coverage  ## Run coverage, then open the report in a browser
	open $(BACKEND)/htmlcov/index.html

# --- Backend quality -----------------------------------------------------------

lint:  ## ruff
	cd $(BACKEND) && uv run ruff check . && uv run ruff format --check .

format:  ## ruff, applying fixes
	cd $(BACKEND) && uv run ruff check --fix . && uv run ruff format .

boundaries:  ## import-linter — arch.md 6.2 as something a build fails on
	cd $(BACKEND) && uv run lint-imports

openapi:  ## Regenerate docs/openapi.implemented.yaml from the code. Run after changing an endpoint
	cd $(BACKEND) && uv run python scripts/openapi.py

audit:  ## Structural audits of the ontology, the API contract and per-package coverage
	uv run --no-project python tools/audit_ontology.py
	uv run --no-project --with pyyaml python tools/audit_api.py
	uv run --no-project python tools/audit_coverage.py

check: lint boundaries coverage audit ui-check  ## Everything, both sides. This is the gate.

# --- Interface -----------------------------------------------------------------

ui-install:  ## Install interface dependencies
	cd $(UI) && npm install

ui-client:  ## Regenerate the typed client from the contract
	cd $(UI) && npm run generate:client

ui-lint:  ## eslint, type-aware. Errors fail; warnings are reported
	cd $(UI) && npm run lint

ui-typecheck:  ## tsc over the interface, with no emit
	cd $(UI) && npx tsc --noEmit

ui-test:  ## Interface unit tests
	cd $(UI) && npm run test

ui-coverage:  ## Interface coverage. Fails below 85%
	cd $(UI) && npm run coverage
	@echo ""
	@echo "  HTML report: ui/coverage/index.html   (make ui-coverage-open)"

ui-coverage-open: ui-coverage  ## Run interface coverage, then open the report
	open $(UI)/coverage/index.html

# The interface half of `check`. It existed as three commands nobody had to run, which is how
# ui/ went unlinted from the first commit until eslint.config.js (known-issues.md D23).
ui-check: ui-lint ui-typecheck ui-coverage  ## The interface gate

# --- End to end ----------------------------------------------------------------
# Owned by the master agent, never by the workstream that wrote the screen (devplan.md 0.2).

e2e:  ## Playwright, against the real backend
	cd $(UI) && npm run e2e

e2e-report:  ## Open the last Playwright report
	cd $(UI) && npm run e2e:report

# --- Containers ----------------------------------------------------------------

docker-build:  ## Build the backend and ui images
	docker compose build

docker-up: ## Start all three containers. Run `make docker-migrate` first, on a fresh database
	docker compose up -d

docker-migrate:  ## Apply migrations inside the compose network
	docker compose --profile tools run --rm migrate

docker-down:  ## Stop all containers
	docker compose down

# --- Schema diagram ------------------------------------------------------------
# An interactive ER diagram of what the database actually is, generated by Liam ERD
# (github.com/liam-hq/liam, Apache-2.0) and never drawn by hand.
#
# The input is a dump of the LIVE database, not the migration files. That is the point: the
# diagram then shows the schema you are actually running, so a diagram that disagrees with
# your expectation means you have not migrated. Run `make migrate` first.
#
# Nothing here is committed -- $(SCHEMA_DOCS)/ is ignored. A generated web bundle in git is a
# diff nobody can read, and the schema's real source of truth is $(STORAGE)/migrations/,
# which is versioned already. Regenerating takes seconds, so a stale copy has no reason to
# exist.
#
# yoyo's three bookkeeping tables are excluded. They record which migrations have run, which
# is a fact about this checkout rather than a part of the model.

schema-diagram:  ## Generate the ER diagram from the live database
	@mkdir -p $(SCHEMA_DOCS)
	docker compose --profile tools run --rm -T --entrypoint sh backup \
	  -c 'pg_dump --schema-only --no-owner --no-privileges \
	      --exclude-table=_yoyo_log --exclude-table=_yoyo_migration \
	      --exclude-table=_yoyo_version --exclude-table=yoyo_lock' \
	  > $(SCHEMA_DOCS)/schema.sql
	cd $(SCHEMA_DOCS) && npx --yes $(LIAM) erd build --input schema.sql --format postgres
	@echo ""
	@echo "  Diagram: $(SCHEMA_DOCS)/dist/   (make schema-diagram-open)"

schema-diagram-open: schema-diagram  ## Generate the diagram, then serve and open it
	@echo "  Serving on http://127.0.0.1:4173 -- Ctrl-C to stop"
	cd $(SCHEMA_DOCS)/dist && npx --yes serve -l 4173 --no-clipboard .
