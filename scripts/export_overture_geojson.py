#!/usr/bin/env python3
"""
Export Overture POIs to GeoJSON for visualization.

Usage:
    python export_overture_geojson.py --bbox "-87.61,-87.58,41.78,41.80" --output hyde_park.geojson
    python export_overture_geojson.py --bbox "-122.52,-122.35,37.70,37.83" --output sf.geojson --limit 100
"""

import json
import argparse
import duckdb


OVERTURE_VERSION = "2025-11-19.0"
OVERTURE_PATH = f"s3://overturemaps-us-west-2/release/{OVERTURE_VERSION}/theme=places/*/*"


def setup_duckdb():
    con = duckdb.connect()
    con.execute("INSTALL spatial; INSTALL httpfs;")
    con.execute("LOAD spatial; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    return con


def export_to_geojson(bbox, output_file, limit=None):
    """
    Export POIs to GeoJSON.

    Args:
        bbox: Bounding box as "min_lon,max_lon,min_lat,max_lat"
        output_file: Output GeoJSON file path
        limit: Optional limit on number of POIs
    """
    # Parse bbox
    min_lon, max_lon, min_lat, max_lat = map(float, bbox.split(','))

    print(f"Exporting POIs from bounding box: {bbox}")
    print(f"Filters: confidence >= 0.77, source_update_time >= 2025")

    con = setup_duckdb()

    # Build query
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
        basic_category,
        brand.wikidata AS brand_wikidata
    FROM read_parquet('{OVERTURE_PATH}')
    WHERE addresses[1].country = 'US'
      AND ST_X(geometry) BETWEEN {min_lon} AND {max_lon}
      AND ST_Y(geometry) BETWEEN {min_lat} AND {max_lat}
      AND confidence >= 0.77
      AND sources[1].update_time >= '2025-01-01'
    """

    if limit:
        query += f" LIMIT {limit}"

    print("Querying Overture data...")
    result = con.execute(query)
    columns = [desc[0] for desc in result.description]
    rows = result.fetchall()

    print(f"Found {len(rows)} POIs")

    # Build GeoJSON
    features = []
    for row in rows:
        record = dict(zip(columns, row))

        # Handle arrays
        for field in ['alternate_categories', 'websites', 'socials', 'phones', 'emails']:
            if record[field]:
                record[field] = list(record[field])

        # Extract coordinates
        lon = record.pop('lon')
        lat = record.pop('lat')

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            },
            "properties": record
        }
        features.append(feature)

    geojson = {
        "type": "FeatureCollection",
        "features": features
    }

    # Write to file
    with open(output_file, 'w') as f:
        json.dump(geojson, f, indent=2)

    print(f"\n✓ Exported {len(features)} POIs to {output_file}")
    print(f"\nSample POIs:")
    for i, feature in enumerate(features[:5]):
        props = feature['properties']
        print(f"  {i+1}. {props['name']} ({props['primary_category']}) - confidence: {props['confidence']:.2f}")


def main():
    parser = argparse.ArgumentParser(description="Export Overture POIs to GeoJSON")
    parser.add_argument("--bbox", required=True,
                       help="Bounding box: min_lon,max_lon,min_lat,max_lat (e.g., '-87.61,-87.58,41.78,41.80')")
    parser.add_argument("--output", required=True, help="Output GeoJSON file")
    parser.add_argument("--limit", type=int, help="Limit number of POIs")
    args = parser.parse_args()

    export_to_geojson(args.bbox, args.output, args.limit)


if __name__ == "__main__":
    main()
