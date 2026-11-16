const toast = document.querySelector('#toast');
let toastTimer;

function announce(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

const viewMessage = {
  overview: '已显示本地风险总览',
  typhoon: '已聚焦台风移动路径（演示）',
  rain: '已聚焦暴雨云团图层（演示）',
};

function selectView(view) {
  document.querySelectorAll('.nav-link[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  const map = document.querySelector('.map-canvas');
  map.classList.remove('layer-typhoon', 'layer-rain');
  if (view === 'typhoon') map.classList.add('layer-typhoon');
  if (view === 'rain') map.classList.add('layer-rain');
  if (view !== 'overview') document.querySelector('.map-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  announce(viewMessage[view] || '已打开风险总览');
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => selectView(button.dataset.view));
});

document.querySelectorAll('.layer-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.layer-button').forEach((item) => item.classList.toggle('selected', item === button));
    const map = document.querySelector('.map-canvas');
    map.classList.remove('layer-typhoon', 'layer-rain');
    if (button.dataset.layer === 'typhoon') map.classList.add('layer-typhoon');
    if (button.dataset.layer === 'rain') map.classList.add('layer-rain');
    announce(button.dataset.layer === 'all' ? '已显示综合图层' : `已切换至${button.textContent.trim()}图层`);
  });
});

const demoRegions = ['东岚县', '南湾新区', '白沙港镇'];
let selectedRegion = 0;
document.querySelector('#locateButton').addEventListener('click', () => {
  selectedRegion = (selectedRegion + 1) % demoRegions.length;
  const region = demoRegions[selectedRegion];
  document.querySelector('#locationLabel').textContent = region;
  document.querySelector('#countyTitle').textContent = region;
  announce(`已切换到${region}演示区域；定位与预警数据均为模拟内容`);
});

document.querySelectorAll('.map-zoom button').forEach((button, index) => {
  button.addEventListener('click', () => {
    const svg = document.querySelector('.weather-map');
    const viewBox = svg.viewBox.baseVal;
    const factor = index === 0 ? 0.82 : 1.22;
    const width = Math.min(1200, Math.max(500, viewBox.width * factor));
    const height = width * (540 / 900);
    const x = Math.max(0, Math.min(900 - width, viewBox.x + (viewBox.width - width) / 2));
    const y = Math.max(0, Math.min(540 - height, viewBox.y + (viewBox.height - height) / 2));
    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  });
});

document.querySelector('#mapDetails').addEventListener('click', () => {
  announce('路径、云团位置和边界均为示意，不代表真实观测或导航信息');
});
document.querySelector('#allAlerts').addEventListener('click', () => {
  announce('演示页面当前展示 2 条模拟预警信息');
});

document.querySelectorAll('.alert-item').forEach((item) => {
  item.addEventListener('click', () => announce('预警详情为演示内容；实际请以属地气象台发布为准'));
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      item.click();
    }
  });
});
