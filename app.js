const DATA_URL = 'data/live.json';
const SHANGHAI = [31.2304, 121.4737];
const LEVEL_SCORE = { 蓝色: 25, 黄色: 45, 橙色: 70, 红色: 95 };
const toast = document.querySelector('#toast');
let toastTimer;
let liveData;
let map;
let radarLayer;
let typhoonGroup;

function announce(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function formatTime(value, includeDate = true) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: includeDate ? '2-digit' : undefined,
    day: includeDate ? '2-digit' : undefined,
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date).replace(/\//g, '-');
}

function relativeFreshness(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes <= 20) return { label: `${minutes} 分钟前`, stale: false };
  if (minutes < 120) return { label: `${minutes} 分钟前`, stale: true };
  return { label: '数据可能延迟', stale: true };
}

function directionArrow(direction = '') {
  if (direction.includes('东北') || direction.includes('NE')) return '↗';
  if (direction.includes('东南') || direction.includes('SE')) return '↘';
  if (direction.includes('西南') || direction.includes('SW')) return '↙';
  if (direction.includes('西北') || direction.includes('NW')) return '↖';
  if (direction.includes('东') || direction === 'E') return '→';
  if (direction.includes('西') || direction === 'W') return '←';
  if (direction.includes('南') || direction === 'S') return '↓';
  if (direction.includes('北') || direction === 'N') return '↑';
  return '·';
}

function compass(degrees) {
  if (!Number.isFinite(Number(degrees))) return '--';
  return ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(Number(degrees) / 45) % 8];
}

function calculateRisk(data) {
  const warning = Math.max(0, ...(data.warnings || []).map((item) => LEVEL_SCORE[item.level] || 20));
  const rain = Math.min(85, (data.weather?.rainCore?.precipitationRateMmH || 0) * 3);
  const gust = Math.min(75, Math.max(0, (data.weather?.current?.wind_gusts_10m || 0) - 25) * 1.5);
  const typhoon = (data.typhoons || []).reduce((score, item) => {
    const distance = item.latest?.distanceToShanghaiKm ?? Infinity;
    return Math.max(score, distance < 300 ? 80 : distance < 800 ? 55 : distance < 1500 ? 30 : 10);
  }, 0);
  return Math.round(Math.max(warning, rain, gust, typhoon));
}

function riskLabel(score) {
  if (score >= 80) return '高度关注，立即核对官方指令';
  if (score >= 55) return '风险较高，提前做好准备';
  if (score >= 30) return '保持关注，留意天气变化';
  return '当前风险较低，继续关注更新';
}

function renderHeader(data) {
  const freshness = relativeFreshness(data.fetchedAt);
  document.querySelector('#fetchedAt').textContent = formatTime(data.fetchedAt);
  const freshnessNode = document.querySelector('#freshness');
  freshnessNode.textContent = freshness.label;
  freshnessNode.classList.toggle('stale', freshness.stale);
  document.querySelector('#serviceNotice').textContent = data.notice;
  const failed = Object.values(data.health || {}).filter((item) => !item.ok).length;
  const healthTag = document.querySelector('#healthTag');
  healthTag.textContent = failed ? `${failed} SOURCE DEGRADED` : 'ALL SOURCES ONLINE';
  healthTag.classList.toggle('degraded', Boolean(failed));
  const score = calculateRisk(data);
  document.querySelector('#riskScore').textContent = score;
  document.querySelector('#riskText').textContent = riskLabel(score);
  document.querySelector('#riskRing').style.background = `radial-gradient(circle at center,#102733 59%,transparent 61%),conic-gradient(#69d9bc 0 ${score}%,#253c45 ${score}%)`;
}

function renderTyphoon(data) {
  const node = {
    state: document.querySelector('#typhoonState'), name: document.querySelector('#typhoonName'),
    arrow: document.querySelector('#typhoonArrow'), distance: document.querySelector('#typhoonDistance'),
    summary: document.querySelector('#typhoonSummary'), map: document.querySelector('#typhoonMapStatus'),
  };
  const typhoon = data.typhoons?.[0];
  if (!typhoon?.latest) {
    node.state.textContent = '当前无活动台风';
    node.state.className = 'level-pill safe';
    node.name.textContent = '中央气象台当前无活动台风';
    node.arrow.textContent = '·';
    node.distance.textContent = '';
    node.summary.textContent = '系统仍按 15 分钟频率检查更新';
    node.map.textContent = '当前无活动台风路径';
    return;
  }
  const latest = typhoon.latest;
  node.state.textContent = latest.intensityCode || '活动中';
  node.state.className = 'level-pill orange';
  node.name.textContent = `${typhoon.number}号 ${typhoon.nameZh || typhoon.nameEn}`;
  node.arrow.textContent = directionArrow(latest.movementDirection);
  node.distance.textContent = `距上海约 ${latest.distanceToShanghaiKm} km`;
  node.summary.textContent = `${latest.movementDirection || '移动方向待更新'} ${latest.movementSpeedKmh || '--'} km/h · 中心风力 ${latest.windScale} 级`;
  node.map.textContent = `${typhoon.nameZh || typhoon.nameEn} · ${formatTime(latest.observedAt)}`;
}

function renderRain(data) {
  const rain = data.weather?.rainCore;
  const radar = data.radar;
  if (!rain) return;
  document.querySelector('#rainCellName').textContent = radar?.id || '雷达帧待更新';
  document.querySelector('#rainCellName').title = radar?.idNote || '';
  document.querySelector('#rainState').textContent = rain.intensity;
  document.querySelector('#rainState').className = `level-pill ${rain.precipitationRateMmH >= 16 ? 'orange' : rain.precipitationRateMmH >= 2.5 ? 'yellow' : 'safe'}`;
  document.querySelector('#rainArrow').textContent = directionArrow(rain.movementDirection);
  document.querySelector('#rainDirection').textContent = rain.movementDirection;
  document.querySelector('#rainSummary').textContent = `${rain.locationName} · ${rain.precipitationRateMmH} mm/h`;
  document.querySelector('#rainValue').textContent = rain.precipitationRateMmH.toFixed(1);
  document.querySelector('#rainIntensity').textContent = rain.intensity;
  document.querySelector('#rainCoreLocation').textContent = rain.locationName;
  document.querySelector('#rainMethod').textContent = '九点格点估算';
  document.querySelector('#radarObservedAt').textContent = formatTime(radar?.observedAt, false);
  document.querySelector('#radarMapStatus').textContent = radar ? `${radar.id} · ${formatTime(radar.observedAt)}` : '雷达来源暂不可用';
  document.querySelector('#mapTime').textContent = radar ? `雷达 ${formatTime(radar.observedAt)}` : `抓取 ${formatTime(data.fetchedAt)}`;
}

function renderWeather(data) {
  const weather = data.weather;
  if (!weather) return;
  const current = weather.current || {};
  document.querySelector('#windValue').textContent = Number(current.wind_gusts_10m ?? 0).toFixed(1);
  document.querySelector('#windDirection').textContent = `${compass(current.wind_direction_10m)}风`;
  document.querySelector('#windFoot').textContent = `气温 ${current.temperature_2m ?? '--'}℃ · 湿度 ${current.relative_humidity_2m ?? '--'}%`;
  document.querySelector('#weatherObservedAt').textContent = formatTime(weather.observedAt, false);
  renderRainChart(weather.recentPrecipitation || []);
}

function renderRainChart(points) {
  const chart = document.querySelector('#rainChart');
  if (!points.length) {
    chart.innerHTML = '<div class="chart-loading">趋势数据暂不可用</div>';
    return;
  }
  const values = points.map((point) => Number(point.precipitationMm || 0));
  const max = Math.max(1, ...values);
  const width = 400;
  const height = 68;
  const coordinates = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - (value / max) * (height - 8);
    return [x, y];
  });
  const line = coordinates.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const total = values.reduce((sum, value) => sum + value, 0);
  document.querySelector('#rainTotal').textContent = total.toFixed(1);
  chart.innerHTML = `<div class="chart-y"><span>${escapeHtml(max.toFixed(1))}</span><span>${escapeHtml((max / 2).toFixed(1))}</span><span>0</span></div><svg viewBox="0 0 400 78" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#58d7c0" stop-opacity=".32"/><stop offset="1" stop-color="#58d7c0" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#chartFill)"/><path d="${line}" fill="none" stroke="#68dbc7" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="chart-x">${points.map((point) => `<span>${escapeHtml(formatTime(point.time, false))}</span>`).join('')}</div>`;
}

function renderWarnings(data) {
  const list = document.querySelector('#alertList');
  const warnings = data.warnings || [];
  document.querySelector('#alertCount').textContent = String(warnings.length).padStart(2, '0');
  if (!data.health?.warnings?.ok && !warnings.length) {
    list.innerHTML = '<div class="empty-state error-state"><strong>预警数据源暂不可用</strong><span>请直接查看上海预警中心或属地气象台最新发布。</span></div>';
    return;
  }
  if (!warnings.length) {
    list.innerHTML = '<div class="empty-state"><strong>上海当前无生效气象预警</strong><span>最后检查：' + escapeHtml(formatTime(data.health?.warnings?.updatedAt)) + '</span></div>';
    return;
  }
  list.innerHTML = warnings.map((warning) => {
    const levelClass = warning.level === '红色' ? 'alert-red' : warning.level === '橙色' ? 'alert-orange' : warning.level === '黄色' ? 'alert-yellow' : 'alert-blue';
    return `<article class="alert-item ${levelClass}"><div class="alert-colorbar"></div><div class="alert-copy"><div class="alert-type"><span>${escapeHtml(warning.type)}</span><span class="alert-level">${escapeHtml(warning.level)}预警</span><span class="alert-time">${escapeHtml(formatTime(warning.publishedAt))}</span></div><h3>${escapeHtml(warning.title)}</h3><p>${escapeHtml(warning.content)}</p><div class="alert-source">发布单位：${escapeHtml(warning.publisher)} <span>· 上海预警中心</span></div></div></article>`;
  }).join('');
}

function renderSources(data) {
  const healthKeys = ['warnings', 'typhoons', 'radar', 'weather'];
  document.querySelector('#sourceList').innerHTML = (data.sources || []).map((source, index) => {
    const health = data.health?.[healthKeys[index]] || { ok: false };
    return `<a class="source-item" href="${escapeHtml(source.url)}" target="_blank" rel="noopener"><span class="source-status ${health.ok ? 'online' : 'offline'}"></span><span><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(source.role)}</small></span><em>${health.ok ? '正常' : '降级'}</em></a>`;
  }).join('');
}

function initializeMap(data) {
  map = L.map('weatherMap', { zoomControl: true, attributionControl: true }).setView(SHANGHAI, 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.circleMarker(SHANGHAI, { radius: 7, color: '#9bf1df', weight: 2, fillColor: '#103e46', fillOpacity: 1 }).addTo(map).bindTooltip('上海市');
  typhoonGroup = L.featureGroup().addTo(map);
  if (data.radar?.tileUrl) {
    radarLayer = L.tileLayer(data.radar.tileUrl, { opacity: 0.58, maxNativeZoom: 7, maxZoom: 18, attribution: '<a href="https://www.rainviewer.com/">RainViewer</a>' }).addTo(map);
  }
  (data.typhoons || []).forEach((typhoon) => {
    const track = (typhoon.track || []).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
    if (!track.length) return;
    const latLngs = track.map((point) => [point.latitude, point.longitude]);
    L.polyline(latLngs, { color: '#ffad78', weight: 3, opacity: 0.85 }).addTo(typhoonGroup);
    track.forEach((point, index) => {
      if (index % Math.max(1, Math.floor(track.length / 12)) !== 0 && index !== track.length - 1) return;
      L.circleMarker([point.latitude, point.longitude], { radius: index === track.length - 1 ? 7 : 3, color: '#ffad78', fillColor: '#ffad78', fillOpacity: 0.8 }).addTo(typhoonGroup).bindTooltip(`${typhoon.nameZh || typhoon.nameEn} ${formatTime(point.observedAt)}`);
    });
    const forecast = (typhoon.forecast || []).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
    if (forecast.length) L.polyline([[track.at(-1).latitude, track.at(-1).longitude], ...forecast.map((point) => [point.latitude, point.longitude])], { color: '#ffd0aa', weight: 2, dashArray: '7 7' }).addTo(typhoonGroup);
  });
  setTimeout(() => map.invalidateSize(), 0);
}

function selectLayer(layer) {
  document.querySelectorAll('.layer-button').forEach((button) => button.classList.toggle('selected', button.dataset.layer === layer));
  if (!map) return;
  if (radarLayer) {
    if (layer === 'typhoon') map.removeLayer(radarLayer);
    else if (!map.hasLayer(radarLayer)) radarLayer.addTo(map);
  }
  if (typhoonGroup) {
    if (layer === 'rain') map.removeLayer(typhoonGroup);
    else if (!map.hasLayer(typhoonGroup)) typhoonGroup.addTo(map);
  }
  if (layer === 'typhoon' && typhoonGroup?.getLayers().length) map.fitBounds(typhoonGroup.getBounds().extend(SHANGHAI), { padding: [30, 30], maxZoom: 7 });
  else map.setView(SHANGHAI, layer === 'rain' ? 8 : 7);
}

function bindInteractions() {
  const viewMessage = { overview: '已显示上海综合风险', typhoon: '已切换至中央气象台台风路径', rain: '已切换至上海雷达回波' };
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    const view = button.dataset.view;
    document.querySelectorAll('.nav-link[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
    selectLayer(view === 'overview' ? 'all' : view);
    if (view !== 'overview') document.querySelector('.map-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    announce(viewMessage[view]);
  }));
  document.querySelectorAll('.layer-button').forEach((button) => button.addEventListener('click', () => {
    selectLayer(button.dataset.layer);
    announce(`已切换至${button.textContent.trim()}图层`);
  }));
  document.querySelector('#mapDetails').addEventListener('click', () => announce('雷达来自 RainViewer；台风来自中央气象台；地图不可用于航海导航。'));
}

async function loadLiveData() {
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    liveData = await response.json();
    renderHeader(liveData);
    renderTyphoon(liveData);
    renderRain(liveData);
    renderWeather(liveData);
    renderWarnings(liveData);
    renderSources(liveData);
  } catch (error) {
    document.querySelector('#healthTag').textContent = 'DATA UNAVAILABLE';
    document.querySelector('#healthTag').classList.add('degraded');
    document.querySelector('#serviceNotice').textContent = '实时数据文件暂时无法读取，请直接查看上海预警中心和中央气象台。';
    document.querySelector('#alertList').innerHTML = '<div class="empty-state error-state"><strong>数据加载失败</strong><span>页面保留来源入口，不展示过期信息。</span></div>';
    announce(`实时数据加载失败：${error.message}`);
    return;
  }
  try {
    if (typeof L === 'undefined') throw new Error('地图组件未加载');
    initializeMap(liveData);
  } catch (error) {
    document.querySelector('#weatherMap').innerHTML = '<div class="map-fallback"><strong>地图暂不可用</strong><span>气象数据面板仍正常更新，请使用数据来源入口查看原图。</span></div>';
    announce(`地图加载失败：${error.message}`);
  }
}

bindInteractions();
loadLiveData();
