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
        e2e e2e-database e2e-drop e2e-report \
        docker-build docker-up docker-migrate docker-down env \
        schema-diagram schema-diagram-open

BACKEND := backend
UI      := ui
# The SQL is a system asset, not a Python implementation detail (reqs.md Q200).
STORAGE := storage

# .env is the single source of technical configuration (arch.md 7.5). `-include` so that
# `make env` still works before it exists.
-include .env

# One pair of matching dotenv quotes off, as compose takes it off. Word-wise: one-word values only.
override unquoted = $(if $(filter "%",$(1)),$(patsubst "%",%,$(1)),$(patsubst '%',%,$(1)))

# **Compose reads .env, never the command line** (INF-G2). GNU make exports a command-line
# variable to every recipe, and `docker compose` prefers its environment to .env -- so
# `make e2e DATABASE_PORT=1` recreated the live database container on port 1 (2026-10-20). Every
# compose call goes through $(COMPOSE), which refuses the variables compose.yaml interpolates
# when they come from the command line or win through `make -e`; set them in .env, where compose
# and the stack agree. A value from the shell's environment is not refused: .env overrides it
# before any recipe runs. `$(origin)` answers in two words, so they are joined before matching:
# a filter on the words alone would refuse a plain "environment" too.
COMPOSE_VARS := POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_PORT BACKEND_PORT UI_PORT \
                SCHEMA_DIAGRAM_PORT APP_DISPLAY_NAME
empty :=
space := $(empty) $(empty)
origin_of = $(subst $(space),_,$(origin $(1)))
refuse_from_outside = $(foreach v,$(1),$(if $(filter command_line environment_override,$(call origin_of,$(v))),$(error $(v) cannot be set on the command line or through make -e: $(2))))
COMPOSE = $(call refuse_from_outside,$(COMPOSE_VARS),docker compose would read it instead of .env and could recreate the live containers -- set it in .env)docker compose
# Pinned rather than @latest: a diagram that changes because a tool released overnight
# is a diff nobody asked for, and this is documentation about a schema that did not move.
LIAM    := @liam-hq/cli@0.7.24
SCHEMA_DOCS := docs/schema

COV     := --cov=starnest --cov-branch \
           --cov-report=term-missing --cov-report=html --cov-report=xml --cov-report=json

help:  ## Show this list
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# --- Local development ---------------------------------------------------------

env:  ## Create .env from the example, if it does not exist yet
	@test -f .env && echo ".env already exists — leaving it alone" \
	  || (cp .env.example .env && echo "created .env — fill in the password and the API key")

up:  ## Start PostgreSQL only. The backend and UI run from the command line
	$(COMPOSE) up -d database

serve:  ## Run the API from the command line, against the database in Docker
	cd $(BACKEND) && uv run python -c "from starnest.main import run; run()"

acquire:  ## Fetch real figures from every source, then the stand-ins. One run, explicit like migrate
	cd $(BACKEND) && uv run python scripts/acquire.py

rank:  ## Print the ranking from what is stored. SET=local_employment for another criteria set
	cd $(BACKEND) && uv run python scripts/rank.py $(SET)

down:  ## Stop everything, keeping the data volume
	$(COMPOSE) down

logs:  ## Follow the database statement log (arch.md 10.7 — this IS the audit)
	$(COMPOSE) logs -f database

# --- Schema --------------------------------------------------------------------
# Migrations run by an explicit command, never at startup (arch.md 7.4). Back up first:
# manually entered values cannot be re-fetched at any price (arch.md 9.5).

# `tools/migrate.py` reads the URL from .env as the backend does and hands it to yoyo, so make
# never holds it: no quoting to get wrong (RF-1), and no password to print (S1). A URL passed to
# make would be ignored, and the live database migrated instead, so it is refused (RF-2).
ifneq ($(filter migrate rollback,$(MAKECMDGOALS)),)
$(call refuse_from_outside,DATABASE_URL,migrate and rollback take the database from .env -- edit it there)
endif
migrate: backup  ## Back up, then apply pending migrations
	cd $(BACKEND) && uv run python ../tools/migrate.py apply

# A rollback changes the schema as surely as a migration does, and several rollback scripts
# delete stored figures, so it backs up first for the same reason.
rollback: backup  ## Back up, then roll back the most recent migration
	cd $(BACKEND) && uv run python ../tools/migrate.py rollback

# `--no-deps`: the dump is taken from the running database, and compose never starts or recreates
# it to match whatever configuration reached it (RA-2). So `make up` first; a stopped database
# fails the backup, and with it `migrate` and `rollback`, rather than being started behind them.
backup:  ## pg_dump to ./backups
	@mkdir -p backups
	$(COMPOSE) --profile tools run --rm --no-deps backup

# --- Backend tests -------------------------------------------------------------

test:  ## Fast unit tests, no coverage
	cd $(BACKEND) && uv run pytest -m "not storage and not acceptance and not live and not live_llm"

test-storage:  ## Tests against a real PostgreSQL — the constraints ARE the behaviour
	cd $(BACKEND) && uv run pytest -m storage

test-acceptance:  ## The HTTP contract, end to end against a live backend
	cd $(BACKEND) && uv run pytest -m acceptance

live-llm:  ## Ask the real Anthropic API one question. COSTS MONEY, never part of `make check`
	@echo "This calls Anthropic and spends real money. Ctrl-C now if that is not what you meant."
	cd $(BACKEND) && uv run pytest -m live_llm -s

live:  ## Real third-party sources, on purpose: the fixtures still match, and Gate B's coverage holds
	cd $(BACKEND) && uv run pytest -m live

# `live` is excluded: those tests call real third-party sources, and a gate that fails because
# Eurostat was slow says nothing about this code (arch.md 6.7). Until 2026-09-11 it ran them.
coverage:  ## Full suite with coverage, live excluded. Fails below 85% of lines+branches blended; make audit holds each to 85% per package
	# `not live_llm` is stated as well as defaulted: pytest lets the last -m win, so this
	# expression used to override the exclusion in pyproject.toml and put the paid tests back
	# into the gate. A conftest guard now refuses them unless selected by name (P35).
	cd $(BACKEND) && uv run pytest -m "not live and not live_llm" $(COV)
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
#
# **Its own stack, never yours** (UI-03). The suite writes -- weights, gates, settings, a small
# acquisition -- and it used to do so through the containers, to the live database. Now it runs
# on a throwaway copy of the newest backup, migrated to this checkout (so a pending migration is
# rehearsed on real data first), served by a backend and a Vite that Playwright starts on ports
# Docker does not publish, and dropped afterwards whether the suite passed or failed. A restore or
# a migration that fails drops the copy at once. A drop that fails fails the run and says how to
# finish it. Ctrl-C leaves the copy behind, and the next run drops it before restoring.
#
# **Nothing here can reach the live database** (UIC-A1, INF-G2, INF-M1). Each rule is proved by
# running make, not by reading this file (backend/tests/unit/test_make_isolation.py):
# - The copy's name and URL are derived from .env and refused from the command line: the recipes
#   drop, restore and migrate before Playwright's own `_e2e` refusal can run.
# - The name must be plain -- letters, digits, `_` and `-` -- because only then is the name that
#   was measured the one every command is handed. A name that is not, or that PostgreSQL would cut
#   short, stops make itself, from inside every command that could drop: no flag ignores that.
# - The tools container runs `--no-deps`, so it never starts, stops or recreates the database,
#   even after .env has changed under a running stack.
# - No recipe line names $(MAKE), which GNU make runs even under `make -n`: a dry run only prints.
# - The URL carries the password, so it reaches the recipes through their environment, and
#   `make -n` prints a variable's name rather than its value.

# Captured before the overrides below, which would otherwise report their own origin: one of these
# set from anywhere outside -- the command line, the shell, `make -e` -- is refused out loud rather
# than silently ignored. Under some makes `-e` lets the environment beat a target-specific
# assignment, and E2E_YOYO_URL, the URL yoyo migrates, is one (RA-1).
E2E_PASSED := $(strip $(foreach v,E2E_DB E2E_DATABASE_URL E2E_YOYO_URL E2E_SUITE_URL,$(if $(filter undefined,$(origin $(v))),,$(v))))
E2E_GUARD   = $(if $(E2E_PASSED),$(error $(firstword $(E2E_PASSED)) cannot be set from outside the Makefile: it is derived from .env so that make e2e can only reach its own copy))
# PostgreSQL keeps 63 bytes of a name and silently drops the rest, so the copy of a 63-byte name
# would *be* the live name, and `dropdb --force` would drop it (RA-3). The name is measured here
# and used by the tools container's shell, by a URL and by compose, so a measurement holds only
# for a name all of them read alike: a plain one, of letters, digits, `_` and `-`. A quoted name
# with spaces measured 63 bytes and reached `dropdb` as 67, the live name once cut (RE-1). One
# pair of matching quotes comes off first, as compose takes it off (RA-4); `value` reads what make
# parsed without expanding a `$` in it -- though make has already ended the line at a `#`, so
# `app#db` is read, and used, as `app`, which no copy name can turn into the live one (RE-6).
#
# **The refusal is make's own error, not a failing recipe line** (RE-4). `make -i`, or an `i`
# inherited through MAKEFLAGS, ignores a failing line, and a refusal on a line of its own let the
# next line drop. `E2E_FIT` is part of `PG_TOOLS`, the one way into the tools container, so every
# command that could drop a database carries it; make expands all of a recipe's lines before it
# runs the first, and an error there stops it before anything has run, whatever the flags. The
# name is measured in make too, one word per character, so no shell ever sees a name it refuses.
override E2E_NAME_CHARS := a b c d e f g h i j k l m n o p q r s t u v w x y z A B C D E F G H I J K L M N O P Q R S T U V W X Y Z 0 1 2 3 4 5 6 7 8 9 _ -
override e2e_leftover    = $(if $(2),$(call e2e_leftover,$(subst $(firstword $(2)),,$(1)),$(wordlist 2,$(words $(2)),$(2))),$(1))
override e2e_spaced      = $(if $(2),$(call e2e_spaced,$(subst $(firstword $(2)),$(firstword $(2)) ,$(1)),$(wordlist 2,$(words $(2)),$(2))),$(1))
override E2E_WRITTEN    := $(value POSTGRES_DB)
override E2E_BASE       := $(call unquoted,$(E2E_WRITTEN))
override E2E_PLAIN      := $(if $(filter 1,$(words $(E2E_WRITTEN))),$(if $(strip $(E2E_BASE)),$(if $(strip $(call e2e_leftover,$(E2E_BASE),$(E2E_NAME_CHARS))),,plain)))
override E2E_FIT         = $(if $(strip $(E2E_WRITTEN)),$(if $(E2E_PLAIN),$(if $(wordlist 64,64,$(call e2e_spaced,$(E2E_DB),$(E2E_NAME_CHARS))),$(error $(E2E_TOO_LONG))),$(error $(E2E_NOT_PLAIN))),$(error $(E2E_NO_NAME)))
override E2E_NO_NAME     = e2e: no POSTGRES_DB -- run make env
override E2E_NOT_PLAIN   = e2e: POSTGRES_DB is not a plain name of letters and digits and _ or -, the only kind whose copy is named as it is measured -- refusing
override E2E_TOO_LONG    = e2e: $(E2E_DB) is longer than the 63 bytes PostgreSQL keeps of a name, so its copy could not be told from the live database -- refusing

override E2E_DB  := $(E2E_BASE)_e2e
E2E_BACKEND_PORT ?= 8100
E2E_UI_PORT      ?= 5180
override E2E_DATABASE_URL := postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@127.0.0.1:$(or $(DATABASE_PORT),5432)/$(E2E_DB)
NEWEST_BACKUP    := $(lastword $(sort $(wildcard backups/*.dump)))
# The backup service has the PostgreSQL client tools, which the host does not.
override PG_TOOLS = $(E2E_FIT)$(COMPOSE) --profile tools run --rm -T --no-deps --entrypoint sh backup -c
override E2E_DROP = $(PG_TOOLS) 'dropdb --if-exists --force $(E2E_DB)'

e2e-database: export E2E_YOYO_URL := $(subst postgresql://,postgresql+psycopg://,$(E2E_DATABASE_URL))
e2e: export E2E_SUITE_URL := $(E2E_DATABASE_URL)

e2e-database:  ## A throwaway copy of the newest backup, migrated to this checkout
	@$(E2E_GUARD)test -n "$(NEWEST_BACKUP)" || { echo "e2e: no backup in ./backups -- run make backup"; exit 1; }
	@echo "e2e: $(notdir $(NEWEST_BACKUP)) -> $(E2E_DB)"
	@{ $(PG_TOOLS) 'dropdb --if-exists --force $(E2E_DB) && createdb $(E2E_DB) && pg_restore --no-owner --no-privileges --single-transaction --dbname=$(E2E_DB) /backups/$(notdir $(NEWEST_BACKUP))' && cd $(BACKEND) && uv run yoyo apply --batch --database "$$E2E_YOYO_URL" ../$(STORAGE)/migrations; } || { cd "$(CURDIR)"; if $(E2E_DROP); then echo "e2e: the copy could not be restored or migrated, so it was dropped"; else echo "e2e: the copy could not be restored or migrated, and dropping it failed too -- run make e2e-drop"; fi; exit 1; }

e2e-drop:  ## Drop the browser suite's throwaway database
	@$(E2E_GUARD)$(E2E_DROP)

e2e: e2e-database  ## Playwright on its own throwaway database, never the live one (E2E_ARGS= to narrow)
	@$(E2E_GUARD)(cd $(UI) && E2E_DATABASE_URL="$$E2E_SUITE_URL" E2E_BACKEND_PORT=$(E2E_BACKEND_PORT) E2E_UI_PORT=$(E2E_UI_PORT) npm run e2e -- $(E2E_ARGS)); status=$$?; if ! $(E2E_DROP); then echo "e2e: the copy $(E2E_DB) could not be dropped -- run make e2e-drop"; [ $$status -ne 0 ] || status=1; fi; exit $$status

e2e-report:  ## Open the last Playwright report
	cd $(UI) && npm run e2e:report

# --- Containers ----------------------------------------------------------------

docker-build:  ## Build the backend and ui images
	$(COMPOSE) build

docker-up: ## Start the app (127.0.0.1:5173) and the schema diagram (127.0.0.1:4174). Migrate first
	$(COMPOSE) up -d

# The backup is compose's: `migrate` depends on the `backup` service, so listing `backup` here as
# well would dump twice. The directory is made first for the reason `backup` makes it.
docker-migrate:  ## Back up, then apply migrations inside the compose network
	@mkdir -p backups
	$(COMPOSE) --profile tools run --rm migrate

docker-down:  ## Stop all containers
	$(COMPOSE) down

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
	$(COMPOSE) --profile tools run --rm -T --no-deps --entrypoint sh backup \
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
