# OpenFlights data snapshot

`routes.dat` and `airports.dat` are a vendored, frozen copy of the OpenFlights database, the
rank-2 source the catalog declares for `country.international_air_connectivity` (`0101`).

- **Source:** https://github.com/jpatokal/openflights/tree/master/data
  (`routes.dat`, `airports.dat`), also published at https://openflights.org/data.php
- **Fetched:** 2026-10-11, from the files as they stand upstream (unchanged since 2017).
- **Reference date used:** 2017-02-02 — OpenFlights' own note is that the route feed's upstream
  provider stopped supplying updates in 2014, and the file last changed in early 2017. Every
  figure this adapter produces therefore *describes* 2017 and is stored with that reference date,
  which is nine years past the attribute's 24-month `max_age`. That is deliberate: a stale figure
  ranks below any fresher source for the same attribute (`0011-active-value-view.sql`), so it
  fills countries nothing else answers without ever displacing a current figure. Confidence is
  `low` for the same reason, and because the routes are crowdsourced.
- **Licence:** OpenFlights data is published under the Open Database License (ODbL) v1.0
  (https://opendatacommons.org/licenses/odbl/1-0/). Attribution: OpenFlights.org. The files are
  stored unmodified; the derived figures carry their provenance on every value.

## Why vendored rather than fetched

The source is static (frozen since 2017), so there is nothing to poll, and vendoring makes the
computation a pure, reproducible function of files in the repo — anyone can re-run
`connectivity.international_destinations` and get the same answer, and a review can read the
inputs. This mirrors how the transcribed published tables keep their source alongside the figure.

## File formats

- `airports.dat`: `id,name,city,country,IATA,ICAO,lat,lon,alt,tz,dst,tzdb,type,source`
- `routes.dat`: `airline,airline_id,source,source_id,dest,dest_id,codeshare,stops,equipment`
