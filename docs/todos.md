# Alex Stancu's notes

## TODOs for AI
- [x] Visual SQL Diagram. Check online if there's a tool we can use to generate a visual representation (graph-like) based on the tables and relations we have.
      Done: **Liam ERD** (github.com/liam-hq/liam, Apache-2.0), wired up as `make schema-diagram` / `make schema-diagram-open`.
      Generated from a dump of the live database, so the diagram shows what is actually running.
      Output lands in `docs/schema/` and is gitignored — regenerate rather than commit.
      Runner-up if search across many tables ever matters more than a picture: Azimutt (MIT).
      Not adopted, still available: `tbls`, which adds a `diff` that fails CI when docs drift from the schema.

## TODOs for Alex
