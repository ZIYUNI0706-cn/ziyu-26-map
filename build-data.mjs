/**
 * 构建城市级中国地图 GeoJSON：
 * - 省级列表来自 DataV.GeoAtlas 100000_full.json
 * - 直辖市/港澳台使用省级边界作为单个"城市"
 * - 其余省份拉取 {adcode}_full.json 获取地级市边界
 * - 排除三沙市与南海诸岛（避免地图纵向被拉伸）
 * - 为每个 feature 计算 bbox 与中心点，便于搜索定位/飞行动画
 * 输出: data/china-city.js  (window.__CHINA_CITY_GEO__ = {...})
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound';
// 直辖市 / 台湾 / 香港 / 澳门：整体视为一个"城市"
const AS_CITY = new Set(['110000', '120000', '310000', '500000', '710000', '810000', '820000']);
const EXCLUDE = new Set(['460300']); // 三沙市
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries) throw e;
      await sleep(800 * (i + 1));
    }
  }
}

function eachCoord(geom, fn) {
  if (!geom) return;
  if (geom.type === 'Polygon') geom.coordinates.forEach((ring) => ring.forEach(fn));
  else if (geom.type === 'MultiPolygon')
    geom.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(fn)));
}

function bboxOf(geom) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  eachCoord(geom, ([x, y]) => {
    if (x < bbox[0]) bbox[0] = x;
    if (y < bbox[1]) bbox[1] = y;
    if (x > bbox[2]) bbox[2] = x;
    if (y > bbox[3]) bbox[3] = y;
  });
  return bbox.every((n) => Number.isFinite(n)) ? bbox : null;
}

function centerOf(props, bbox) {
  if (Array.isArray(props.center) && props.center.length === 2) return props.center;
  if (Array.isArray(props.centroid) && props.centroid.length === 2) return props.centroid;
  if (Array.isArray(props.cp) && props.cp.length === 2) return props.cp;
  if (bbox) return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  return null;
}

function normalize(f, provinceName) {
  const p = f.properties || {};
  const bbox = bboxOf(f.geometry);
  const center = centerOf(p, bbox);
  if (!bbox || !center) return null;
  return {
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      name: p.name,
      adcode: String(p.adcode ?? ''),
      province: provinceName,
      center,
      bbox,
    },
  };
}

async function main() {
  console.log('拉取省级边界...');
  const country = await fetchJSON(`${BASE}/100000_full.json`);
  const provinces = country.features.filter((f) => {
    const p = f.properties || {};
    return p.adcode && String(p.adcode) !== '100000' && p.name !== '南海诸岛';
  });

  const features = [];
  for (const pf of provinces) {
    const adcode = String(pf.properties.adcode);
    const pname = pf.properties.name;
    await sleep(120);
    if (AS_CITY.has(adcode)) {
      // 台湾优先尝试地市级数据，失败则退回省级整体
      if (adcode === '710000') {
        try {
          const tw = await fetchJSON(`${BASE}/${adcode}_full.json`);
          if (tw?.features?.length) {
            tw.features.forEach((f) => {
              const n = normalize(f, pname);
              if (n) features.push(n);
            });
            console.log(`  ${pname}: ${tw.features.length} 个城市(地市级)`);
            continue;
          }
        } catch {
          /* fallback below */
        }
      }
      const n = normalize(pf, pname);
      if (n) {
        features.push(n);
        console.log(`  ${pname}: 整体 1 个城市`);
      }
      continue;
    }
    try {
      const full = await fetchJSON(`${BASE}/${adcode}_full.json`);
      let added = 0;
      (full?.features || []).forEach((f) => {
        const p = f.properties || {};
        if (EXCLUDE.has(String(p.adcode)) || !p.name) return;
        const n = normalize(f, pname);
        if (n) {
          features.push(n);
          added++;
        }
      });
      console.log(`  ${pname}: ${added} 个城市`);
    } catch (e) {
      console.warn(`  ${pname} 拉取失败(${e.message})，使用省级边界代替`);
      const n = normalize(pf, pname);
      if (n) features.push(n);
    }
  }

  // 去重（同名后取者胜，理论上无重名）
  const seen = new Map();
  for (const f of features) seen.set(f.properties.name, f);
  const finalFeatures = [...seen.values()];
  const geo = { type: 'FeatureCollection', features: finalFeatures };

  const outDir = path.resolve('data');
  await fs.mkdir(outDir, { recursive: true });
  const json = JSON.stringify(geo);
  await fs.writeFile(path.join(outDir, 'china-city.js'), `window.__CHINA_CITY_GEO__=${json};\n`);

  console.log(`\n完成: ${finalFeatures.length} 个城市, 文件大小 ${(json.length / 1024 / 1024).toFixed(2)} MB`);
  const odd = finalFeatures
    .map((f) => f.properties.name)
    .filter((n) => /直辖|林区|地区|盟|自治州/.test(n));
  console.log('特殊名称:', odd.join(', ') || '(无)');
}

main().catch((e) => {
  console.error('构建失败:', e);
  process.exit(1);
});
