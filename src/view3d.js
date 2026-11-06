// Chế độ xem 3D: địa hình thật (DEM Terrarium) + khối trần độ cao Tiểu khu A, B
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as turf from '@turf/turf';

const EMPTY = { type: 'FeatureCollection', features: [] };

export function open3D({ el, data, manifest, center, zoom, onPick }) {
  const map = new maplibregl.Map({
    container: el,
    center,
    zoom: Math.max(zoom - 1, 9),
    pitch: 62,
    bearing: -25,
    maxPitch: 85,
    maxZoom: 17,
    style: {
      version: 8,
      sources: {
        sat: { type: 'raster', tileSize: 256, maxzoom: 18, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: 'Ảnh vệ tinh © Esri, Maxar · Độ cao © Mapzen, AWS Terrain Tiles' },
        dem: { type: 'raster-dem', tileSize: 256, maxzoom: 14, encoding: 'terrarium', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'] },
      },
      layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  const markers = [];
  const label = (lngLat, text, cls = '') => {
    const d = document.createElement('div');
    d.className = `lbl3d ${cls}`;
    d.textContent = text;
    markers.push(new maplibregl.Marker({ element: d, anchor: 'bottom' }).setLngLat(lngLat).addTo(map));
  };
  const all = (id) => data[id]?.features || [];

  map.on('load', () => {
    map.setTerrain({ source: 'dem', exaggeration: 1 });
    const add = (id, features) => map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features } });

    add('qd', all('qd4167')); add('hv', all('hoa_vang')); add('kcnc', all('kcnc'));
    add('ab', all('bvlos').filter((f) => f.properties.id !== 'bvlos-tong-the'));
    add('tong', all('bvlos').filter((f) => f.properties.id === 'bvlos-tong-the'));
    add('runway', all('san_bay').filter((f) => f.geometry.type === 'LineString'));
    const dad = all('san_bay').find((f) => f.geometry.type === 'Point');
    add('ring', dad ? [turf.polygonToLine(turf.circle(dad.geometry.coordinates, 15, { units: 'kilometers', steps: 128 }))] : []);
    add('pts', [...all('bvlos_diem'), ...all('son_tra')]);
    add('hl', [...all('hanh_lang'), ...all('hanh_lang_dat')].filter((f) => f.geometry.type === 'Polygon'));

    const fill = (id, src, color, op) => map.addLayer({ id, type: 'fill', source: src, paint: { 'fill-color': color, 'fill-opacity': op } });
    const line = (id, src, color, w, dash) => map.addLayer({ id, type: 'line', source: src, paint: { 'line-color': color, 'line-width': w, ...(dash ? { 'line-dasharray': dash } : {}) } });
    fill('qd-f', 'qd', '#2A6FD0', 0.25); line('qd-l', 'qd', '#2A6FD0', 2);
    fill('hv-f', 'hv', '#0E9F9F', 0.4); line('hv-l', 'hv', '#0E9F9F', 2);
    fill('kcnc-f', 'kcnc', '#8A3CA0', 0.5); line('kcnc-l', 'kcnc', '#8A3CA0', 2);
    map.addLayer({ id: 'kcnc-3d', type: 'fill-extrusion', source: 'kcnc', filter: ['==', ['get', 'id'], 'khu-huan-luyen-3-3ha'], paint: { 'fill-extrusion-color': '#8A3CA0', 'fill-extrusion-height': 1000, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.28 } });
    map.addLayer({
      id: 'ab-3d', type: 'fill-extrusion', source: 'ab',
      paint: {
        'fill-extrusion-color': ['match', ['get', 'id'], 'bvlos-tieu-khu-a', '#2E9A3C', '#E07814'],
        'fill-extrusion-height': ['*', ['get', 'amsl_max_m'], 1],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.5,
      },
    });
    line('tong-l', 'tong', '#D01E1E', 3);
    line('ring-l', 'ring', '#dddddd', 2, [3, 3]);
    line('rw', 'runway', '#111111', 4);
    const hc = ['match', ['get', 'layer'], 'hanh_lang_dat', '#E83E8C', '#00B8D9'];
    fill('hl-f', 'hl', hc, 0.4); line('hl-l', 'hl', hc, 3);
    all('hanh_lang_dat').forEach((f) => label(turf.center(f).geometry.coordinates, 'Hành lang Khu CNC – Hòa Vang', 'wide'));
    map.addLayer({ id: 'pts-c', type: 'circle', source: 'pts', paint: { 'circle-radius': ['case', ['==', ['get', 'layer'], 'son_tra'], 6, 4], 'circle-color': ['case', ['==', ['get', 'layer'], 'son_tra'], '#D02020', '#ffffff'], 'circle-stroke-color': '#000', 'circle-stroke-width': 1.5 } });

    // nhãn
    label([108.0215, 16.075], 'Tiểu khu B · trần đề xuất 900 m so với mực nước biển (chờ ý kiến) · ≤ 200 m so với mặt đất', 'wide');
    label([108.047, 16.075], 'Tiểu khu A · trần 500 m so với mực nước biển · ≤ 200 m so với mặt đất', 'wide');
    all('bvlos_diem').forEach((f) => label(f.geometry.coordinates, f.properties.name, 'pt'));
    all('qd4167').forEach((f) => label(turf.centroid(f).geometry.coordinates, f.properties.name.split(' – ')[0], ''));
    all('kcnc').filter((f) => f.properties.id === 'khu-huan-luyen-3-3ha').forEach((f) => label(turf.centroid(f).geometry.coordinates, 'Khu huấn luyện · mốc che chắn tham chiếu 1.000 m (không phải độ cao được phép bay)', 'wide'));
    all('dia_danh').forEach((f) => label(f.geometry.coordinates, '▲ ' + f.properties.name + ' · ' + f.properties.elev_m + ' m', 'wide'));
    const st = all('son_tra').find((f) => f.properties.id === 'son-tra-3');
    if (st) label(st.geometry.coordinates, 'Vùng xanh Sơn Trà · độ cao khảo sát 500 m so với địa hình (không phải độ cao được phép)', 'wide up');
    all('hanh_lang').forEach((f) => label(f.geometry.type === 'Polygon' ? turf.center(f).geometry.coordinates : f.geometry.coordinates, f.geometry.type === 'Polygon' ? (f.properties.id === 'vong-cu-lao-cham' ? 'Vùng bay quanh Cù Lao Chàm' : f.properties.id === 'hanh-lang-s1' ? 'Hành lang S1 · khoảng 36 km' : 'Hành lang S2 · khoảng 26 km') : f.properties.name, 'wide'));
    if (dad) label(dad.geometry.coordinates, '★ Sân bay Đà Nẵng', '');
    all('son_tra').forEach((f) => label(f.geometry.coordinates, f.properties.id === 'son-tra-4' ? '' : f.properties.name, 'pt'));

    map.on('mousemove', (e) => {
      const el = document.getElementById('elev');
      const h = map.queryTerrainElevation(e.lngLat);
      if (el) el.textContent = h == null ? '–' : Math.round(h).toLocaleString('vi-VN') + ' m';
    });
    map.on('click', 'ab-3d', (e) => onPick(e.features[0].properties.id));
    for (const l of ['kcnc-3d', 'qd-f', 'pts-c']) map.on('click', l, (e) => onPick(e.features[0].properties.id));
    map.on('mouseenter', 'ab-3d', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'ab-3d', () => (map.getCanvas().style.cursor = ''));
  });

  return {
    map,
    setExaggeration: (v) => {
      if (map.getTerrain()) map.setTerrain({ source: 'dem', exaggeration: v });
      if (map.getLayer('ab-3d')) map.setPaintProperty('ab-3d', 'fill-extrusion-height', ['*', ['get', 'amsl_max_m'], v]);
      if (map.getLayer('kcnc-3d')) map.setPaintProperty('kcnc-3d', 'fill-extrusion-height', 1000 * v);
    },
    setCeilingOpacity: (v) => map.getLayer('ab-3d') && map.setPaintProperty('ab-3d', 'fill-extrusion-opacity', v),
    view: () => ({ center: map.getCenter(), zoom: map.getZoom() }),
    destroy() { markers.forEach((m) => m.remove()); map.remove(); },
  };
}
