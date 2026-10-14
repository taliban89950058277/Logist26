import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { database, projectRoot } from './db.js';

const cityFile = path.join(projectRoot, 'справочник городов.xls');
const shipmentFile = path.join(projectRoot, 'Список перевозчиков.xls');
const normalize = (value) => String(value ?? '')
  .toLocaleUpperCase('ru-RU')
  .replaceAll('Ё', 'Е')
  .replace(/[^0-9A-ZА-Я]+/g, ' ')
  .replace(/(^| )ОБЛ(?= |$)/g, '$1ОБЛАСТЬ')
  .replace(/(^| )РЕСП(?= |$)/g, '$1РЕСПУБЛИКА')
  .trim();
const cleanCityName = (value) => String(value ?? '').trim().replace(/\s+(?:г\.?|город)$/i, '').trim();
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readSheet = (filePath) => {
  const python = path.join(projectRoot, '.venv-import', 'bin', 'python');
  const reader = path.join(projectRoot, 'server', 'read-xls.py');
  return JSON.parse(execFileSync(python, [reader, filePath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }));
};
const cellText = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').trim();

function toIsoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = cellText(value);
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function readCityDirectory() {
  const rows = readSheet(cityFile);
  const citiesByKey = new Map();
  const aliasesByKey = new Map();

  for (const [rawName, rawRegion] of rows.slice(1)) {
    const name = cleanCityName(rawName);
    const region = cellText(rawRegion);
    if (!name || !region) continue;

    const nameKey = normalize(name);
    const regionKey = normalize(region);
    if (!nameKey || (String(rawName).trim().match(/\s+г\.?$/i) && nameKey === regionKey)) continue;

    const cityKey = `${nameKey}|${regionKey}`;
    if (!citiesByKey.has(cityKey)) citiesByKey.set(cityKey, { name, nameKey, region, regionKey });
    const aliases = new Set([normalize(rawName), nameKey]);
    for (const aliasKey of aliases) {
      if (!aliasKey) continue;
      if (!aliasesByKey.has(aliasKey)) aliasesByKey.set(aliasKey, new Set());
      aliasesByKey.get(aliasKey).add(cityKey);
    }
  }

  const insertCity = database.prepare(`
    INSERT INTO cities(name, name_key, region, region_key, source)
    VALUES (?, ?, ?, ?, 'city_directory')
    ON CONFLICT(name_key, region_key) DO UPDATE SET name = excluded.name
  `);
  for (const city of citiesByKey.values()) {
    insertCity.run(city.name, city.nameKey, city.region, city.regionKey);
  }

  const cityIds = new Map(database.prepare('SELECT id, name_key, region_key FROM cities').all()
    .map((city) => [`${city.name_key}|${city.region_key}`, city.id]));
  const insertAlias = database.prepare('INSERT OR IGNORE INTO city_aliases(alias_key, city_id) VALUES (?, ?)');
  for (const [aliasKey, cityKeys] of aliasesByKey) {
    for (const cityKey of cityKeys) {
      insertAlias.run(aliasKey, cityIds.get(cityKey));
    }
  }

  const candidates = [];
  for (const [aliasKey, cityKeys] of aliasesByKey) {
    if (aliasKey.length < 3) continue;
    for (const cityKey of cityKeys) {
      const city = citiesByKey.get(cityKey);
      candidates.push({ aliasKey, id: cityIds.get(cityKey), name: city.name, region: city.region });
    }
  }
  candidates.sort((left, right) => right.aliasKey.length - left.aliasKey.length);
  return { citiesByKey, aliasesByKey, candidates };
}

const regionStopWords = new Set(['РЕСПУБЛИКА', 'РЕСП', 'ОБЛАСТЬ', 'ОБЛ', 'КРАЙ', 'АО', 'АВТОНОМНЫЙ', 'ОКРУГ', 'Г', 'РЕГИОН']);
const regionScore = (region, addressWords) => normalize(region).split(' ')
  .filter((word) => word.length > 2 && !regionStopWords.has(word))
  .filter((word) => addressWords.has(word)).length;

function matchLegalAddress(address, candidates) {
  const addressKey = normalize(address);
  if (!addressKey) return { cityId: null, status: 'unmatched', candidates: [] };

  const matches = [];
  for (const candidate of candidates) {
    const expression = new RegExp(`(^| )${candidate.aliasKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
    if (expression.test(addressKey)) matches.push(candidate);
  }
  if (!matches.length) return { cityId: null, status: 'unmatched', candidates: [] };

  const longest = matches[0].aliasKey.length;
  const best = [...new Map(matches
    .filter((candidate) => candidate.aliasKey.length === longest)
    .map((candidate) => [candidate.id, candidate])).values()];
  if (best.length === 1) return { cityId: best[0].id, status: 'matched', candidates: best };

  const words = new Set(addressKey.split(' '));
  const scored = best.map((candidate) => ({ ...candidate, score: regionScore(candidate.region, words) }));
  const maxScore = Math.max(...scored.map((candidate) => candidate.score));
  const regionalMatches = scored.filter((candidate) => candidate.score === maxScore && maxScore > 0);
  if (regionalMatches.length === 1) {
    return { cityId: regionalMatches[0].id, status: 'matched', candidates: regionalMatches };
  }
  return { cityId: null, status: 'ambiguous', candidates: scored };
}

function importData() {
  const cityData = readCityDirectory();
  const rows = readSheet(shipmentFile);
  const carriers = new Map();
  const shipments = [];

  for (const [index, row] of rows.slice(1).entries()) {
    const [date, origin, originRegion, destination, destinationRegion, rawCarrier, rawAddress, rawContact, rawDriver, , rawVehicle] = row;
    const name = cellText(rawCarrier);
    if (!name) continue;

    const legalAddress = cellText(rawAddress);
    const nameKey = normalize(name);
    const addressKey = normalize(legalAddress);
    const sourceKey = digest(`${nameKey}\n${addressKey}`);
    if (!carriers.has(sourceKey)) {
      const cityMatch = matchLegalAddress(legalAddress, cityData.candidates);
      carriers.set(sourceKey, {
        sourceKey,
        name,
        nameKey,
        legalAddress,
        addressKey,
        cityMatch,
        contacts: new Set(),
        searchTerms: new Set([name, legalAddress]),
      });
    }

    const carrier = carriers.get(sourceKey);
    for (const candidate of carrier.cityMatch.candidates) {
      carrier.searchTerms.add(candidate.name);
      carrier.searchTerms.add(candidate.region);
    }
    const contact = cellText(rawContact);
    if (contact) carrier.contacts.add(contact);
    for (const term of [origin, originRegion, destination, destinationRegion, contact]) {
      if (cellText(term)) carrier.searchTerms.add(cellText(term));
    }
    shipments.push({
      sourceKey: digest(`carrier-workbook:${index + 2}`),
      carrierKey: sourceKey,
      loadedOn: toIsoDate(date),
      origin: cellText(origin),
      originKey: normalize(origin),
      originRegion: cellText(originRegion),
      originRegionKey: normalize(originRegion),
      destination: cellText(destination),
      destinationKey: normalize(destination),
      destinationRegion: cellText(destinationRegion),
      destinationRegionKey: normalize(destinationRegion),
      contact,
      driver: cellText(rawDriver),
      vehicle: cellText(rawVehicle),
    });
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`
      DELETE FROM shipments WHERE source = 'carrier_workbook';
      DELETE FROM carriers WHERE source = 'carrier_workbook';
      DELETE FROM city_aliases;
    `);
    const restoreAlias = database.prepare('INSERT OR IGNORE INTO city_aliases(alias_key, city_id) VALUES (?, ?)');
    for (const candidate of cityData.candidates) {
      restoreAlias.run(candidate.aliasKey, candidate.id);
    }

    const upsertCarrier = database.prepare(`
      INSERT INTO carriers(source_key, name, name_key, legal_address, address_key, legal_city_id, match_status, match_candidates, contacts, search_text, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'carrier_workbook')
      ON CONFLICT(source_key) DO UPDATE SET
        name = excluded.name,
        name_key = excluded.name_key,
        legal_address = excluded.legal_address,
        address_key = excluded.address_key,
        legal_city_id = excluded.legal_city_id,
        match_status = excluded.match_status,
        match_candidates = excluded.match_candidates,
        contacts = excluded.contacts,
        search_text = excluded.search_text
    `);
    for (const carrier of carriers.values()) {
      upsertCarrier.run(
        carrier.sourceKey,
        carrier.name,
        carrier.nameKey,
        carrier.legalAddress,
        carrier.addressKey,
        carrier.cityMatch.cityId,
        carrier.cityMatch.status,
        JSON.stringify(carrier.cityMatch.candidates.map(({ id, name, region }) => ({ id, name, region }))),
        JSON.stringify([...carrier.contacts]),
        normalize([...carrier.searchTerms].join(' ')),
      );
    }

    database.exec(`
      UPDATE carriers
      SET legal_city_id = (
          SELECT city_id FROM carrier_city_overrides
          WHERE carrier_city_overrides.source_key = carriers.source_key
        ),
        match_status = 'manual',
        match_candidates = '[]',
        search_text = search_text || ' '
          || COALESCE((SELECT name || ' ' || region FROM cities
            WHERE cities.id = (SELECT city_id FROM carrier_city_overrides
              WHERE carrier_city_overrides.source_key = carriers.source_key)), '')
      WHERE source_key IN (SELECT source_key FROM carrier_city_overrides)
    `);

    database.exec(`
      DELETE FROM cities
      WHERE source = 'city_directory'
        AND NOT EXISTS (SELECT 1 FROM city_aliases WHERE city_aliases.city_id = cities.id)
        AND NOT EXISTS (SELECT 1 FROM carriers WHERE carriers.legal_city_id = cities.id)
        AND NOT EXISTS (SELECT 1 FROM carrier_city_overrides WHERE carrier_city_overrides.city_id = cities.id)
    `);

    const carrierIds = new Map(database.prepare('SELECT id, source_key FROM carriers').all()
      .map((carrier) => [carrier.source_key, carrier.id]));
    const upsertShipment = database.prepare(`
      INSERT INTO shipments(source_key, carrier_id, loaded_on, origin, origin_key, origin_region, origin_region_key, destination, destination_key, destination_region, destination_region_key, contact, driver, vehicle, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'carrier_workbook')
      ON CONFLICT(source_key) DO UPDATE SET
        carrier_id = excluded.carrier_id,
        loaded_on = excluded.loaded_on,
        origin = excluded.origin,
        origin_key = excluded.origin_key,
        origin_region = excluded.origin_region,
        origin_region_key = excluded.origin_region_key,
        destination = excluded.destination,
        destination_key = excluded.destination_key,
        destination_region = excluded.destination_region,
        destination_region_key = excluded.destination_region_key,
        contact = excluded.contact,
        driver = excluded.driver,
        vehicle = excluded.vehicle
    `);
    for (const shipment of shipments) {
      upsertShipment.run(
        shipment.sourceKey,
        carrierIds.get(shipment.carrierKey),
        shipment.loadedOn,
        shipment.origin,
        shipment.originKey,
        shipment.originRegion,
        shipment.originRegionKey,
        shipment.destination,
        shipment.destinationKey,
        shipment.destinationRegion,
        shipment.destinationRegionKey,
        shipment.contact,
        shipment.driver,
        shipment.vehicle,
      );
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  const summary = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM cities) AS cities,
      (SELECT COUNT(*) FROM carriers) AS carriers,
      (SELECT COUNT(*) FROM shipments) AS shipments,
      (SELECT COUNT(*) FROM carriers WHERE match_status = 'matched') AS matched_carriers,
      (SELECT COUNT(*) FROM carriers WHERE match_status = 'ambiguous') AS ambiguous_carriers,
      (SELECT COUNT(*) FROM carriers WHERE match_status = 'unmatched') AS unmatched_carriers,
      (SELECT COUNT(*) FROM shipments WHERE contact != '') AS shipments_with_contact,
      (SELECT COUNT(*) FROM shipments WHERE vehicle != '') AS shipments_with_vehicle
  `).get();
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  importData();
  database.close();
}