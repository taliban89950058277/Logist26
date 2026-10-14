import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDirectory = path.join(projectRoot, 'data');
export const databasePath = process.env.DATABASE_PATH || path.join(dataDirectory, 'carriers.sqlite');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS cities (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    region TEXT NOT NULL,
    region_key TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    source TEXT NOT NULL,
    UNIQUE(name_key, region_key)
  );

  CREATE TABLE IF NOT EXISTS city_aliases (
    alias_key TEXT NOT NULL,
    city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    PRIMARY KEY(alias_key, city_id)
  );

  CREATE TABLE IF NOT EXISTS carrier_city_overrides (
    source_key TEXT PRIMARY KEY,
    city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS carriers (
    id INTEGER PRIMARY KEY,
    source_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    legal_address TEXT NOT NULL DEFAULT '',
    address_key TEXT NOT NULL DEFAULT '',
    legal_city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL,
    match_status TEXT NOT NULL DEFAULT 'unmatched',
    match_candidates TEXT NOT NULL DEFAULT '[]',
    contacts TEXT NOT NULL DEFAULT '[]',
    phone TEXT,
    search_text TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY,
    source_key TEXT NOT NULL UNIQUE,
    carrier_id INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
    loaded_on TEXT,
    origin TEXT NOT NULL DEFAULT '',
    origin_key TEXT NOT NULL DEFAULT '',
    origin_region TEXT NOT NULL DEFAULT '',
    origin_region_key TEXT NOT NULL DEFAULT '',
    destination TEXT NOT NULL DEFAULT '',
    destination_key TEXT NOT NULL DEFAULT '',
    destination_region TEXT NOT NULL DEFAULT '',
    destination_region_key TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    driver TEXT NOT NULL DEFAULT '',
    vehicle TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS carrier_route_ratings (
    carrier_id INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
    origin_region_key TEXT NOT NULL,
    destination_region_key TEXT NOT NULL,
    score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 10),
    feedback TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(carrier_id, origin_region_key, destination_region_key)
  );

  CREATE TABLE IF NOT EXISTS carrier_home_ratings (
    carrier_id INTEGER PRIMARY KEY REFERENCES carriers(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 10),
    feedback TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS cities_search_idx ON cities(name_key, region_key);
  CREATE INDEX IF NOT EXISTS carriers_city_idx ON carriers(legal_city_id);
  CREATE INDEX IF NOT EXISTS carriers_name_idx ON carriers(name_key);
  CREATE INDEX IF NOT EXISTS shipments_carrier_date_idx ON shipments(carrier_id, loaded_on DESC);
`);

const overrideColumns = database.prepare('PRAGMA table_info(carrier_city_overrides)').all();
if (overrideColumns.some((column) => column.name === 'carrier_id')) {
  database.exec(`
    BEGIN IMMEDIATE;
    ALTER TABLE carrier_city_overrides RENAME TO carrier_city_overrides_old;
    CREATE TABLE carrier_city_overrides (
      source_key TEXT PRIMARY KEY,
      city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE RESTRICT
    );
    INSERT INTO carrier_city_overrides(source_key, city_id)
      SELECT carriers.source_key, carrier_city_overrides_old.city_id
      FROM carrier_city_overrides_old
      JOIN carriers ON carriers.id = carrier_city_overrides_old.carrier_id;
    DROP TABLE carrier_city_overrides_old;
    COMMIT;
  `);
}