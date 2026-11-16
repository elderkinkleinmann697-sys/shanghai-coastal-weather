# 海岸安 · 上海气象风险实况

面向上海沿海居民、渔民、近海养殖户、沿海商铺、学校和基层应急人员的气象风险信息聚合站。

## 项目文档

- [项目计划书](docs/项目计划书.md)：产品目标、用户需求、功能范围、数据方案、技术架构、实施阶段与风险控制。
- [网页入口](index.html)：上海台风、雷达降雨和官方预警的实时数据页面。

## 核心模块

- **台风**：中央气象台活动台风、实况路径、预报路径、风力、移向和距上海距离。
- **暴雨雷达**：RainViewer 雷达拼图、Open-Meteo 九点降雨格点、雨强和降雨核心趋势。
- **上海预警**：上海预警中心当前生效预警，保留发布区域、机构、级别、时间和原文入口。
- **自动更新**：GitHub Actions 每小时第 7、22、37、52 分抓取并发布一次。

## 重要原则

- 本站是公开数据聚合页面，不是官方预警发布平台，也不能用于航海导航。
- 上海预警级别以发布机构原文为准；平台不自行生成或修改官方预警级别。
- `RC-YYYYMMDDHHmm` 是按雷达时次生成的平台监测编号，不是气象部门的云团命名。
- 降雨核心和移动方向来自九点模式格点估算，应结合雷达图和官方临近预报判断。
- 页面显示抓取时间、观测时间、来源健康状态；来源异常时保留上一份数据并标记降级。

## 数据源

- 上海预警中心公开预警列表：`https://d1.weather.com.cn/shweather/alarm.json`
- 中央气象台台风网：`https://typhoon.nmc.cn/`
- RainViewer Weather Maps API：`https://www.rainviewer.com/api/weather-maps-api.html`
- Open-Meteo Forecast API：`https://open-meteo.com/en/docs`

## 自动更新和部署

工作流位于 `.github/workflows/live-data-pages.yml`。它会运行 `node scripts/fetch-data.mjs`，更新 `dist/data/live.json`，提交有变化的数据并将 `dist/` 部署到 GitHub Pages。也可在 Actions 页面手动运行。

## 本地查看

使用任意 Markdown 阅读器打开 docs/项目计划书.md。本地预览前先执行 `node scripts/fetch-data.mjs`，再通过静态文件服务器访问 `dist/`。
