// Kiểm tra dữ liệu GeoJSON trong public/data (chạy trước build)
import fs from 'node:fs';
import * as turf from '@turf/turf';

const dir = 'public/data';
const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, 'utf8'));
let errors = 0;
const fail = (m) => { errors++; console.error('LỖI:', m); };
const ok = (m) => console.log('đạt:', m);
const feats = {};

for (const l of manifest.layers) {
  const fc = JSON.parse(fs.readFileSync(`${dir}/${l.file}`, 'utf8'));
  if (fc.type !== 'FeatureCollection') fail(`${l.file} không phải FeatureCollection`);
  for (const f of fc.features) {
    const p = f.properties || {};
    for (const k of ['id', 'name', 'layer', 'source']) if (!p[k]) fail(`${f.id || '?'} thiếu ${k}`);
    feats[p.id] = f;
    const pts = [];
    const walk = (c) => (typeof c[0] === 'number' ? pts.push(c) : c.forEach(walk));
    walk(f.geometry.coordinates);
    for (const [x, y] of pts) if (y < 15.3 || y > 16.3 || x < 107.7 || x > 108.7) fail(`${p.id}: tọa độ ngoài khung (${y}, ${x})`);
    if (f.geometry.type === 'Polygon') {
      const r = f.geometry.coordinates[0];
      const a = r[0], b = r[r.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) fail(`${p.id}: đa giác không khép kín`);
      const uniq = new Set(r.slice(0, -1).map((c) => c.join(',')));
      if (uniq.size < 3) fail(`${p.id}: ít hơn 3 đỉnh khác nhau`);
      if (uniq.size !== r.length - 1) fail(`${p.id}: có đỉnh trùng nhau`);
      const km2 = turf.area(f) / 1e6;
      const pub = p.area_km2 ?? (p.area_ha ? p.area_ha / 100 : null);
      if (pub) {
        const d = Math.abs(km2 - pub) / pub;
        (d < 0.03 ? ok : fail)(`${p.id}: diện tích tính lại ${km2.toFixed(2)} km², công bố ${pub} km², lệch ${(d * 100).toFixed(2)}%`);
      }
    }
  }
}

const dist = (a, b) => turf.distance(feats[a].geometry.coordinates, feats[b].geometry.coordinates, { units: 'meters' });
for (const [a, b, ref] of [['son-tra-2', 'son-tra-1', 2494], ['son-tra-1', 'son-tra-3', 4062], ['son-tra-3', 'son-tra-5', 2616]]) {
  const d = dist(a, b);
  const dev = Math.abs(d - ref) / ref;
  (dev < 0.01 ? ok : fail)(`${a} – ${b}: ${d.toFixed(0)} m (tham chiếu ${ref} m), lệch ${(dev * 100).toFixed(2)}%`);
}
if (errors) { console.error(`\n${errors} lỗi dữ liệu.`); process.exit(1); }
console.log('\nDữ liệu hợp lệ.');
