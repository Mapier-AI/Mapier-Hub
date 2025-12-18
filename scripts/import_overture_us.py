#!/usr/bin/env python3
"""
Import US POIs from Overture Maps into Supabase.
Slim version: skips raw metadata to save space, keeps only primary source attribution.
"""

import os
import sys
import argparse
from datetime import datetime
from pathlib import Path
from typing import Optional

import duckdb
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
from supabase import create_client
from tqdm import tqdm

# Load .env from parent directory (mapierhub/.env)
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

# Configuration
OVERTURE_VERSION = "2025-11-19.0"
OVERTURE_PATH = f"s3://overturemaps-us-west-2/release/{OVERTURE_VERSION}/theme=places/*/*"
BATCH_SIZE = 1000


def get_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables required")
        sys.exit(1)

    return create_client(url, key)


def get_postgres_connection():
    """Connect to local Postgres database."""
    conn_params = {
        'host': os.environ.get('POSTGRES_HOST', 'localhost'),
        'port': os.environ.get('POSTGRES_PORT', '5432'),
        'database': os.environ.get('POSTGRES_DB', 'mapier'),
        'user': os.environ.get('POSTGRES_USER', 'postgres'),
        'password': os.environ.get('POSTGRES_PASSWORD', 'postgres')
    }

    try:
        conn = psycopg2.connect(**conn_params)
        print(f"✓ Connected to {conn_params['host']}:{conn_params['port']}/{conn_params['database']}")
        return conn
    except Exception as e:
        print(f"Error connecting to Postgres: {e}")
        sys.exit(1)


def insert_batch_postgres(conn, batch):
    """Insert batch of records into Postgres using UPSERT."""
    if not batch:
        return

    cursor = conn.cursor()

    # Build INSERT ... ON CONFLICT query for slim schema
    insert_query = """
        INSERT INTO places (
            id, name, confidence, primary_category, alternate_categories,
            brand, operating_status, websites, socials, phones, emails,
            street, city, state, postcode, country, lon, lat,
            updated_at, source_type, primary_source
        ) VALUES %s
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            confidence = EXCLUDED.confidence,
            primary_category = EXCLUDED.primary_category,
            alternate_categories = EXCLUDED.alternate_categories,
            brand = EXCLUDED.brand,
            operating_status = EXCLUDED.operating_status,
            websites = EXCLUDED.websites,
            socials = EXCLUDED.socials,
            phones = EXCLUDED.phones,
            emails = EXCLUDED.emails,
            street = EXCLUDED.street,
            city = EXCLUDED.city,
            state = EXCLUDED.state,
            postcode = EXCLUDED.postcode,
            country = EXCLUDED.country,
            lon = EXCLUDED.lon,
            lat = EXCLUDED.lat,
            updated_at = EXCLUDED.updated_at,
            source_type = EXCLUDED.source_type,
            primary_source = EXCLUDED.primary_source
    """

    # Convert batch to tuples
    values = []
    for record in batch:
        values.append((
            record['id'],
            record['name'],
            record['confidence'],
            record['primary_category'],
            record['alternate_categories'],
            record['brand'],
            record['operating_status'],
            record['websites'],
            record['socials'],
            record['phones'],
            record['emails'],
            record['street'],
            record['city'],
            record['state'],
            record['postcode'],
            record['country'],
            record['lon'],
            record['lat'],
            record['updated_at'],
            record['source_type'],
            record['primary_source']
        ))

    execute_values(cursor, insert_query, values)
    conn.commit()
    cursor.close()


def setup_duckdb():
    con = duckdb.connect()
    con.execute("INSTALL spatial; INSTALL httpfs;")
    con.execute("LOAD spatial; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    return con


def build_query(
    limit: Optional[int] = None,
    category: Optional[str] = None,
    state: Optional[str] = None,
    offset: Optional[int] = None
) -> str:
    """Build the DuckDB query for extracting US POIs."""

    where_clauses = [
        "addresses[1].country = 'US'",
        # US mainland bounding box
        "ST_X(geometry) BETWEEN -128.359795 AND -56.728935",
        "ST_Y(geometry) BETWEEN 24.132028 AND 49.898394",
        # Only high confidence POIs (>= 0.77)
        "confidence >= 0.77",
        # Only fresh data: source update_time must be in 2025 or later
        "sources[1].update_time >= '2025-01-01'"
    ]

    if category:
        where_clauses.append(f"categories.primary = '{category}'")

    if state:
        where_clauses.append(f"addresses[1].region = '{state}'")

    where_clause = " AND ".join(where_clauses)

    query = f"""
    SELECT
        id,
        names.primary AS name,
        confidence,
        categories.primary AS primary_category,
        categories.alternate AS alternate_categories,
        brand.names.primary AS brand,
        operating_status,
        websites,
        socials,
        phones,
        emails,
        addresses[1].freeform AS street,
        addresses[1].locality AS city,
        addresses[1].region AS state,
        addresses[1].postcode AS postcode,
        addresses[1].country AS country,
        ST_X(geometry) AS lon,
        ST_Y(geometry) AS lat,
        sources[1].dataset AS primary_source
    FROM read_parquet('{OVERTURE_PATH}')
    WHERE {where_clause}
    """

    if limit:
        query += f" LIMIT {limit}"

    if offset:
        query += f" OFFSET {offset}"

    return query


def transform_record(row: tuple, columns: list) -> dict:
    """Transform a DuckDB row to a Supabase-compatible dict."""
    record = dict(zip(columns, row))

    # Handle arrays - convert DuckDB arrays to Python lists
    for arr_field in ['alternate_categories', 'websites', 'socials', 'phones', 'emails']:
        if record[arr_field]:
            record[arr_field] = list(record[arr_field])
        else:
            record[arr_field] = None

    # Add metadata
    record['updated_at'] = datetime.utcnow().isoformat()
    record['source_type'] = 'overture'

    return record


def count_records(con: duckdb.DuckDBPyConnection, category: Optional[str], state: Optional[str]) -> int:
    """Count total records to import."""
    where_clauses = [
        "addresses[1].country = 'US'",
        "ST_X(geometry) BETWEEN -128.359795 AND -56.728935",
        "ST_Y(geometry) BETWEEN 24.132028 AND 49.898394",
        "confidence >= 0.77",
        "sources[1].update_time >= '2025-01-01'"
    ]

    if category:
        where_clauses.append(f"categories.primary = '{category}'")
    if state:
        where_clauses.append(f"addresses[1].region = '{state}'")

    where_clause = " AND ".join(where_clauses)

    count_query = f"""
    SELECT COUNT(*) FROM read_parquet('{OVERTURE_PATH}')
    WHERE {where_clause}
    """

    result = con.execute(count_query).fetchone()
    return result[0]


def main():
    parser = argparse.ArgumentParser(description="Import US POIs from Overture Maps (Slim Version)")
    parser.add_argument("--limit", type=int, help="Limit number of records to import")
    parser.add_argument("--offset", type=int, help="Skip N records (for resuming)")
    parser.add_argument("--category", type=str, help="Filter by category")
    parser.add_argument("--state", type=str, help="Filter by state")
    parser.add_argument("--dry-run", action="store_true", help="Don't actually insert")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompt")
    parser.add_argument("--local", action="store_true", help="Use local Postgres instead of Supabase")
    args = parser.parse_args()

    print("=" * 60)
    print("Overture Maps Slim Importer (No RAW metadata)")
    print(f"Version: {OVERTURE_VERSION}")
    print("Filters: confidence >= 0.77, source update_time >= 2025")
    print(f"Target: {'Local Postgres' if args.local else 'Supabase'}")
    print("=" * 60)

    if args.local:
        db_conn = get_postgres_connection()
    else:
        db_conn = get_supabase_client()

    con = setup_duckdb()

    print("Counting records to import...")
    total = count_records(con, args.category, args.state)
    if args.limit:
        total = min(total, args.limit)

    print(f"\nRecords to import: {total:,}")

    if args.dry_run:
        return

    if total > 10000 and not args.yes:
        confirm = input(f"\nThis will upsert {total:,} records. Continue? [y/N] ")
        if confirm.lower() != 'y':
            return

    query = build_query(limit=args.limit, category=args.category, state=args.state, offset=args.offset)
    columns = [
        'id', 'name', 'confidence', 'primary_category', 'alternate_categories',
        'brand', 'operating_status', 'websites', 'socials', 'phones', 'emails',
        'street', 'city', 'state', 'postcode', 'country', 'lon', 'lat', 'primary_source'
    ]

    print(f"\nImporting in batches of {BATCH_SIZE}...")
    result = con.execute(query)

    imported = 0
    errors = 0
    error_samples = []

    with tqdm(total=total, desc="Importing", unit="pois") as pbar:
        while True:
            rows = result.fetchmany(BATCH_SIZE)
            if not rows:
                break

            batch = []
            for row in rows:
                try:
                    record = transform_record(row, columns)
                    batch.append(record)
                except Exception as e:
                    errors += 1
                    if len(error_samples) < 5:
                        error_samples.append(f"Transform error: {e}")

            if batch:
                try:
                    if args.local:
                        insert_batch_postgres(db_conn, batch)
                    else:
                        db_conn.table('places').upsert(batch, on_conflict='id').execute()
                    imported += len(batch)
                except Exception:
                    # Fallback to one-by-one for error identification
                    for record in batch:
                        try:
                            if args.local:
                                insert_batch_postgres(db_conn, [record])
                            else:
                                db_conn.table('places').upsert(record, on_conflict='id').execute()
                            imported += 1
                        except Exception as e2:
                            errors += 1
                            if len(error_samples) < 5:
                                error_samples.append(f"Insert error: {e2}")

            pbar.update(len(rows))

    print(f"\n{'=' * 60}")
    print("Import complete!")
    print(f"  Imported/Updated: {imported:,}")
    print(f"  Errors: {errors:,}")

    if error_samples:
        print("\nSample errors:")
        for err in error_samples:
            print(f"  - {err}")

    if args.local:
        db_conn.close()

    print(f"\n{'=' * 60}")
    print("Done!")


if __name__ == "__main__":
    main()
