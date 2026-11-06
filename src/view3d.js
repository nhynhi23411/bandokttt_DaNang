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
    map.setTerrain({ source: 'dem', exaggeration: 1.2 });
    const add = (id, features) => map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features } });

    add('qd', all('qd4167')); add('hv', all('hoa_vang')); add('kcnc', all('kcnc'));
    add('ab', all('bvlos').filter((f) => f.properties.id !== 'bvlos-tong-the'));
    add('tong', all('bvlos').filter((f) => f.properties.id === 'bvlos-tong-the'));
    add('runway', all('san_bay').filter((f) => f.geometry.type === 'LineString'));
    const dad = all('san_bay').find((f) => f.geometry.type === 'Point');
    add('ring', dad ? [turf.polygonToLine(turf.circle(dad.geometry.coordinates, 15, { units: 'kilometers', steps: 128 }))] : []);
    add('pts', [...all('bvlos_diem'), ...all('son_tra')]);

    const fill = (id, src, color, op) => map.addLayer({ id, type: 'fill', source: src, paint: { 'fill-color': color, 'fill-opacity': op } });
    const line = (id, src, color, w, dash) => map.addLayer({ id, type: 'line', source: src, paint: { 'line-color': color, 'line-width': w, ...(dash ? { 'line-dasharray': dash } : {}) } });
    fill('qd-f', 'qd', '#2A6FD0', 0.25); line('qd-l', 'qd', '#2A6FD0', 2);
    fill('hv-f', 'hv', '#0E9F9F', 0.4); line('hv-l', 'hv', '#0E9F9F', 2);
    fill('kcnc-f', 'kcnc', '#8A3CA0', 0.5); line('kcnc-l', 'kcnc', '#8A3CA0', 2);
    map.addLayer({
      id: 'ab-3d', type: 'fill-extrusion', source: 'ab',
      paint: {
        'fill-extrusion-color': ['match', ['get', 'id'], 'bvlos-tieu-khu-a', '#2E9A3C', '#E07814'],
        'fill-extrusion-height': ['get', 'amsl_max_m'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.5,
      },
    });
    line('tong-l', 'tong', '#D01E1E', 3);
    line('ring-l', 'ring', '#dddddd', 2, [3, 3]);
    line('rw', 'runway', '#111111', 4);
    map.addLayer({ id: 'pts-c', type: 'circle', source: 'pts', paint: { 'circle-radius': ['case', ['==', ['get', 'layer'], 'son_tra'], 6, 4], 'circle-color': ['case', ['==', ['get', 'layer'], 'son_tra'], '#D02020', '#ffffff'], 'circle-stroke-color': '#000', 'circle-stroke-width': 1.5 } });

    // nhãn
    label([108.0215, 16.075], 'Tiểu khu B · trần đề xuất 900 m (so với mực nước biển) – chờ ý kiến', 'wide');
    label([108.047, 16.075], 'Tiểu khu A · trần 500 m', 'wide');
    all('bvlos_diem').forEach((f) => label(f.geometry.coordinates, f.properties.name, 'pt'));
    all('qd4167').forEach((f) => label(turf.centroid(f).geometry.coordinates, f.properties.name.split(' – ')[0], ''));
    all('kcnc').forEach((f) => label(turf.centroid(f).geometry.coordinates, 'Khu huấn luyện', ''));
    if (dad) label(dad.geometry.coordinates, '★ Sân bay Đà Nẵng', '');
    all('son_tra').forEach((f) => label(f.geometry.coordinates, f.properties.id === 'son-tra-4' ? '' : f.properties.name, 'pt'));

    map.on('click', 'ab-3d', (e) => onPick(e.features[0].properties.id));
    for (const l of ['kcnc-f', 'qd-f', 'pts-c']) map.on('click', l, (e) => onPick(e.features[0].properties.id));
    map.on('mouseenter', 'ab-3d', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'ab-3d', () => (map.getCanvas().style.cursor = ''));
  });

  return {
    map,
    setExaggeration: (v) => map.getTerrain() && map.setTerrain({ source: 'dem', exaggeration: v }),
    setCeilingOpacity: (v) => map.getLayer('ab-3d') && map.setPaintProperty('ab-3d', 'fill-extrusion-opacity', v),
    view: () => ({ center: map.getCenter(), zoom: map.getZoom() }),
    destroy() { markers.forEach((m) => m.remove()); map.remove(); },
  };
}
