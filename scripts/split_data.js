// Tách data-src/du_lieu_ban_do_KTKGTT_Da_Nang.geojson thành các tệp theo lớp trong public/data
import fs from 'node:fs';
const src = JSON.parse(fs.readFileSync('data-src/du_lieu_ban_do_KTKGTT_Da_Nang.geojson', 'utf8'));
const layers = {};
for (const f of src.features) (layers[f.properties.layer] ||= []).push(f);
layers.hoa_vang ||= [];
fs.mkdirSync('public/data', { recursive: true });
for (const [k, features] of Object.entries(layers)) {
  fs.writeFileSync(`public/data/${k}.geojson`, JSON.stringify({ type: 'FeatureCollection', name: k, features }));
  console.log(k, features.length);
}
