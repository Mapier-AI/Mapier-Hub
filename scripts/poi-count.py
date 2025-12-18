import duckdb

con = duckdb.connect()
con.execute('INSTALL spatial; INSTALL httpfs;')
con.execute('LOAD spatial; LOAD httpfs;')
con.execute("SET s3_region='us-west-2';")

print("Counting POIs in US mainland...")
print("Bounding box: -128.36 to -56.73 (lon), 24.13 to 49.90 (lat)")
print("Filters: confidence >= 0.77, source_update_time >= 2025\n")

# US mainland bounding box
query = """
SELECT COUNT(*)
FROM read_parquet('s3://overturemaps-us-west-2/release/2025-11-19.0/theme=places/*/*')
WHERE addresses[1].country = 'US'
  AND ST_X(geometry) BETWEEN -128.359795 AND -56.728935
  AND ST_Y(geometry) BETWEEN 24.132028 AND 49.898394
  AND confidence >= 0.77
  AND sources[1].update_time >= '2025-01-01'
"""

result = con.execute(query).fetchone()
print(f"Total high-quality POIs in US mainland: {result[0]:,}")
