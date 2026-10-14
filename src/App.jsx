import { useEffect, useRef, useState } from 'react';
import { Building2, CalendarDays, CircleHelp, MapPin, Phone, Search, Truck, X } from 'lucide-react';

const yandexApiKey = import.meta.env.VITE_YANDEX_MAPS_API_KEY;
let yandexMapsPromise;
const routePageSize = 100;

const starterCities = [
  { id: 'moscow', name: 'Москва', region: 'Москва', position: [55.7558, 37.6173] },
  { id: 'saint-petersburg', name: 'Санкт-Петербург', region: 'Санкт-Петербург', position: [59.9343, 30.3351] },
  { id: 'kazan', name: 'Казань', region: 'Республика Татарстан', position: [55.7961, 49.1064] },
  { id: 'yekaterinburg', name: 'Екатеринбург', region: 'Свердловская область', position: [56.8389, 60.6057] },
  { id: 'novosibirsk', name: 'Новосибирск', region: 'Новосибирская область', position: [55.0084, 82.9357] },
  { id: 'nizhny-novgorod', name: 'Нижний Новгород', region: 'Нижегородская область', position: [56.2965, 43.9361] },
  { id: 'samara', name: 'Самара', region: 'Самарская область', position: [53.1959, 50.1002] },
  { id: 'rostov-on-don', name: 'Ростов-на-Дону', region: 'Ростовская область', position: [47.2357, 39.7015] },
  { id: 'krasnodar', name: 'Краснодар', region: 'Краснодарский край', position: [45.0355, 38.9753] },
  { id: 'ufa', name: 'Уфа', region: 'Республика Башкортостан', position: [54.7388, 55.9721] },
  { id: 'chelyabinsk', name: 'Челябинск', region: 'Челябинская область', position: [55.1644, 61.4368] },
  { id: 'perm', name: 'Пермь', region: 'Пермский край', position: [58.0105, 56.2502] },
  { id: 'omsk', name: 'Омск', region: 'Омская область', position: [54.9885, 73.3242] },
  { id: 'tyumen', name: 'Тюмень', region: 'Тюменская область', position: [57.1522, 65.5272] },
  { id: 'vladivostok', name: 'Владивосток', region: 'Приморский край', position: [43.1155, 131.8855] },
];

function loadYandexMaps() {
  if (!yandexApiKey) {
    return Promise.reject(new Error('Не задан API-ключ Яндекс Карт.'));
  }
  if (window.ymaps) {
    return new Promise((resolve) => window.ymaps.ready(() => resolve(window.ymaps)));
  }
  if (!yandexMapsPromise) {
    yandexMapsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU`;
      script.async = true;
      script.onload = () => window.ymaps.ready(() => resolve(window.ymaps));
      script.onerror = () => {
        yandexMapsPromise = undefined;
        reject(new Error('Не удалось загрузить Яндекс Карты. Проверьте ключ и подключение к интернету.'));
      };
      document.head.appendChild(script);
    });
  }
  return yandexMapsPromise;
}

function CityMap({ cities, selectedCity, onSelect }) {
  const elementRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const selectedMarkerRef = useRef(null);
  const selectCityRef = useRef(onSelect);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  selectCityRef.current = onSelect;

  useEffect(() => {
    let isCancelled = false;
    let mapInstance;

    loadYandexMaps().then((ymaps) => {
      if (isCancelled) return;
      mapInstance = new ymaps.Map(elementRef.current, {
        center: [57.5, 65],
        zoom: 3,
        controls: ['zoomControl'],
      });
      mapRef.current = mapInstance;
      setIsReady(true);
    }).catch((error) => {
      if (!isCancelled) setLoadError(error.message);
    });

    return () => {
      isCancelled = true;
      markersRef.current.forEach((marker) => mapInstance?.geoObjects.remove(marker));
      if (selectedMarkerRef.current) mapInstance?.geoObjects.remove(selectedMarkerRef.current);
      mapInstance?.destroy();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ymaps = window.ymaps;
    const map = mapRef.current;
    if (!isReady || !ymaps || !map) return;

    markersRef.current.forEach((marker) => map.geoObjects.remove(marker));
    markersRef.current = cities.map((city) => {
      const marker = new ymaps.Placemark(city.position, {
        balloonContentHeader: city.name,
        balloonContentBody: city.region,
      }, {
        preset: selectedCity?.id === city.id ? 'islands#darkGreenCircleDotIcon' : 'islands#redCircleDotIcon',
      });
      marker.events.add('click', () => selectCityRef.current(city));
      map.geoObjects.add(marker);
      return marker;
    });
  }, [cities, isReady, selectedCity?.id]);

  useEffect(() => {
    const map = mapRef.current;
    const ymaps = window.ymaps;
    if (!isReady || !map || !ymaps || !selectedCity?.position) return;

    if (selectedMarkerRef.current) map.geoObjects.remove(selectedMarkerRef.current);
    selectedMarkerRef.current = new ymaps.Placemark(selectedCity.position, {
      balloonContentHeader: selectedCity.name,
      balloonContentBody: selectedCity.region,
    }, { preset: 'islands#darkGreenCircleDotIcon' });
    map.geoObjects.add(selectedMarkerRef.current);
    map.setCenter(selectedCity.position, Math.max(map.getZoom(), 7), { duration: 700 });
  }, [isReady, selectedCity]);

  return (
    <>
      <div ref={elementRef} className="map-canvas" />
      {!isReady && (
        <div className="map-message" role="status">
          {loadError || 'Загружаем Яндекс Карты…'}
        </div>
      )}
    </>
  );
}

function normalize(value) {
  return value.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}

export default function App() {
  const [fromQuery, setFromQuery] = useState('');
  const [toQuery, setToQuery] = useState('');
  const [addressQuery, setAddressQuery] = useState('');
  const [searchMode, setSearchMode] = useState('route');
  const [cities, setCities] = useState(starterCities);
  const [selectedCity, setSelectedCity] = useState(null);
  const [carrierResults, setCarrierResults] = useState([]);
  const [carrierTotal, setCarrierTotal] = useState(0);
  const [shipmentTotal, setShipmentTotal] = useState(0);
  const [carrierPage, setCarrierPage] = useState(1);
  const [hasRouteSearch, setHasRouteSearch] = useState(false);
  const [selectedCarrierId, setSelectedCarrierId] = useState(null);
  const [carrierDetail, setCarrierDetail] = useState(null);
  const [ratingDraft, setRatingDraft] = useState(3);
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [ratingState, setRatingState] = useState({ loading: false, error: '' });
  const [carrierSearchState, setCarrierSearchState] = useState({ loading: false, error: '' });
  const [manualCityQuery, setManualCityQuery] = useState('');
  const [manualCityOptions, setManualCityOptions] = useState([]);
  const [manualCityChoice, setManualCityChoice] = useState('');
  const [manualCityError, setManualCityError] = useState('');

  const resolveCity = async (city) => {
    if (city.position) return city;
    try {
      const ymaps = await loadYandexMaps();
      const result = await ymaps.geocode(`${city.name}, ${city.region}`, { results: 1, kind: 'locality' });
      const position = result.geoObjects.get(0)?.geometry.getCoordinates();
      return position ? { ...city, position } : city;
    } catch {
      return city;
    }
  };

  const selectCity = async (rawCity) => {
    const city = await resolveCity(rawCity);
    setSelectedCity(city);
    if (city.position) {
      setCities((current) => current.some((item) => String(item.id) === String(city.id))
        ? current
        : [...current, city]);
    }
  };

  const loadRoutePage = async (page) => {
    if (carrierSearchState.loading) return;
    setCarrierSearchState({ loading: true, error: '' });
    try {
      const params = new URLSearchParams({ limit: String(routePageSize), offset: String((page - 1) * routePageSize) });
      if (fromQuery.trim()) params.set('from', fromQuery.trim());
      if (toQuery.trim()) params.set('to', toQuery.trim());
      const response = await fetch(`/api/carrier-routes?${params}`);
      if (!response.ok) throw new Error('Не удалось загрузить страницу перевозчиков.');
      const data = await response.json();
      setCarrierResults(data.results);
      setCarrierTotal(data.total);
      setShipmentTotal(data.shipmentTotal);
      setCarrierPage(page);
      setCarrierSearchState({ loading: false, error: data.total ? '' : 'По этому запросу перевозчики не найдены.' });
    } catch (error) {
      setCarrierSearchState({ loading: false, error: error.message || 'Не удалось выполнить поиск.' });
    }
  };

  const loadHomePage = async (page) => {
    if (carrierSearchState.loading) return;
    setCarrierSearchState({ loading: true, error: '' });
    try {
      const params = new URLSearchParams({ q: addressQuery.trim(), limit: String(routePageSize), offset: String((page - 1) * routePageSize) });
      const response = await fetch(`/api/carrier-addresses?${params}`);
      if (!response.ok) throw new Error('Не удалось загрузить перевозчиков по юридическому адресу.');
      const data = await response.json();
      setCarrierResults(data.results);
      setCarrierTotal(data.total);
      setShipmentTotal(0);
      setCarrierPage(page);
      setCarrierSearchState({ loading: false, error: data.total ? '' : 'По юридическому адресу перевозчики не найдены.' });
    } catch (error) {
      setCarrierSearchState({ loading: false, error: error.message || 'Не удалось выполнить поиск по адресу.' });
    }
  };

  const searchRoutes = async (event) => {
    event.preventDefault();
    if ((!fromQuery.trim() && !toQuery.trim()) || carrierSearchState.loading) return;
    setSelectedCarrierId(null);
    setCarrierDetail(null);
    setCarrierResults([]);
    setCarrierTotal(0);
    setShipmentTotal(0);
    setCarrierPage(1);
    setSearchMode('route');
    setHasRouteSearch(true);
    await loadRoutePage(1);
  };

  const searchByAddress = async (event) => {
    event.preventDefault();
    if (!addressQuery.trim() || carrierSearchState.loading) return;
    setSelectedCarrierId(null);
    setCarrierDetail(null);
    setCarrierResults([]);
    setCarrierTotal(0);
    setShipmentTotal(0);
    setCarrierPage(1);
    setSearchMode('home');
    setHasRouteSearch(true);
    await loadHomePage(1);
  };

  const loadCurrentPage = (page) => searchMode === 'home' ? loadHomePage(page) : loadRoutePage(page);

  const saveRouteRating = async (carrier) => {
    if (!fromQuery.trim() || !toQuery.trim()) {
      setRatingState({ loading: false, error: 'Для оценки заполните оба пункта маршрута.' });
      return;
    }
    setRatingState({ loading: true, error: '' });
    try {
      const response = await fetch(`/api/carriers/${carrier.id}/route-rating`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromQuery.trim(),
          to: toQuery.trim(),
          score: ratingDraft,
          feedback: feedbackDraft,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось сохранить рейтинг.');
      setCarrierResults((current) => current.map((item) => item.id === carrier.id
        ? { ...item, rating: { score: result.score, feedback: result.feedback } }
        : item));
      setRatingState({ loading: false, error: '' });
      await loadRoutePage(carrierPage);
    } catch (error) {
      setRatingState({ loading: false, error: error.message || 'Не удалось сохранить рейтинг.' });
    }
  };

  const saveHomeRating = async (carrier) => {
    setRatingState({ loading: true, error: '' });
    try {
      const response = await fetch(`/api/carriers/${carrier.id}/home-rating`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: ratingDraft, feedback: feedbackDraft }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось сохранить домашний рейтинг.');
      setCarrierResults((current) => current.map((item) => item.id === carrier.id
        ? { ...item, homeRating: { score: result.score, feedback: result.feedback } }
        : item));
      setRatingState({ loading: false, error: '' });
      await loadHomePage(carrierPage);
    } catch (error) {
      setRatingState({ loading: false, error: error.message || 'Не удалось сохранить домашний рейтинг.' });
    }
  };

  const toggleCarrier = async (carrier) => {
    if (selectedCarrierId === carrier.id) {
      setSelectedCarrierId(null);
      setCarrierDetail(null);
      return;
    }
    setSelectedCarrierId(carrier.id);
    setCarrierDetail(null);
    const currentRating = searchMode === 'home' ? carrier.homeRating : carrier.rating;
    setRatingDraft(currentRating?.score ?? 3);
    setFeedbackDraft(currentRating?.feedback ?? '');
    setRatingState({ loading: false, error: '' });
    setManualCityQuery('');
    setManualCityOptions([]);
    setManualCityChoice('');
    setManualCityError('');
    try {
      const response = await fetch(`/api/carriers/${carrier.id}`);
      if (!response.ok) throw new Error('Не удалось загрузить карточку перевозчика.');
      const detail = await response.json();
      setCarrierDetail(detail);
      if (detail.city && detail.region) {
        const city = await resolveCity({ id: `carrier-city-${carrier.id}`, name: detail.city, region: detail.region });
        setSelectedCity(city);
        if (city.position) {
          setCities((current) => current.some((item) => String(item.id) === String(city.id))
            ? current
            : [...current, city]);
        }
      }
    } catch (detailError) {
      setCarrierSearchState({ loading: false, error: detailError.message || 'Не удалось загрузить карточку.' });
    }
  };

  const searchManualCity = async (event) => {
    event.preventDefault();
    if (!manualCityQuery.trim()) return;
    setManualCityError('');
    try {
      const response = await fetch(`/api/cities?q=${encodeURIComponent(manualCityQuery.trim())}`);
      if (!response.ok) throw new Error('Не удалось найти город в справочнике.');
      const options = await response.json();
      setManualCityOptions(options);
      if (!options.length) setManualCityError('Город или регион не найден.');
    } catch (searchError) {
      setManualCityError(searchError.message || 'Не удалось выполнить поиск города.');
    }
  };

  const saveManualCity = async () => {
    if (!carrierDetail || !manualCityChoice) return;
    setManualCityError('');
    try {
      const response = await fetch(`/api/carriers/${carrierDetail.id}/city`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cityId: Number(manualCityChoice) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось сохранить привязку.');
      const refreshed = await fetch(`/api/carriers/${carrierDetail.id}`).then((item) => item.json());
      setCarrierDetail(refreshed);
      setCarrierResults((current) => current.map((carrier) => carrier.id === refreshed.id
        ? { ...carrier, city: refreshed.city, region: refreshed.region, matchStatus: 'manual' }
        : carrier));
      const city = await resolveCity({ id: result.cityId, name: result.city, region: result.region });
      if (city.position) {
        setSelectedCity(city);
        setCities((current) => current.some((item) => String(item.id) === String(city.id))
          ? current
          : [...current, city]);
      }
      setManualCityQuery('');
      setManualCityOptions([]);
      setManualCityChoice('');
    } catch (saveError) {
      setManualCityError(saveError.message || 'Не удалось сохранить привязку.');
    }
  };

  const clearRouteSearch = () => {
    setFromQuery('');
    setToQuery('');
    setCarrierResults([]);
    setCarrierTotal(0);
    setShipmentTotal(0);
    setHasRouteSearch(false);
    setCarrierDetail(null);
    setSelectedCarrierId(null);
    setCarrierSearchState({ loading: false, error: '' });
  };

  const updateRouteQuery = (setter, value) => {
    setter(value);
    setCarrierResults([]);
    setCarrierTotal(0);
    setShipmentTotal(0);
    setHasRouteSearch(false);
    setSelectedCarrierId(null);
    setCarrierDetail(null);
    setCarrierSearchState({ loading: false, error: '' });
  };

  const updateAddressQuery = (value) => {
    setAddressQuery(value);
    setCarrierResults([]);
    setCarrierTotal(0);
    setShipmentTotal(0);
    setCarrierPage(1);
    setHasRouteSearch(false);
    setSelectedCarrierId(null);
    setCarrierDetail(null);
    setCarrierSearchState({ loading: false, error: '' });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#map" aria-label="Карта перевозчиков">
          <span className="brand-mark"><Truck size={19} strokeWidth={2.1} /></span>
          <span className="brand-name">Путь<span>.</span></span>
        </a>
        <div className="topbar-divider" />
        <span className="topbar-section">Поиск маршрута</span>
        <form className="route-search" onSubmit={searchRoutes}>
          <label className="route-field" htmlFor="route-from">
            <span>ОТКУДА</span>
            <input id="route-from" autoComplete="off" placeholder="Город или область, например Казань" value={fromQuery} onChange={(event) => updateRouteQuery(setFromQuery, event.target.value)} />
            {fromQuery && <button className="route-clear" type="button" onClick={() => updateRouteQuery(setFromQuery, '')} aria-label="Очистить пункт отправления"><X size={14} /></button>}
          </label>
          <label className="route-field" htmlFor="route-to">
            <span>КУДА</span>
            <input id="route-to" autoComplete="off" placeholder="Город или область, например Краснодар" value={toQuery} onChange={(event) => updateRouteQuery(setToQuery, event.target.value)} />
            {toQuery && <button className="route-clear" type="button" onClick={() => updateRouteQuery(setToQuery, '')} aria-label="Очистить пункт назначения"><X size={14} /></button>}
          </label>
          <button className="route-submit" type="submit" disabled={(!fromQuery.trim() && !toQuery.trim()) || carrierSearchState.loading} aria-label="Найти перевозчиков" title="Найти перевозчиков">
            {carrierSearchState.loading ? <span className="spinner" /> : <Search size={18} />}
          </button>
          {(fromQuery || toQuery) && <button className="route-reset" type="button" onClick={clearRouteSearch}>Сбросить</button>}
        </form>
        <form className="address-search" onSubmit={searchByAddress}>
          <label className="address-search-label" htmlFor="legal-address-search">ПО ЮРИДИЧЕСКОМУ АДРЕСУ</label>
          <div className="address-search-field">
            <input
              id="legal-address-search"
              autoComplete="off"
              placeholder="Город или регион перевозчика"
              value={addressQuery}
              onChange={(event) => updateAddressQuery(event.target.value)}
            />
            {addressQuery && <button className="route-clear" type="button" onClick={() => updateAddressQuery('')} aria-label="Очистить поиск по адресу"><X size={14} /></button>}
            <button className="address-search-submit" type="submit" disabled={!addressQuery.trim() || carrierSearchState.loading} aria-label="Искать по юридическому адресу">
              {carrierSearchState.loading ? <span className="spinner" /> : <Search size={17} />}
            </button>
          </div>
        </form>
        <div className="topbar-spacer" />
        <span className="map-credit"><span className="status-dot" /> Карта обновлена</span>
        <button className="help-button" type="button" aria-label="Справка" title="Справка">
          <CircleHelp size={19} strokeWidth={1.8} />
        </button>
      </header>

      <div className="workspace" id="map">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <div className="eyebrow"><span />{searchMode === 'home' ? ' РЕЗУЛЬТАТЫ ПО ЮР. АДРЕСУ' : ' РЕЗУЛЬТАТЫ МАРШРУТА'}</div>
            <h1>Подходящие<br />перевозчики</h1>
            <p className="intro">{searchMode === 'home' ? 'Перевозчики по месту регистрации.' : 'Совпадение проверяется по истории одного рейса.'}</p>
          </div>

          {carrierSearchState.error && <p className="search-error route-search-error" role="alert">{carrierSearchState.error}</p>}

          {carrierResults.length > 0 && (
            <section className="result-section carrier-results-section">
              <div className="cities-heading">
                <h2>{searchMode === 'home' ? 'Перевозчики по адресу' : 'Перевозчики'} · {carrierTotal}</h2>
                <span className="city-count">{searchMode === 'home' ? 'Дом' : `${shipmentTotal} рейсов`}</span>
              </div>
              <p className="results-limit">Страница {carrierPage} из {Math.ceil(carrierTotal / routePageSize)}{searchMode === 'home' ? ' · рейтинг дома' : ` · ${shipmentTotal} рейсов`}</p>
              <div className="carrier-list" aria-label="Результаты поиска перевозчиков">
                {carrierResults.map((carrier) => (
                  <article className={`carrier-result${selectedCarrierId === carrier.id ? ' carrier-result--active' : ''}`} key={carrier.id}>
                    <button className="carrier-result-button" type="button" onClick={() => toggleCarrier(carrier)} aria-expanded={selectedCarrierId === carrier.id}>
                      <span className="carrier-result-icon"><Building2 size={16} strokeWidth={1.8} /></span>
                      <span className="carrier-result-copy">
                        <span className="carrier-result-name">{carrier.name}</span>
                        <span className="carrier-result-route">{searchMode === 'home' ? carrier.legalAddress || 'Юридический адрес не указан' : `${carrier.matchedShipmentCount} совпавших рейсов · ${carrier.city || 'город не определён'}`}</span>
                      </span>
                        <span className={`carrier-rating-badge carrier-rating-badge--${(searchMode === 'home' ? carrier.homeRating?.score : carrier.rating?.score) ?? 3}`} title={searchMode === 'home' ? 'Рейтинг дома' : 'Рейтинг направления'}>{(searchMode === 'home' ? carrier.homeRating?.score : carrier.rating?.score) ?? 3}</span>
                      <span className="city-arrow">{selectedCarrierId === carrier.id ? '−' : '+'}</span>
                    </button>
                    <div className="carrier-contact-grid">
                      <span>Контактные лица</span>
                      <span>{carrier.contacts.join(', ') || '\u00a0'}</span>
                      <span>Номер телефона</span>
                      <span>{carrier.phone || '\u00a0'}</span>
                    </div>
                    {selectedCarrierId === carrier.id && (
                      <div className="carrier-detail">
                        {!carrierDetail ? <span className="detail-loading">Загружаем карточку…</span> : (
                          <>
                            <section className="rating-editor" aria-label={searchMode === 'home' ? 'Домашний рейтинг перевозчика' : 'Рейтинг перевозчика по направлению'}>
                              <div className="rating-editor-heading">
                                <strong>{searchMode === 'home' ? 'Рейтинг дома' : 'Рейтинг направления'}</strong>
                                <span className={`carrier-rating-badge carrier-rating-badge--${ratingDraft}`}>{ratingDraft}</span>
                              </div>
                              <div className="rating-scale" role="radiogroup" aria-label="Оценка от 1 до 10">
                                {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
                                  <button
                                    className={`rating-option rating-option--${score}${ratingDraft === score ? ' rating-option--selected' : ''}`}
                                    key={score}
                                    type="button"
                                    role="radio"
                                    aria-checked={ratingDraft === score}
                                    onClick={() => setRatingDraft(score)}
                                  >
                                    {score}
                                  </button>
                                ))}
                              </div>
                              <label className="rating-feedback-label">
                                Обратная связь
                                <textarea maxLength={1000} rows={2} value={feedbackDraft} onChange={(event) => setFeedbackDraft(event.target.value)} placeholder={searchMode === 'home' ? 'Комментарий о перевозчике и базе' : 'Комментарий по этому направлению'} />
                              </label>
                              <button className="rating-save" type="button" onClick={() => searchMode === 'home' ? saveHomeRating(carrier) : saveRouteRating(carrier)} disabled={ratingState.loading}>
                                {ratingState.loading ? 'Сохраняем…' : 'Сохранить оценку'}
                              </button>
                              {ratingState.error && <p className="search-error" role="alert">{ratingState.error}</p>}
                            </section>
                            <p className="detail-field"><strong>Юридический адрес</strong><span>{carrierDetail.legalAddress || 'Не указан в таблице'}</span></p>
                            <p className="detail-field"><strong>Привязка</strong><span>{carrierDetail.city ? `${carrierDetail.city}, ${carrierDetail.region}` : carrierDetail.matchStatus === 'ambiguous' ? `Требует проверки: ${carrierDetail.matchCandidates.map((item) => `${item.name} (${item.region})`).join('; ')}` : 'Город не найден по адресу'}</span></p>
                            {!carrierDetail.city && (
                              <div className="manual-city">
                                <form className="manual-city-search" onSubmit={searchManualCity}>
                                  <input
                                    aria-label="Найти город для привязки перевозчика"
                                    placeholder="Уточнить город из справочника"
                                    value={manualCityQuery}
                                    onChange={(event) => {
                                      setManualCityQuery(event.target.value);
                                      setManualCityOptions([]);
                                      setManualCityChoice('');
                                      setManualCityError('');
                                    }}
                                  />
                                  <button type="submit" disabled={!manualCityQuery.trim()} aria-label="Искать город"><Search size={15} /></button>
                                </form>
                                {carrierDetail.matchCandidates.length > 0 && (
                                  <div className="manual-city-options">
                                    <span className="manual-city-label">Возможный город из адреса</span>
                                    {carrierDetail.matchCandidates.map((candidate) => (
                                      <button
                                        className={manualCityChoice === String(candidate.id) ? 'manual-city-option manual-city-option--active' : 'manual-city-option'}
                                        key={candidate.id}
                                        type="button"
                                        onClick={() => setManualCityChoice(String(candidate.id))}
                                      >
                                        {candidate.name} · {candidate.region}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {manualCityOptions.length > 0 && (
                                  <select aria-label="Результаты справочника городов" value={manualCityChoice} onChange={(event) => setManualCityChoice(event.target.value)}>
                                    <option value="">Выберите город и регион</option>
                                    {manualCityOptions.map((city) => <option key={city.id} value={city.id}>{city.name} · {city.region}</option>)}
                                  </select>
                                )}
                                {manualCityChoice && <button className="manual-city-save" type="button" onClick={saveManualCity}>Сохранить привязку</button>}
                                {manualCityError && <span className="search-error" role="alert">{manualCityError}</span>}
                              </div>
                            )}
                            <p className="detail-contact"><Phone size={14} /><strong>Номер телефона</strong><span>{carrierDetail.phone || '\u00a0'}</span></p>
                            <p className="detail-contact"><Building2 size={14} /><strong>Контактные лица</strong><span>{carrierDetail.contacts.join(', ') || '\u00a0'}</span></p>
                            <div className="shipment-heading"><CalendarDays size={14} /><strong>История перевозок · {carrierDetail.shipments.length}</strong></div>
                            <div className="shipment-list">
                              {carrierDetail.shipments.slice(0, 20).map((shipment, index) => (
                                <div className="shipment-row" key={`${shipment.date}-${shipment.origin}-${index}`}>
                                  <span className="shipment-date">{shipment.date || 'Дата не указана'}</span>
                                  <span className="shipment-route">{shipment.origin || '—'} <span>→</span> {shipment.destination || '—'}</span>
                                  <span className="shipment-meta">{shipment.originRegion}{shipment.destinationRegion ? ` · ${shipment.destinationRegion}` : ''}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
              {carrierTotal > routePageSize && (
                <nav className="route-pagination" aria-label="Страницы списка перевозчиков">
                  <button type="button" onClick={() => loadCurrentPage(carrierPage - 1)} disabled={carrierPage <= 1 || carrierSearchState.loading}>Назад</button>
                  <span>{carrierSearchState.loading ? 'Загрузка…' : `${carrierPage} / ${Math.ceil(carrierTotal / routePageSize)}`}</span>
                  <button type="button" onClick={() => loadCurrentPage(carrierPage + 1)} disabled={carrierPage >= Math.ceil(carrierTotal / routePageSize) || carrierSearchState.loading}>Далее</button>
                </nav>
              )}
            </section>
          )}

          {hasRouteSearch && carrierResults.length === 0 && !carrierSearchState.loading && !carrierSearchState.error && (
            <div className="empty-search">
              <span>{searchMode === 'home' ? 'Перевозчики по юридическому адресу не найдены.' : 'Нет перевозчиков по заданному маршруту.'}</span>
              <span>{searchMode === 'home' ? 'Попробуйте часть названия города или региона.' : 'Проверьте оба пункта или попробуйте неполное название города/региона.'}</span>
            </div>
          )}

          <div className="sidebar-footer">
            <div className="footer-icon"><Truck size={17} strokeWidth={1.8} /></div>
            <div>
              <span className="footer-title">База перевозчиков</span>
              <p>{searchMode === 'home' ? 'Рейтинг дома не зависит от оценок направлений.' : 'Рейтинг направления не зависит от домашней оценки.'}</p>
            </div>
          </div>
        </aside>

        <section className="map-stage" aria-label="Интерактивная карта городов России">
          <CityMap cities={cities} selectedCity={selectedCity} onSelect={selectCity} />
          <div className="map-overlay map-overlay--top">
            <div className="map-location">
              <span className="map-location-icon"><MapPin size={16} /></span>
              <span>{selectedCity ? selectedCity.name : 'Россия'}</span>
              <span className="map-location-separator">/</span>
              <span className="map-location-muted">{selectedCity ? selectedCity.region : 'все города'}</span>
            </div>
          </div>
          <div className="map-overlay map-overlay--bottom">
            <span><span className="legend-dot" /> {cities.length} городов на карте</span>
            <span className="map-scale">Яндекс Карты</span>
          </div>
        </section>
      </div>
    </main>
  );
}