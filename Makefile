# Every command the project has. `make` on its own lists them.
#
# Two projects live here and they share nothing (arch.md 6.1):
#
#   backend/     Python, uv, pytest        -- the REST API and all domain logic
#   ui/   TypeScript, npm, vitest   -- a client of the contract, over HTTP only
#
# Recipes are prefixed accordingly. `make check` runs everything both sides can prove.

.DEFAULT_GOAL := help
.PHONY: help up down logs migrate rollback backup \
        test test-storage test-acceptance coverage coverage-open lint format boundaries audit check \
        ui-install ui-test ui-coverage ui-coverage-open ui-client e2e e2e-report \
        docker-build docker-up docker-migrate docker-down env

BACKEND := backend
UI      := ui

# .env is the single source of technical configuration (arch.md 7.5). `-include` so that
# `make env` still works before it exists.
-include .env

# yoyo names its driver in the URL scheme and psycopg3 does not: a plain postgresql://
# resolves to yoyo's psycopg2 backend, which is not installed and never will be. The
# application keeps the standard form, so the translation happens here rather than in a
# second variable that could drift out of step.
MIGRATION_URL := $(subst postgresql://,postgresql+psycopg://,$(DATABASE_URL))
COV     := --cov=starnest --cov-branch \
           --cov-report=term-missing --cov-report=html --cov-report=xml

help:  ## Show this list
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# --- Local development ---------------------------------------------------------

env:  ## Create .env from the example, if it does not exist yet
	@test -f .env && echo ".env already exists — leaving it alone" \
	  || (cp .env.example .env && echo "created .env — fill in the password and the API key")

up:  ## Start PostgreSQL only. The backend and UI run from the command line
	docker compose up -d database

down:  ## Stop everything, keeping the data volume
	docker compose down

logs:  ## Follow the database statement log (arch.md 10.7 — this IS the audit)
	docker compose logs -f database

# --- Schema --------------------------------------------------------------------
# Migrations run by an explicit command, never at startup (arch.md 7.4). Back up first:
# manually entered values cannot be re-fetched at any price (arch.md 9.5).

migrate: backup  ## Back up, then apply pending migrations
	cd $(BACKEND) && uv run yoyo apply --batch --database "$(MIGRATION_URL)" ./migrations

rollback:  ## Roll back the most recent migration
	cd $(BACKEND) && uv run yoyo rollback --batch --database "$(MIGRATION_URL)" ./migrations

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

coverage:  ## Full suite with coverage. Fails below 75% lines and branches
	cd $(BACKEND) && uv run pytest $(COV)
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

audit:  ## Structural audits of the ontology and the API contract
	uv run --no-project python tools/audit_ontology.py
	uv run --no-project --with pyyaml python tools/audit_api.py

check: lint boundaries coverage audit  ## Everything. This is the gate.

# --- Interface -----------------------------------------------------------------

ui-install:  ## Install interface dependencies
	cd $(UI) && npm install

ui-client:  ## Regenerate the typed client from the contract
	cd $(UI) && npm run generate:client

ui-test:  ## Interface unit tests
	cd $(UI) && npm run test

ui-coverage:  ## Interface coverage. Fails below 75%
	cd $(UI) && npm run coverage
	@echo ""
	@echo "  HTML report: ui/coverage/index.html   (make ui-coverage-open)"

ui-coverage-open: ui-coverage  ## Run interface coverage, then open the report
	open $(UI)/coverage/index.html

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
