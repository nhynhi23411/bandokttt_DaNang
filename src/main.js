import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as turf from '@turf/turf';
import './style.css';
import { fmt, dec, dms, parseCoord, toKML, download } from './geo.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const json = (u) => fetch(u).then((r) => r.json());

const CITY = [[15.45, 107.86], [16.2, 108.62]];
const DAD = { lat: 16.043889, lon: 108.200278 };
const STATUS = { da_thiet_lap: 'Đã thiết lập', de_xuat: 'Đề xuất', de_xuat_cho_y_kien: 'Chờ ý kiến', khao_sat_de_xuat: 'Đề xuất' };
const WARN = 'Kết quả chỉ để tham khảo; việc bay phải có giấy phép của cơ quan có thẩm quyền.';

const state = { tool: null, data: {}, groups: {}, feats: {}, polyBase: [], selected: null, sources: [], labels: {} };

// ---------- Bản đồ ----------
const map = L.map('map', { zoomControl: false, maxZoom: 19, minZoom: 8, zoomSnap: 0.25, doubleClickZoom: true }).fitBounds(CITY);
L.control.zoom({ position: 'topleft', zoomInTitle: 'Phóng to', zoomOutTitle: 'Thu nhỏ' }).addTo(map);
L.control.scale({ metric: true, imperial: false, position: 'bottomright' }).addTo(map);
['p-b', 'p-a', 'p-outline', 'p-kcnc', 'p-air', 'p-pts'].forEach((n, i) => { map.createPane(n).style.zIndex = 410 + i * 10; });
map.createPane('p-qd').style.zIndex = 405;
map.createPane('p-tools').style.zIndex = 500;

const bases = {
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18, maxZoom: 19, attribution: 'Ảnh vệ tinh © Esri, Maxar, Earthstar Geographics' }),
  topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxNativeZoom: 17, maxZoom: 19, attribution: '© OpenStreetMap, SRTM | © OpenTopoMap' }),
};
let curBase = 'sat';
function setBase(id) {
  map.removeLayer(bases[curBase]);
  curBase = id;
  bases[id].addTo(map).bringToBack();
  $$('#basemaps button').forEach((b) => b.classList.toggle('on', b.dataset.base === id));
  $$('input[name=base]').forEach((r) => (r.checked = r.value === id));
}
bases.sat.addTo(map);
$$('#basemaps button').forEach((b) => b.addEventListener('click', () => setBase(b.dataset.base)));

// ---------- Tiện ích hình học ----------
const short = (p) => {
  if (p.id === 'bvlos-tong-the') return `Khu BVLOS · ${state.labels.bvlosArea}`;
  if (p.id === 'bvlos-tieu-khu-a') return 'Tiểu khu A';
  if (p.id === 'bvlos-tieu-khu-b') return 'Tiểu khu B';
  if (p.id === 'khu-huan-luyen-kcnc') return 'Khu huấn luyện – Khu CNC';
  if (p.layer === 'qd4167') return p.name.split(' – ')[0];
  return p.name;
};
const level = (l) => {
  $$('#levels button').forEach((b) => b.classList.toggle('on', b.dataset.level === l));
  state.level = l;
};
const tip = (txt, cls, dir = 'center') => L.tooltip({ permanent: true, direction: dir, className: `lbl ${cls}`, opacity: 1 }).setContent(esc(txt));

function vertexNames(f) {
  const p = f.properties;
  const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0].slice(0, -1) : [f.geometry.coordinates];
  const diem = state.data.bvlos_diem?.features || [];
  return ring.map((c, i) => {
    const d = diem.find((q) => q.geometry.coordinates[0] === c[0] && q.geometry.coordinates[1] === c[1]);
    let n = d ? d.properties.name : null;
    if (!n && p.id === 'khu-huan-luyen-kcnc') n = `K${i + 1}`;
    if (!n && p.layer === 'qd4167') n = `Điểm ${i + 1}`;
    return { name: n || `Đỉnh ${i + 1}`, lon: c[0], lat: c[1] };
  });
}

// ---------- Nạp lớp ----------
const layerOpts = (m) => ({
  color: m.color,
  fillColor: m.color,
  fillOpacity: m.fillOpacity ?? 0.3,
  weight: 2,
  bubblingMouseEvents: false,
});

function onFeature(f, lyr) {
  state.feats[f.properties.id] = { f, lyr };
  lyr.on('click', (e) => {
    L.DomEvent.stop(e);
    if (state.tool) return mapClick(e.latlng);
    showDetail(f);
  });
}

function buildLayer(m, fc) {
  const g = L.featureGroup();
  for (const f of fc.features) {
    const p = f.properties;
    let lyr;
    if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
      const sub = (m.id === 'bvlos' && p.id !== 'bvlos-tong-the') ? state.manifest.subColors[p.id] : null;
      const isTotal = p.id === 'bvlos-tong-the';
      const base = isTotal ? 0 : (m.fillOpacity ?? 0.3);
      const pane = m.id === 'qd4167' ? 'p-qd' : m.id === 'kcnc' ? 'p-kcnc' : isTotal ? 'p-outline' : p.id === 'bvlos-tieu-khu-a' ? 'p-a' : p.id === 'bvlos-tieu-khu-b' ? 'p-b' : 'p-qd';
      const color = sub || m.color;
      lyr = L.geoJSON(f, { style: { ...layerOpts(m), color: isTotal ? '#D01E1E' : color, fillColor: color, fillOpacity: base, weight: isTotal ? 3 : 1.5, pane } }).getLayers()[0];
      lyr.options.baseFill = base;
      state.polyBase.push(lyr);
      lyr.bindTooltip(tip(short(p), p.id.startsWith('bvlos-tieu') || p.layer === 'kcnc' ? 'min12' : ''), { permanent: true }).openTooltip?.();
      if (!isTotal) lyr.options.interactive = true;
    } else if (f.geometry.type === 'Point') {
      const [x, y] = f.geometry.coordinates;
      if (m.id === 'san_bay') {
        lyr = L.marker([y, x], { pane: 'p-air', icon: L.divIcon({ className: 'star', html: '★', iconSize: [26, 26], iconAnchor: [13, 13] }) });
        lyr.bindTooltip(tip('Sân bay Đà Nẵng', '', 'right'));
        lyr.getTooltip().options.offset = [12, 0];
        g.addLayer(L.circle([y, x], { radius: 15000, color: '#888', weight: 2, dashArray: '8 8', fill: false, interactive: false, pane: 'p-air' })
          .bindTooltip('Vòng 15 km (minh họa)', { permanent: true, direction: 'top', className: 'lbl ring', opacity: 1 }));
      } else if (m.id === 'dia_danh') {
        lyr = L.marker([y, x], { pane: 'p-pts', icon: L.divIcon({ className: 'peak', html: '▲', iconSize: [22, 22], iconAnchor: [11, 16] }) });
        lyr.bindTooltip(tip(p.name, '', 'right'), { permanent: true });
        lyr.getTooltip().options.offset = [10, -4];
      } else if (m.id === 'son_tra') {
        lyr = L.circleMarker([y, x], { pane: 'p-pts', radius: 7, color: '#fff', weight: 2, fillColor: m.color, fillOpacity: 1, bubblingMouseEvents: false });
        g.addLayer(L.circle([y, x], { radius: p.buffer_m || 100, color: m.color, weight: 1, fillOpacity: 0.15, interactive: false, pane: 'p-pts', className: 'buf min14' }));
        lyr.bindTooltip(tip(p.id === 'son-tra-3' ? 'Điểm 3–4 – InterContinental' : p.name, p.id === 'son-tra-4' ? 'min16' : 'min12', 'top'), { permanent: true });
        if (p.id === 'son-tra-3') lyr.getTooltip().options.offset = [0, -4];
      } else {
        lyr = L.circleMarker([y, x], { pane: 'p-pts', radius: 5, color: '#000', weight: 2, fillColor: '#fff', fillOpacity: 1, bubblingMouseEvents: false });
        lyr.bindTooltip(tip(p.name, 'bold min12', 'top'), { permanent: true });
      }
    } else if (f.geometry.type === 'LineString') {
      lyr = L.polyline(f.geometry.coordinates.map(([x, y]) => [y, x]), { pane: 'p-air', color: '#111', weight: 6, bubblingMouseEvents: false });
    }
    if (lyr) {
      onFeature(f, lyr);
      g.addLayer(lyr);
    }
  }
  return g;
}

function syncVisibility() {
  const z = map.getZoom();
  for (const m of state.manifest.layers) {
    const g = state.groups[m.id];
    const on = $(`#chk-${m.id}`)?.checked && z >= (m.minZoom || 0);
    if (on && !map.hasLayer(g)) g.addTo(map);
    if (!on && map.hasLayer(g)) map.removeLayer(g);
  }
  const c = map.getContainer().classList;
  [12, 14, 16].forEach((n) => c.toggle(`zoom-${n}`, z >= n));
}

// ---------- Cửa sổ thông tin ----------
function showDetail(f) {
  clearHighlight();
  state.hl = L.geoJSON(f, { pane: 'p-tools', style: { color: '#ffd400', weight: 4, fill: false }, pointToLayer: (_, ll) => L.circleMarker(ll, { radius: 12, color: '#ffd400', weight: 4, fill: false }), interactive: false }).addTo(map);
  const p = f.properties, g = f.geometry;
  const rows = [];
  const add = (k, v) => v && rows.push(`<div class="row"><span>${k}</span><b>${v}</b></div>`);
  let head = `<h3>${esc(p.name)}</h3>`;
  if (STATUS[p.status]) head += `<span class="badge s-${p.status}">${STATUS[p.status]}</span>`;
  const isPoly = g.type === 'Polygon';
  if (isPoly) {
    const km2 = turf.area(f) / 1e6, per = turf.length(turf.polygonToLine(f), { units: 'kilometers' });
    add('Diện tích', `${fmt(km2, 2)} km² (${fmt(km2 * 100, 1)} ha)`);
    const pub = p.area_km2 ?? (p.area_ha ? p.area_ha / 100 : null);
    if (pub) add('Diện tích công bố', `≈ ${fmt(pub, 2)} km²`);
    add('Chu vi', `${fmt(per, 2)} km`);
  }
  if (g.type === 'LineString') add('Chiều dài', `${fmt(turf.length(f, { units: 'meters' }), 0)} m`);
  if (p.phase) add('Giai đoạn', p.phase);
  if (p.terrain_m) add('Độ cao địa hình', `${p.terrain_m} m`);
  if (p.agl_max_m) add('Giới hạn', `≤ ${fmt(p.agl_max_m, 0)} m so với mặt đất`);
  if (p.amsl_max_m) add(p.id === 'bvlos-tieu-khu-b' ? 'Trần đề xuất' : 'Giới hạn', `≤ ${fmt(p.amsl_max_m, 0)} m so với mực nước biển`);
  if (p.id === 'bvlos-tieu-khu-b') add('Ghi chú', 'Chờ ý kiến của Công ty Quản lý bay miền Trung và Sư đoàn Không quân 372');
  if (p.id === 'bvlos-tieu-khu-a') add('Điều kiện', 'Ban ngày, khí tượng bay bằng mắt, kế hoạch bay cấp phép từng đợt');
  if (p.layer === 'qd4167') add('Độ cao', 'Chưa có trần độ cao trong hồ sơ');
  if (p.buffer_m) add('Vùng đệm', `${p.buffer_m} m mỗi bên`);
  if (p.elev_m && !p.icao) add('Độ cao', `${p.elev_m} m so với mực nước biển`);
  if (p.icao) add('Mã sân bay', `${p.icao} / ${p.iata}`), add('Cao độ', `${p.elev_m} m`);
  if (p.id === 'bvlos-tong-the') add('Xã', state.labels.bvlosArea);
  if (p.id.startsWith('son-tra')) add('Cự ly tham khảo đến sân bay', 'từ 8,9 km đến 16,6 km (biên bản khảo sát)');
  if (p.note) add('Ghi chú', esc(p.note));
  const vs = vertexNames(f);
  const lineNames = p.id === 'dcc-17r-35l' ? ['Đầu 35L', 'Đầu 17R'] : null;
  if (lineNames) vs.length = 0, g.coordinates.forEach((c, i) => vs.push({ name: lineNames[i], lon: c[0], lat: c[1] }));
  const vrows = vs.map((v) => `<tr><td>${esc(v.name)}</td><td>${dec(v.lat)}<br>${dec(v.lon)}</td><td>${dms(v.lat, true)}<br>${dms(v.lon, false)}</td></tr>`).join('');
  const src = state.sources.find((s) => s.id === p.source);
  const html = `${head}<div class="rows">${rows.join('')}</div>
    <h4>${isPoly || g.type === 'LineString' ? 'Đỉnh' : 'Tọa độ'} <small>(vĩ độ, kinh độ · WGS-84)</small></h4>
    <table class="vt"><thead><tr><th></th><th>Độ thập phân</th><th>Độ-phút-giây</th></tr></thead><tbody>${vrows}</tbody></table>
    <div class="btns"><button class="btn small" id="cp">Sao chép tọa độ</button><button class="btn small" id="ge">Mở trong Google Earth (KML)</button></div>
    <p class="src"><a href="#" data-src="1">Mô tả khu vực và căn cứ của Đề án</a></p>
    <p class="hint">Tọa độ là đề xuất của Đề án, chưa phải ranh giới được phép bay.</p>`;
  $('#detail-body').innerHTML = html;
  $('#detail').hidden = false;
  $('#cp').onclick = () => {
    const t = vs.map((v) => `${v.name}\t${v.lat.toFixed(6)}\t${v.lon.toFixed(6)}`).join('\n');
    navigator.clipboard?.writeText(t);
    $('#cp').textContent = 'Đã sao chép';
    setTimeout(() => ($('#cp').textContent = 'Sao chép tọa độ'), 1500);
  };
  $('#ge').onclick = () => download(`${p.id}.kml`, toKML([f], p.name), 'application/vnd.google-earth.kml+xml');
  $('[data-src]', $('#detail-body')).onclick = (e) => { e.preventDefault(); openAreas(areaOf(p.id)); };
  level('detail');
}
function clearHighlight() { if (state.hl) { map.removeLayer(state.hl); state.hl = null; } }
$('#detail-close').onclick = () => { $('#detail').hidden = true; clearHighlight(); };

// ---------- Mô tả các khu vực ----------
function renderAreas() {
  $('#sources-body').innerHTML = `<p class="areas-intro">Mô tả vị trí và mục đích của từng khu vực trên bản đồ, theo Đề án thí điểm phát triển kinh tế không gian tầm thấp (bản v20). Tọa độ và phạm vi là đề xuất của Đề án, chưa phải ranh giới được phép bay.</p>` +
    state.areas.map((a) => `<article class="area" id="area-${a.id}">
      <header><h3>${esc(a.name)}</h3>${a.status ? `<span class="badge">${esc(a.status)}</span>` : ''}<button class="btn small" data-goto="${a.id}">Xem trên bản đồ</button></header>
      <dl><dt>Vị trí</dt><dd>${esc(a.location)}</dd><dt>Dùng để làm gì</dt><dd>${esc(a.purpose)}</dd><dt>Giới hạn và điều kiện</dt><dd>${esc(a.limits)}</dd><dt>Căn cứ</dt><dd>${esc(a.basis)}</dd></dl>
    </article>`).join('');
  $$('#sources-body [data-goto]').forEach((b) => (b.onclick = () => {
    const a = state.areas.find((x) => x.id === b.dataset.goto);
    $('#dlg-sources').close();
    a.layers.forEach(ensureOn);
    const bb = boundsOf2(a);
    if (bb.isValid()) flyTo(bb, 14); else map.flyToBounds(CITY);
    const f = a.features[0] && state.feats[a.features[0]]?.f;
    if (f) showDetail(f);
    level('area');
    if (v3) $('#btn-3d').click();
  }));
}
function boundsOf2(a) {
  const b = L.latLngBounds([]);
  a.features.forEach((id) => state.feats[id] && b.extend(L.geoJSON(state.feats[id].f).getBounds()));
  if (a.id === 'bvlos') b.extend(boundsOf(['bvlos']));
  if (a.id === 'san-bay') return L.circle([DAD.lat, DAD.lon], { radius: 15500 }).getBounds();
  return b;
}
const areaOf = (fid) => state.areas.find((a) => a.features.includes(fid))?.id || (fid === 'bvlos-tong-the' ? 'bvlos' : null);
function openAreas(id) {
  const d = $('#dlg-sources');
  if (!d.open) d.showModal();
  $$('#sources-body .area').forEach((r) => r.classList.remove('flash'));
  const row = id && $(`#area-${id}`);
  if (row) { row.classList.add('flash'); row.scrollIntoView({ block: 'start' }); } else $('#dlg-sources').scrollTop = 0;
}
$('#btn-sources').onclick = () => openAreas();
$('#dlg-sources [data-close]').onclick = () => $('#dlg-sources').close();
$('#dlg-sources').addEventListener('click', (e) => { if (e.target.id === 'dlg-sources') e.target.close(); });

// ---------- Công cụ ----------
const toolLayer = L.featureGroup().addTo(map);
let pts = [];
const out = $('#tool-out');
const HELP = { check: 'Bấm lên bản đồ hoặc nhập tọa độ ở ô tìm để kiểm tra vị trí.', draw: 'Bấm các đỉnh; bấm đúp hoặc nút "Xong" để kết thúc.', measure: 'Bấm hai điểm để đo khoảng cách.' };

function renderTool(res) {
  if (!state.tool) { out.hidden = true; out.innerHTML = ''; return; }
  const extra = state.tool === 'draw' ? '<button class="btn small" data-act="undo">↶ Hoàn tác đỉnh</button><button class="btn small" data-act="done">✓ Xong</button>' : '';
  out.hidden = false;
  out.innerHTML = `<div>${res || `<p>${HELP[state.tool]}</p>`}</div><div class="btns tbar">${extra}<button class="btn small danger" data-act="clear">🗑 Xóa</button></div>`;
}
function clearTool() { toolLayer.clearLayers(); pts = []; state.drawDone = false; renderTool(); }
out.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]')?.dataset.act;
  if (a === 'clear') clearTool();
  else if (a === 'undo') { state.drawDone = false; pts.pop(); drawPreview(); }
  else if (a === 'done') finishDraw();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.tool) clearTool(); });

function setTool(t) {
  state.tool = state.tool === t ? null : t;
  $$('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === state.tool));
  toolLayer.clearLayers(); pts = []; state.drawDone = false;
  map.getContainer().classList.toggle('crosshair', !!state.tool);
  if (state.tool === 'draw') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  renderTool();
}
$$('.tool').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));

function checkPoint(lat, lon) {
  toolLayer.clearLayers();
  L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#0a84ff', fillOpacity: 1, pane: 'p-tools' }).addTo(toolLayer);
  const pt = turf.point([lon, lat]);
  const hits = [];
  for (const fc of Object.values(state.data)) for (const f of fc.features) {
    if (f.geometry.type === 'Polygon' && turf.booleanPointInPolygon(pt, f)) hits.push(f.properties);
  }
  const d = turf.distance(pt, turf.point([DAD.lon, DAD.lat]), { units: 'kilometers' });
  const list = hits.length ? hits.map((p) => {
    const lim = [p.agl_max_m && `≤ ${p.agl_max_m} m so với mặt đất`, p.amsl_max_m && `≤ ${p.amsl_max_m} m so với mực nước biển`].filter(Boolean).join('; ');
    return `<li><b>${esc(p.name)}</b>${lim ? `<br>Giới hạn độ cao: ${lim}` : ''}</li>`;
  }).join('') : '<li>Điểm không nằm trong vùng nào của Đề án.</li>';
  renderTool(`<p><b>${dec(lat)}, ${dec(lon)}</b><br>${dms(lat, true)} ${dms(lon, false)}</p><ul>${list}</ul><p>Cách điểm quy chiếu sân bay: <b>${fmt(d, 2)} km</b></p><p class="hint">${WARN}</p>`);
  return hits;
}

function mapClick(ll) {
  if (state.tool === 'check') checkPoint(ll.lat, ll.lng);
  else if (state.tool === 'measure') {
    if (pts.length >= 2) { toolLayer.clearLayers(); pts = []; }
    pts.push(ll);
    L.circleMarker(ll, { radius: 5, color: '#fff', fillColor: '#ff8a00', fillOpacity: 1, pane: 'p-tools' }).addTo(toolLayer);
    if (pts.length === 2) {
      L.polyline(pts, { color: '#ff8a00', weight: 3, pane: 'p-tools' }).addTo(toolLayer);
      const m = turf.distance([pts[0].lng, pts[0].lat], [pts[1].lng, pts[1].lat], { units: 'meters' });
      renderTool(`<p>Khoảng cách: <b>${m >= 1000 ? fmt(m / 1000, 3) + ' km' : fmt(m, 1) + ' m'}</b></p>`);
    } else renderTool('<p>Bấm điểm thứ hai.</p>');
  } else if (state.tool === 'draw') {
    if (state.drawDone) { toolLayer.clearLayers(); pts = []; state.drawDone = false; }
    pts.push(ll);
    drawPreview();
  }
}
function drawPreview() {
  toolLayer.clearLayers();
  if (pts.length > 1) (state.drawDone ? L.polygon : L.polyline)(pts, { color: '#ff8a00', weight: 3, fillOpacity: 0.2, pane: 'p-tools' }).addTo(toolLayer);
  pts.forEach((p) => L.circleMarker(p, { radius: 4, color: '#fff', fillColor: '#ff8a00', fillOpacity: 1, pane: 'p-tools' }).addTo(toolLayer));
  if (state.drawDone) return;
  if (pts.length >= 3) {
    const a = turf.area(turf.polygon([[...pts, pts[0]].map((p) => [p.lng, p.lat])]));
    renderTool(`<p>${pts.length} đỉnh · diện tích tạm tính ${fmt(a / 1e6, 3)} km²</p>`);
  } else renderTool(`<p>${pts.length ? pts.length + ' đỉnh. ' : ''}${HELP.draw}</p>`);
}
function finishDraw() {
  if (state.tool !== 'draw' || pts.length < 3) return;
  state.drawDone = true;
  drawPreview();
  const poly = turf.polygon([[...pts, pts[0]].map((p) => [p.lng, p.lat])]);
  const a = turf.area(poly), per = turf.length(turf.polygonToLine(poly), { units: 'kilometers' });
  renderTool(`<p>Diện tích: <b>${fmt(a / 1e6, 3)} km²</b> (${fmt(a / 1e4, 2)} ha)<br>Chu vi: <b>${fmt(per, 3)} km</b></p><table class="vt"><tbody>${pts.map((p, i) => `<tr><td>${i + 1}</td><td>${dec(p.lat)}, ${dec(p.lng)}</td></tr>`).join('')}</tbody></table>`);
}
map.on('click', (e) => state.tool && mapClick(e.latlng));
map.on('dblclick', () => { if (state.tool === 'draw' && !state.drawDone) { pts.pop(); finishDraw(); } });


// ---------- Tìm kiếm ----------
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
$('#search-form').onsubmit = (e) => {
  e.preventDefault();
  const q = $('#search').value.trim();
  const msg = $('#search-msg');
  msg.textContent = '';
  if (!q) return;
  const c = parseCoord(q);
  if (c) {
    if (c.lat < 15.3 || c.lat > 16.3 || c.lon < 107.7 || c.lon > 108.7) msg.textContent = 'Tọa độ nằm ngoài khu vực Thành phố Đà Nẵng của bản đồ.';
    map.flyTo([c.lat, c.lon], 14, { duration: 0.8 });
    if (state.tool !== 'check') setTool('check');
    checkPoint(c.lat, c.lon);
    return;
  }
  const hit = Object.values(state.feats).find(({ f }) => norm(f.properties.name).includes(norm(q)));
  if (hit) {
    flyTo(hit.lyr.getBounds ? hit.lyr.getBounds() : L.latLngBounds([hit.lyr.getLatLng()]), 14);
    showDetail(hit.f);
  } else msg.textContent = 'Không đọc được tọa độ và không tìm thấy địa danh trùng khớp.';
};

// ---------- Đi tới ----------
function flyTo(b, maxZoom = 15) { map.flyToBounds(b, { padding: [40, 40], maxZoom, duration: 0.9 }); }
const boundsOf = (ids) => {
  const b = L.latLngBounds([]);
  ids.forEach((id) => state.data[id]?.features.forEach((f) => b.extend(L.geoJSON(f).getBounds())));
  return b;
};
function ensureOn(id) { const c = $(`#chk-${id}`); if (c && !c.checked) { c.checked = true; syncVisibility(); } }
function gotoTargets() {
  const t = [
    ['Toàn Thành phố', () => { level('city'); map.flyToBounds(CITY, { duration: 0.9 }); }],
    ['Khu BVLOS (xã Bà Nà)', () => { level('area'); ['bvlos', 'bvlos_diem', 'kcnc'].forEach(ensureOn); flyTo(boundsOf(['bvlos', 'kcnc'])); }],
    ['Khu công nghệ cao', () => { level('area'); flyTo(boundsOf(['kcnc']), 15); }],
    ['Sơn Trà', () => { level('area'); flyTo(boundsOf(['son_tra']), 14); }],
    ['Sân bay Đà Nẵng', () => { level('area'); ensureOn('san_bay'); flyTo(L.circle([DAD.lat, DAD.lon], { radius: 15500 }).getBounds()); }],
    ['Hòa Vang', () => {
      level('area');
      if (state.data.hoa_vang.features.length) { ensureOn('hoa_vang'); flyTo(boundsOf(['hoa_vang'])); $('#search-msg').textContent = ''; }
      else { map.flyToBounds(CITY); $('#search-msg').textContent = `Hòa Vang: ${state.labels.hoaVangPlaces.join('; ')}. ${state.labels.hoaVangNote}`; }
    }],
  ];
  state.data.qd4167.features.forEach((f) => t.push([f.properties.name.split(' – ')[0] + ' (QĐ 4167)', () => { level('area'); flyTo(L.geoJSON(f).getBounds(), 13); showDetail(f); }]));
  return t;
}
$$('#levels button').forEach((b) => (b.onclick = () => {
  if (b.dataset.level === 'city') gotoTargets()[0][1]();
  else if (b.dataset.level === 'area') gotoTargets()[1][1]();
  else level('detail');
}));

// ---------- Giao diện ----------
function buildSidebar() {
  const m = state.manifest;
  const nen = `<div class="grp"><h3>Nền</h3>${[['sat', 'Vệ tinh'], ['topo', 'Địa hình']].map(([v, n]) => `<label><input type="radio" name="base" value="${v}" ${v === 'sat' ? 'checked' : ''}> ${n}</label>`).join('')}</div>`;
  const grp = m.groups.filter((g) => g.id !== 'nen').map((g) => `<div class="grp"><h3>${g.name}</h3>${m.layers.filter((l) => l.group === g.id).sort((a, b) => a.order - b.order).map((l) => {
    const dots = l.id === 'bvlos' ? `<i class="dot" style="background:#D01E1E"></i>` : `<i class="dot" style="background:${l.color}"></i>`;
    return `<label>${dots}<input type="checkbox" id="chk-${l.id}" ${l.default ? 'checked' : ''}> ${l.name}</label>`;
  }).join('')}</div>`).join('');
  $('#layers').innerHTML = nen + grp;
  $$('#layers input[type=checkbox]').forEach((c) => c.addEventListener('change', syncVisibility));
  $$('input[name=base]').forEach((r) => r.addEventListener('change', () => setBase(r.value)));
  $('#goto').innerHTML = '';
  gotoTargets().forEach(([n, fn]) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = n; b.onclick = () => { fn(); if (innerWidth < 800) document.body.classList.remove('side-open'); };
    $('#goto').append(b);
  });
  $('#legend').innerHTML = `<b>Chú giải</b>
    <div><i class="sw" style="border:3px solid #D01E1E"></i>Khu BVLOS (P1–P6)</div>
    <div><i class="sw" style="background:#2E9A3C99"></i>Tiểu khu A</div>
    <div><i class="sw" style="background:#E0781499"></i>Tiểu khu B</div>
    <div><i class="sw" style="background:#8A3CA099"></i>Khu huấn luyện – Khu CNC</div>
    <div><i class="sw" style="background:#2A6FD066"></i>4 khu vực QĐ 4167</div>
    <div><i class="dot" style="background:#D02020"></i>Vùng xanh Sơn Trà (đệm 100 m)</div>
    <div><i class="sw" style="font-style:normal;text-align:center;line-height:10px">★</i>Sân bay Đà Nẵng</div>
    <div><i class="sw" style="color:#F2B705;text-align:center;line-height:10px">▲</i>Bà Nà Hills</div>
    <div><i class="sw" style="border-top:2px dashed #888;height:0"></i>Vòng 15 km (minh họa)</div>`;
}

$('#opacity').oninput = (e) => state.polyBase.forEach((l) => l.setStyle({ fillOpacity: l.options.baseFill * +e.target.value }));
$('#btn-menu').onclick = () => { document.body.classList.toggle(innerWidth < 800 ? 'side-open' : 'side-closed'); setTimeout(() => map.invalidateSize(), 250); };
$('#btn-theme').onclick = () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  localStorage.setItem('theme', t);
};
document.documentElement.dataset.theme = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

$('#btn-export').onclick = (e) => { e.stopPropagation(); $('#export-menu').hidden = !$('#export-menu').hidden; };
document.addEventListener('click', () => ($('#export-menu').hidden = true));
$$('#export-menu button').forEach((b) => (b.onclick = () => {
  const [fmtName, scope] = b.dataset.exp.split('-');
  const ids = scope === 'all' ? state.manifest.layers.map((l) => l.id) : state.manifest.layers.filter((l) => $(`#chk-${l.id}`).checked).map((l) => l.id);
  const features = ids.flatMap((id) => state.data[id].features);
  const base = scope === 'all' ? 'ktkgtt_da_nang' : 'ktkgtt_lop_dang_bat';
  if (fmtName === 'geojson') download(`${base}.geojson`, JSON.stringify({ type: 'FeatureCollection', features }, null, 1), 'application/geo+json');
  else download(`${base}.kml`, toKML(features), 'application/vnd.google-earth.kml+xml');
}));
const prep = () => { $('#print-date').textContent = `Ngày in: ${new Date().toLocaleDateString('vi-VN')}`; map.invalidateSize(); };
window.addEventListener('beforeprint', prep);
$('#btn-print').onclick = () => {
  document.body.classList.add('printing');
  prep();
  setTimeout(() => map.invalidateSize(), 100);
  setTimeout(() => window.print(), 2200);
};
window.addEventListener('afterprint', () => { document.body.classList.remove('printing'); map.invalidateSize(); });
map.on('zoomend', syncVisibility);

// ---------- Khởi động ----------
(async () => {
  const [manifest, sources, labels, areas] = await Promise.all([json('/data/manifest.json'), json('/data/sources.json'), json('/data/labels.json'), json('/data/areas.json')]);
  Object.assign(state, { manifest, sources, labels, areas });
  $('#notice-text').textContent = `Lưu ý sử dụng: ${labels.notice}`;
  const fcs = await Promise.all(manifest.layers.map((l) => json(`/data/${l.file}`)));
  manifest.layers.forEach((l, i) => { state.data[l.id] = fcs[i]; });
  manifest.layers.forEach((l) => { state.groups[l.id] = buildLayer(l, state.data[l.id]); });
  buildSidebar();
  renderAreas();
  syncVisibility();
  level('city');
  window.__map = map;
})();

// ---------- Chế độ 3D ----------
let v3 = null;
$('#btn-3d').onclick = async () => {
  const b = $('#btn-3d');
  if (v3) {
    const { center, zoom } = v3.view();
    v3.destroy(); v3 = null;
    $('#map3d').hidden = true; $('#ctl3d').hidden = true; $('#map').style.visibility = ''; $('#basemaps').hidden = false;
    map.setView(center, Math.min(zoom + 1, 19), { animate: false });
    b.textContent = 'Xem 3D'; b.classList.remove('on');
    return;
  }
  b.disabled = true;
  const { open3D } = await import('./view3d.js');
  b.disabled = false;
  const c = map.getCenter();
  $('#map3d').hidden = false; $('#ctl3d').hidden = false; $('#basemaps').hidden = true;
  $('#map').style.visibility = 'hidden';
  v3 = open3D({ el: 'map3d', data: state.data, manifest: state.manifest, center: map.getZoom() < 11 ? [108.0, 16.05] : [c.lng, c.lat], zoom: map.getZoom() < 11 ? 12.3 : map.getZoom(), onPick: (id) => state.feats[id] && showDetail(state.feats[id].f) });
  window.__m3 = v3.map;
  b.textContent = 'Về 2D'; b.classList.add('on');
};
$('#exag').oninput = (e) => v3?.setExaggeration(+e.target.value);
$('#ceil').oninput = (e) => v3?.setCeilingOpacity(+e.target.value);
