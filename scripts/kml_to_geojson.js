// Chuyển mọi .kml trong data-src/kml thành GeoJSON, ghi vào public/data, rồi kiểm tra dữ liệu.
// Tên thư mục hoặc tên Placemark chứa "hoa-vang" (hoặc "hoa vang") -> lớp hoa_vang.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { DOMParser } from 'linkedom';
import { kml } from '@tmcw/togeojson';
import * as turf from '@turf/turf';

const dir = 'data-src/kml';
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.kml')) : [];
const out = [];

const stripZ = (c) => (typeof c[0] === 'number' ? [c[0], c[1]] : c.map(stripZ));

for (const file of files) {
  const doc = new DOMParser().parseFromString(fs.readFileSync(path.join(dir, file), 'utf8'), 'text/xml');
  const gj = kml(doc);
  gj.features.forEach((f, i) => {
    if (!f.geometry) return;
    const name = f.properties?.name || `${path.basename(file, '.kml')}-${i + 1}`;
    const isHV = /hoa[-_ ]?vang/i.test(slug(file) + ' ' + slug(name)) || /hoa-vang/.test(slug(file) + slug(name));
    f.geometry.coordinates = stripZ(f.geometry.coordinates);
    f.properties = {
      id: slug(name) || `kml-${i}`, name, layer: isHV ? 'hoa_vang' : 'hoa_vang',
      status: 'de_xuat', source: 'S5',
    };
    out.push(f);
  });
}

if (files.length) {
  const fc = { type: 'FeatureCollection', name: 'hoa_vang', features: out };
  fs.writeFileSync('public/data/hoa_vang.geojson', JSON.stringify(fc));
  console.log(`Đã ghi ${out.length} đối tượng vào lớp hoa_vang.`);
  for (const f of out) {
    if (f.geometry.type.includes('Polygon')) {
      console.log(`- ${f.properties.name}: ${(turf.area(f) / 1e4).toFixed(2)} ha; chu vi ${turf.length(turf.polygonToLine(f), { units: 'kilometers' }).toFixed(2)} km`);
    } else console.log(`- ${f.properties.name}: ${f.geometry.type}`);
  }
} else console.log('Không có tệp .kml trong data-src/kml; giữ nguyên lớp hoa_vang.');

execSync('node scripts/validate_data.js', { stdio: 'inherit' });
