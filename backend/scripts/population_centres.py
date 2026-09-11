"""Write the migration seeding each country's five largest places, from a GeoNames dump.

Decided 2026-09-11 (`devplan.md` D4): a national climate figure is the population-weighted mean
over the country's largest places, because a centroid gives Spain the climate of an empty
plateau and a capital gives Italy only Rome. The places are **sourced, never typed from
memory**: GeoNames publishes every place of 5,000 people or more, under CC BY 4.0, with its
coordinates and population.

    curl -O https://download.geonames.org/export/dump/cities5000.zip && unzip cities5000.zip
    uv run python scripts/population_centres.py cities5000.txt 2026-09-11 > rows.sql

The rows are printed and pasted into the migration's VALUES list, so the migration is reviewed
as a diff like any other. Places
only -- `PPL` and its administrative variants -- never `PPLX`, GeoNames' code for a section of a
place, which would count one city's districts as several cities.
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path

PLACES = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLG"}
PER_COUNTRY = 5

# The candidates' ISO codes, which GeoNames shares -- including GB and GR, where Eurostat differs.
THE_32 = {
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "IE", "IT",
    "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "CH", "GB",
}  # fmt: skip

# GeoNames' tab-separated columns, by position (download.geonames.org/export/dump/readme.txt).
GEONAME_ID, NAME, LATITUDE, LONGITUDE, FEATURE_CODE, COUNTRY_CODE, POPULATION = 0, 1, 4, 5, 7, 8, 14


def main(dump: Path, retrieved_on: str, country_codes: set[str]) -> str:
    by_country: dict[str, list[list[str]]] = defaultdict(list)
    with dump.open(encoding="utf-8") as rows:
        for row in csv.reader(rows, delimiter="\t", quoting=csv.QUOTE_NONE):
            if (
                row[COUNTRY_CODE] in country_codes
                and row[FEATURE_CODE] in PLACES
                and int(row[POPULATION] or 0) > 0
            ):
                by_country[row[COUNTRY_CODE]].append(row)

    lines = []
    for code in sorted(by_country):
        largest = sorted(by_country[code], key=lambda row: -int(row[POPULATION]))[:PER_COUNTRY]
        lines.extend(
            f"    ({row[GEONAME_ID]}, '{code}', '{row[NAME].replace(chr(39), chr(39) * 2)}', "
            f"{row[LATITUDE]}, {row[LONGITUDE]}, {row[POPULATION]}, '{retrieved_on}')"
            for row in largest
        )
    return ",\n".join(lines)


if __name__ == "__main__":
    print(main(Path(sys.argv[1]), sys.argv[2], THE_32))
