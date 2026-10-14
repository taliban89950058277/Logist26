import express from 'express';
import { database } from './db.js';

const app = express();
const port = Number(process.env.PORT || process.env.API_PORT || 3001);
const distPath = path.resolve(projectRoot, 'dist');
app.use(express.json({ limit: '16kb' }));

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(path.join(distPath, 'index.html'));
  });
}

const normalize = (value) => String(value ?? '')
  .toLocaleUpperCase('ru-RU')
  .replaceAll('Ё', 'Е')
  .replace(/[^0-9A-ZА-Я]+/g, ' ')
  .replace(/(^| )ОБЛ(?= |$)/g, '$1ОБЛАСТЬ')
  .replace(/(^| )РЕСП(?= |$)/g, '$1РЕСПУБЛИКА')
  .trim();
const tokensFor = (value) => [...new Set(normalize(value).split(' ').filter(Boolean))];

function routeSideCondition(tokens, cityColumn, regionColumn) {
  return {
    sql: tokens.map(() => `(instr(${cityColumn}, ?) > 0 OR instr(${regionColumn}, ?) > 0)`).join(' AND '),
    params: tokens.flatMap((token) => [token, token]),
  };
}

app.get('/api/health', (_request, response) => {
  const counts = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM cities) AS cities,
      (SELECT COUNT(*) FROM carriers) AS carriers,
      (SELECT COUNT(*) FROM shipments) AS shipments
  `).get();
  response.json(counts);
});

app.get('/api/cities', (request, response) => {
  const tokens = tokensFor(request.query.q);
  if (!tokens.length) return response.json([]);

  const where = tokens.map(() => "instr(name_key || ' ' || region_key, ?) > 0").join(' AND ');
  const cities = database.prepare(`
    SELECT id, name, region
    FROM cities
    WHERE ${where}
    ORDER BY name_key, region_key
    LIMIT 40
  `).all(...tokens);
  response.json(cities);
});

app.get('/api/carrier-routes', (request, response) => {
  const fromTokens = tokensFor(request.query.from);
  const toTokens = tokensFor(request.query.to);
  if (!fromTokens.length && !toTokens.length) return response.json({ results: [], total: 0 });

  const conditions = [];
  const parameters = [];
  if (fromTokens.length) {
    const from = routeSideCondition(fromTokens, 's.origin_key', 's.origin_region_key');
    conditions.push(from.sql);
    parameters.push(...from.params);
  }
  if (toTokens.length) {
    const to = routeSideCondition(toTokens, 's.destination_key', 's.destination_region_key');
    conditions.push(to.sql);
    parameters.push(...to.params);
  }

  const matchingShipment = conditions.join(' AND ');
  const routeExists = `EXISTS (SELECT 1 FROM shipments s WHERE s.carrier_id = carriers.id AND ${matchingShipment})`;
  const total = database.prepare(`SELECT COUNT(*) AS count FROM carriers WHERE ${routeExists}`).get(...parameters).count;
  const shipmentTotal = database.prepare(`SELECT COUNT(*) AS count FROM shipments s WHERE ${matchingShipment}`).get(...parameters).count;
  const limit = Math.max(1, Math.min(100, Number.parseInt(request.query.limit, 10) || 100));
  const offset = Math.max(0, Number.parseInt(request.query.offset, 10) || 0);
  const results = database.prepare(`
    SELECT
      carriers.id,
      carriers.name,
      carriers.legal_address AS legalAddress,
      carriers.contacts,
      carriers.phone,
      cities.name AS city,
      cities.region,
      (SELECT COUNT(*) FROM shipments s
        WHERE s.carrier_id = carriers.id AND ${matchingShipment}) AS matchedShipmentCount,
      COALESCE((
        SELECT AVG(rating.score)
        FROM carrier_route_ratings rating
        WHERE rating.carrier_id = carriers.id
          AND EXISTS (
            SELECT 1 FROM shipments s
            WHERE s.carrier_id = rating.carrier_id
              AND COALESCE(NULLIF(s.origin_region_key, ''), s.origin_key) = rating.origin_region_key
              AND COALESCE(NULLIF(s.destination_region_key, ''), s.destination_key) = rating.destination_region_key
              AND ${matchingShipment}
          )
      ), 3) AS routeRatingScore
    FROM carriers
    LEFT JOIN cities ON cities.id = carriers.legal_city_id
    WHERE ${routeExists}
    ORDER BY routeRatingScore DESC, carriers.name_key
    LIMIT ? OFFSET ?
  `).all(...parameters, ...parameters, ...parameters, limit, offset).map((carrier) => ({
    ...carrier,
    contacts: JSON.parse(carrier.contacts),
  }));

  const ratings = results.length ? database.prepare(`
    SELECT
      rating.carrier_id AS carrierId,
      CAST(ROUND(AVG(rating.score)) AS INTEGER) AS score,
      GROUP_CONCAT(DISTINCT NULLIF(rating.feedback, '')) AS feedback
    FROM carrier_route_ratings rating
    WHERE rating.carrier_id IN (${results.map(() => '?').join(',')})
      AND EXISTS (
        SELECT 1 FROM shipments s
        WHERE s.carrier_id = rating.carrier_id
          AND COALESCE(NULLIF(s.origin_region_key, ''), s.origin_key) = rating.origin_region_key
          AND COALESCE(NULLIF(s.destination_region_key, ''), s.destination_key) = rating.destination_region_key
          AND ${matchingShipment}
      )
    GROUP BY rating.carrier_id
  `).all(...results.map((carrier) => carrier.id), ...parameters) : [];
  const ratingsByCarrier = new Map(ratings.map((rating) => [rating.carrierId, rating]));

  response.json({
    results: results.map((carrier) => ({ ...carrier, rating: ratingsByCarrier.get(carrier.id) ?? null })),
    total,
    shipmentTotal,
    limit,
    offset,
  });
});

app.get('/api/carrier-addresses', (request, response) => {
  const tokens = tokensFor(request.query.q);
  if (!tokens.length) return response.json({ results: [], total: 0, limit: 100, offset: 0 });

  const where = tokens.map(() => 'instr(carriers.address_key, ?) > 0').join(' AND ');
  const total = database.prepare(`SELECT COUNT(*) AS count FROM carriers WHERE ${where}`).get(...tokens).count;
  const limit = Math.max(1, Math.min(100, Number.parseInt(request.query.limit, 10) || 100));
  const offset = Math.max(0, Number.parseInt(request.query.offset, 10) || 0);
  const results = database.prepare(`
    SELECT
      carriers.id,
      carriers.name,
      carriers.legal_address AS legalAddress,
      carriers.contacts,
      carriers.phone,
      cities.name AS city,
      cities.region,
      (SELECT COUNT(*) FROM shipments WHERE shipments.carrier_id = carriers.id) AS shipmentCount,
      carrier_home_ratings.score AS homeRatingScore,
      carrier_home_ratings.feedback AS homeRatingFeedback
    FROM carriers
    LEFT JOIN cities ON cities.id = carriers.legal_city_id
    LEFT JOIN carrier_home_ratings ON carrier_home_ratings.carrier_id = carriers.id
    WHERE ${where}
    ORDER BY COALESCE(carrier_home_ratings.score, 3) DESC, carriers.name_key
    LIMIT ? OFFSET ?
  `).all(...tokens, limit, offset).map((carrier) => ({
    ...carrier,
    contacts: JSON.parse(carrier.contacts),
    homeRating: carrier.homeRatingScore === null ? null : {
      score: carrier.homeRatingScore,
      feedback: carrier.homeRatingFeedback,
    },
  }));

  response.json({ results, total, limit, offset });
});

app.put('/api/carriers/:id/route-rating', (request, response) => {
  const carrierId = Number(request.params.id);
  const score = Number(request.body?.score);
  const feedback = String(request.body?.feedback ?? '').trim().slice(0, 1000);
  const fromTokens = tokensFor(request.body?.from);
  const toTokens = tokensFor(request.body?.to);
  if (!Number.isInteger(carrierId) || !Number.isInteger(score) || score < 1 || score > 10) {
    return response.status(400).json({ error: 'Оценка должна быть целым числом от 1 до 10.' });
  }
  if (!fromTokens.length || !toTokens.length) {
    return response.status(400).json({ error: 'Для оценки укажите оба пункта направления.' });
  }

  const carrier = database.prepare('SELECT id FROM carriers WHERE id = ?').get(carrierId);
  if (!carrier) return response.status(404).json({ error: 'Перевозчик не найден.' });
  const from = routeSideCondition(fromTokens, 's.origin_key', 's.origin_region_key');
  const to = routeSideCondition(toTokens, 's.destination_key', 's.destination_region_key');
  const lanes = database.prepare(`
    SELECT DISTINCT
      COALESCE(NULLIF(s.origin_region_key, ''), s.origin_key) AS originRegionKey,
      COALESCE(NULLIF(s.destination_region_key, ''), s.destination_key) AS destinationRegionKey
    FROM shipments s
    WHERE s.carrier_id = ? AND ${from.sql} AND ${to.sql}
  `).all(carrierId, ...from.params, ...to.params);
  if (!lanes.length) return response.status(404).json({ error: 'По этому направлению рейсы перевозчика не найдены.' });

  const saveRating = database.prepare(`
    INSERT INTO carrier_route_ratings(carrier_id, origin_region_key, destination_region_key, score, feedback, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(carrier_id, origin_region_key, destination_region_key) DO UPDATE SET
      score = excluded.score,
      feedback = excluded.feedback,
      updated_at = CURRENT_TIMESTAMP
  `);
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const lane of lanes) saveRating.run(carrierId, lane.originRegionKey, lane.destinationRegionKey, score, feedback);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  response.json({ score, feedback, updatedLanes: lanes.length });
});

app.put('/api/carriers/:id/home-rating', (request, response) => {
  const carrierId = Number(request.params.id);
  const score = Number(request.body?.score);
  const feedback = String(request.body?.feedback ?? '').trim().slice(0, 1000);
  if (!Number.isInteger(carrierId) || !Number.isInteger(score) || score < 1 || score > 10) {
    return response.status(400).json({ error: 'Оценка должна быть целым числом от 1 до 10.' });
  }
  const carrier = database.prepare('SELECT id FROM carriers WHERE id = ?').get(carrierId);
  if (!carrier) return response.status(404).json({ error: 'Перевозчик не найден.' });
  database.prepare(`
    INSERT INTO carrier_home_ratings(carrier_id, score, feedback, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(carrier_id) DO UPDATE SET
      score = excluded.score,
      feedback = excluded.feedback,
      updated_at = CURRENT_TIMESTAMP
  `).run(carrierId, score, feedback);
  response.json({ carrierId, score, feedback });
});

app.get('/api/carriers', (request, response) => {
  const tokens = tokensFor(request.query.q);
  if (!tokens.length) return response.json({ results: [], total: 0 });

  const where = tokens.map((_) => 'instr(search_text, ?) > 0').join(' AND ');
  const total = database.prepare(`SELECT COUNT(*) AS count FROM carriers WHERE ${where}`).get(...tokens).count;
  const results = database.prepare(`
    SELECT
      carriers.id,
      carriers.name,
      carriers.legal_address AS legalAddress,
      carriers.match_status AS matchStatus,
      carriers.match_candidates AS matchCandidates,
      carriers.contacts,
      carriers.phone,
      cities.name AS city,
      cities.region,
      (SELECT COUNT(*) FROM shipments WHERE shipments.carrier_id = carriers.id) AS shipmentCount
    FROM carriers
    LEFT JOIN cities ON cities.id = carriers.legal_city_id
    WHERE ${where}
    ORDER BY carriers.name_key
    LIMIT 40
  `).all(...tokens).map((carrier) => ({
    ...carrier,
    contacts: JSON.parse(carrier.contacts),
    matchCandidates: JSON.parse(carrier.matchCandidates),
  }));

  response.json({ results, total });
});

app.get('/api/carriers/:id', (request, response) => {
  const carrier = database.prepare(`
    SELECT
      carriers.id,
      carriers.name,
      carriers.legal_address AS legalAddress,
      carriers.match_status AS matchStatus,
      carriers.match_candidates AS matchCandidates,
      carriers.contacts,
      carriers.phone,
      cities.name AS city,
      cities.region
    FROM carriers
    LEFT JOIN cities ON cities.id = carriers.legal_city_id
    WHERE carriers.id = ?
  `).get(Number(request.params.id));

  if (!carrier) return response.status(404).json({ error: 'Перевозчик не найден.' });
  const shipments = database.prepare(`
    SELECT loaded_on AS date, origin, origin_region AS originRegion,
      destination, destination_region AS destinationRegion,
      contact, driver, vehicle
    FROM shipments
    WHERE carrier_id = ?
    ORDER BY loaded_on DESC, id DESC
  `).all(carrier.id);

  response.json({
    ...carrier,
    contacts: JSON.parse(carrier.contacts),
    matchCandidates: JSON.parse(carrier.matchCandidates),
    shipments,
  });
});

app.patch('/api/carriers/:id/city', (request, response) => {
  const carrierId = Number(request.params.id);
  const cityId = Number(request.body?.cityId);
  if (!Number.isInteger(carrierId) || !Number.isInteger(cityId)) {
    return response.status(400).json({ error: 'Нужны корректные идентификаторы перевозчика и города.' });
  }

  const carrier = database.prepare('SELECT id, source_key, search_text FROM carriers WHERE id = ?').get(carrierId);
  const city = database.prepare('SELECT id, name, region FROM cities WHERE id = ?').get(cityId);
  if (!carrier || !city) return response.status(404).json({ error: 'Перевозчик или город не найден.' });

  const updateCarrier = database.prepare(`
    UPDATE carriers
    SET legal_city_id = ?, match_status = 'manual', match_candidates = '[]',
      search_text = ?
    WHERE id = ?
  `);
  const saveOverride = database.prepare(`
    INSERT INTO carrier_city_overrides(source_key, city_id) VALUES (?, ?)
    ON CONFLICT(source_key) DO UPDATE SET city_id = excluded.city_id
  `);
  database.exec('BEGIN IMMEDIATE');
  try {
    updateCarrier.run(city.id, normalize(`${carrier.search_text} ${city.name} ${city.region}`), carrier.id);
    saveOverride.run(carrier.source_key, city.id);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  response.json({ cityId: city.id, city: city.name, region: city.region, matchStatus: 'manual' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Carrier API listening on ${port}`);
});