import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'dist', 'data', 'live.json');
const SHANGHAI = { name: '上海市', latitude: 31.2304, longitude: 121.4737 };
const HEADERS = {
  'user-agent': 'HaiAn-Shanghai-Weather/1.0 (+GitHub Pages; public safety dashboard)',
  accept: 'application/json,text/plain,*/*',
};

const GRID = [
  ['上海中心城区', 31.2304, 121.4737],
  ['上海北部', 31.55, 121.47],
  ['上海南部', 30.92, 121.47],
  ['上海东部', 31.23, 121.82],
  ['上海西部', 31.23, 121.12],
  ['上海东北部', 31.50, 121.76],
  ['上海西北部', 31.50, 121.18],
  ['上海东南部', 30.98, 121.76],
  ['上海西南部', 30.98, 121.18],
];

async function fetchText(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { ...HEADERS, ...options.headers },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  throw lastError;
}

async function fetchJson(url, options = {}) {
  return JSON.parse(await fetchText(url, options));
}

function parseJsonp(text) {
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');
  const start = [objectStart, arrayStart].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  const objectEnd = text.lastIndexOf('}');
  const arrayEnd = text.lastIndexOf(']');
  const end = Math.max(objectEnd, arrayEnd);
  if (start === undefined || end < start) throw new Error('无法解析 JSONP 响应');
  return JSON.parse(text.slice(start, end + 1));
}

function isoFromCompact(value) {
  if (!value || String(value).length < 12) return null;
  const text = String(value);
  const year = text.slice(0, 4);
  const month = text.slice(4, 6);
  const day = text.slice(6, 8);
  const hour = text.slice(8, 10);
  const minute = text.slice(10, 12);
  const second = text.slice(12, 14) || '00';
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function windScale(ms) {
  const thresholds = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7, 37, 41.5, 46.2, 51, 56.1, 61.3];
  const index = thresholds.findIndex((limit) => ms < limit);
  return index === -1 ? 18 : index;
}

function intensityLabel(mmPerHour) {
  if (mmPerHour < 0.1) return '无明显降雨';
  if (mmPerHour < 2.5) return '小雨';
  if (mmPerHour < 8) return '中雨';
  if (mmPerHour < 16) return '大雨';
  if (mmPerHour < 30) return '暴雨';
  return '强降雨';
}

function directionBetween(from, to) {
  const dLat = to[1] - from[1];
  const dLon = to[2] - from[2];
  if (Math.abs(dLat) < 0.05 && Math.abs(dLon) < 0.05) return '移动不明显';
  const angle = (Math.atan2(dLon, dLat) * 180) / Math.PI;
  const normalized = (angle + 360) % 360;
  const names = ['向北', '向东北', '向东', '向东南', '向南', '向西南', '向西', '向西北'];
  return names[Math.round(normalized / 45) % 8];
}

function normalizeWarning(item) {
  const level = String(item.level || '').replace('预警', '');
  const type = String(item.type || '气象灾害');
  const regionParts = [item.province, item.city, item.town].filter(Boolean);
  const region = [...new Set(regionParts)].join('');
  return {
    id: item.id || `${item.time || ''}-${region}-${type}-${level}`,
    type,
    level,
    region: region || '上海市',
    title: `${region || '上海市'}${type}${level}预警`,
    content: item.content || '',
    publishedAt: isoFromCompact(item.time),
    publisher: item.sender || item.publish || `${item.town || '上海市'}气象台`,
    icon: item.icon || null,
    sourceUrl: 'https://www.weather.com.cn/zhyj/',
  };
}

async function getWarnings() {
  const text = await fetchText('https://d1.weather.com.cn/shweather/alarm.json', {
    headers: { referer: 'https://www.weather.com.cn/zhyj/' },
  });
  const data = parseJsonp(text);
  return Array.isArray(data) ? data.map(normalizeWarning) : [];
}

function normalizeForecast(row) {
  return {
    leadHours: row[0],
    baseTime: isoFromCompact(row[1]),
    longitude: row[2],
    latitude: row[3],
    pressureHpa: row[4],
    windSpeedMs: row[5],
    agency: row[6],
    intensityCode: row[7],
  };
}

async function getTyphoons() {
  const headers = { referer: 'https://typhoon.nmc.cn/' };
  const listText = await fetchText('https://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default', { headers });
  const list = parseJsonp(listText).typhoonList || [];
  const active = list.filter((item) => String(item[7]).toLowerCase() !== 'stop');
  return Promise.all(active.map(async (item) => {
    const detailText = await fetchText(`https://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_${item[0]}`, { headers });
    const typhoon = parseJsonp(detailText).typhoon;
    const points = (typhoon?.[8] || []).map((point) => ({
      observedAt: isoFromCompact(point[1]),
      epochMs: point[2],
      intensityCode: point[3],
      longitude: point[4],
      latitude: point[5],
      pressureHpa: point[6],
      windSpeedMs: point[7],
      movementDirection: point[8],
      movementSpeedKmh: point[9],
      forecast: (point[11]?.BABJ || []).map(normalizeForecast),
    }));
    const latest = points.at(-1) || null;
    return {
      id: String(item[0]),
      number: String(item[3] || ''),
      nameEn: item[1],
      nameZh: item[2],
      status: item[7],
      latest: latest ? {
        ...latest,
        windScale: windScale(latest.windSpeedMs),
        distanceToShanghaiKm: Math.round(haversineKm(SHANGHAI.latitude, SHANGHAI.longitude, latest.latitude, latest.longitude)),
      } : null,
      track: points.map(({ forecast, ...point }) => point),
      forecast: latest?.forecast || [],
      sourceUrl: 'https://typhoon.nmc.cn/',
    };
  }));
}

function nearestPastIndex(times, targetMs) {
  let result = 0;
  times.forEach((value, index) => {
    if (new Date(value).getTime() <= targetMs) result = index;
  });
  return result;
}

async function getShanghaiWeather() {
  const latitudes = GRID.map((item) => item[1]).join(',');
  const longitudes = GRID.map((item) => item[2]).join(',');
  const query = new URLSearchParams({
    latitude: latitudes,
    longitude: longitudes,
    current: 'temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: 'precipitation,precipitation_probability',
    past_days: '1',
    forecast_days: '1',
    timezone: 'Asia/Shanghai',
  });
  const responses = await fetchJson(`https://api.open-meteo.com/v1/forecast?${query}`);
  const grids = (Array.isArray(responses) ? responses : [responses]).map((data, index) => {
    const interval = data.current?.interval || 900;
    const currentRate = Number(data.current?.precipitation || 0) * (3600 / interval);
    const currentTime = new Date(`${data.current.time}+08:00`).getTime();
    const currentHourlyIndex = nearestPastIndex(data.hourly.time, currentTime);
    const previousHourlyIndex = Math.max(0, currentHourlyIndex - 1);
    return {
      name: GRID[index][0], latitude: GRID[index][1], longitude: GRID[index][2],
      precipitationRateMmH: Number(currentRate.toFixed(1)),
      previousHourMm: Number(data.hourly.precipitation[previousHourlyIndex] || 0),
      currentHourMm: Number(data.hourly.precipitation[currentHourlyIndex] || 0),
      data,
    };
  });
  const currentCore = [...grids].sort((a, b) => b.precipitationRateMmH - a.precipitationRateMmH)[0];
  const previousCore = [...grids].sort((a, b) => b.previousHourMm - a.previousHourMm)[0];
  const center = grids[0];
  const hourlyIndex = nearestPastIndex(center.data.hourly.time, Date.now());
  const recentStart = Math.max(0, hourlyIndex - 5);
  const recent = center.data.hourly.time.slice(recentStart, hourlyIndex + 1).map((time, offset) => ({
    time: `${time}+08:00`,
    precipitationMm: center.data.hourly.precipitation[recentStart + offset],
    probabilityPercent: center.data.hourly.precipitation_probability[recentStart + offset],
  }));
  const rate = currentCore.precipitationRateMmH;
  return {
    observedAt: `${center.data.current.time}+08:00`,
    current: center.data.current,
    units: center.data.current_units,
    recentPrecipitation: recent,
    rainCore: {
      locationName: rate >= 0.1 ? currentCore.name : '上海全市暂无明显降雨核心',
      latitude: currentCore.latitude,
      longitude: currentCore.longitude,
      precipitationRateMmH: rate,
      intensity: intensityLabel(rate),
      movementDirection: rate >= 0.1 ? directionBetween(previousCore, currentCore) : '无明显移动',
      method: 'Open-Meteo 九点格点估算；移动方向仅作趋势参考',
    },
    sourceUrl: 'https://open-meteo.com/en/docs',
  };
}

async function getRadar() {
  const data = await fetchJson('https://api.rainviewer.com/public/weather-maps.json');
  const latest = data.radar?.past?.at(-1);
  if (!latest) throw new Error('RainViewer 未返回雷达帧');
  const observedAt = new Date(latest.time * 1000).toISOString();
  const chinaTime = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(latest.time * 1000)).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return {
    id: `RC-${chinaTime.year}${chinaTime.month}${chinaTime.day}${chinaTime.hour}${chinaTime.minute}`,
    idNote: '平台按雷达时次生成的监测编号，并非气象部门官方云团命名',
    observedAt,
    generatedAt: new Date(data.generated * 1000).toISOString(),
    tileUrl: `${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`,
    sourceUrl: 'https://www.rainviewer.com/api/weather-maps-api.html',
    attribution: 'Weather radar data by RainViewer',
  };
}

async function previousData() {
  try {
    return JSON.parse(await readFile(OUTPUT, 'utf8'));
  } catch {
    return {};
  }
}

async function settledSource(name, task, fallback) {
  try {
    return { value: await task(), health: { ok: true, updatedAt: new Date().toISOString() } };
  } catch (error) {
    return {
      value: fallback,
      health: { ok: false, updatedAt: new Date().toISOString(), error: String(error.message || error) },
    };
  }
}

const previous = await previousData();
const [warnings, typhoons, weather, radar] = await Promise.all([
  settledSource('warnings', getWarnings, previous.warnings || []),
  settledSource('typhoons', getTyphoons, previous.typhoons || []),
  settledSource('weather', getShanghaiWeather, previous.weather || null),
  settledSource('radar', getRadar, previous.radar || null),
]);

const output = {
  schemaVersion: 1,
  location: SHANGHAI,
  fetchedAt: new Date().toISOString(),
  refreshIntervalMinutes: 15,
  warnings: warnings.value,
  typhoons: typhoons.value,
  weather: weather.value,
  radar: radar.value,
  health: {
    warnings: warnings.health,
    typhoons: typhoons.health,
    weather: weather.health,
    radar: radar.health,
  },
  sources: [
    { name: '上海预警中心', url: 'https://www.weather.com.cn/zhyj/', role: '上海市及各区生效预警' },
    { name: '中央气象台台风网', url: 'https://typhoon.nmc.cn/', role: '活动台风实况与预报路径' },
    { name: 'RainViewer', url: 'https://www.rainviewer.com/api/weather-maps-api.html', role: '雷达拼图时次与地图图层' },
    { name: 'Open-Meteo', url: 'https://open-meteo.com/en/docs', role: '上海格点降水、风与温湿度' },
  ],
  notice: '本网站聚合公开气象数据，不是官方预警发布平台。预警信息以发布机构原文为准，紧急情况请遵从属地政府和主管部门指令。',
};

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

const failed = Object.entries(output.health).filter(([, status]) => !status.ok).map(([name]) => name);
console.log(`已更新 ${OUTPUT}${failed.length ? `；降级来源：${failed.join(', ')}` : '；全部来源正常'}`);
