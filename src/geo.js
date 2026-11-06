export const fmt = (n, d = 2) => Number(n).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
export const dec = (n) => Number(n).toLocaleString('vi-VN', { minimumFractionDigits: 6, maximumFractionDigits: 6 });

export function dms(v, isLat) {
  const h = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
  v = Math.abs(v);
  let d = Math.floor(v), m = Math.floor((v - d) * 60), s = ((v - d) * 60 - m) * 60;
  s = Math.round(s * 100) / 100;
  if (s >= 60) { s = 0; m++; }
  if (m >= 60) { m = 0; d++; }
  return `${d}°${String(m).padStart(2, '0')}'${fmt(s, 2).padStart(5, '0')}"${h}`;
}

// Trả về {lat, lon} hoặc null. Hỗ trợ độ thập phân (dấu chấm hoặc phẩy) và độ-phút-giây.
export function parseCoord(str) {
  const s = str.trim();
  const re = /(\d+)\s*[°º]\s*(\d+)?\s*['′’]?\s*(\d+(?:[.,]\d+)?)?\s*["″”]?\s*([NSEWnsew])/g;
  const m = [...s.matchAll(re)];
  if (m.length === 2) {
    const conv = (x) => {
      const v = +x[1] + (+(x[2] || 0)) / 60 + (+((x[3] || '0').replace(',', '.'))) / 3600;
      return /[SWsw]/.test(x[4]) ? -v : v;
    };
    let a = conv(m[0]), b = conv(m[1]);
    const latFirst = /[NSns]/.test(m[0][4]);
    return latFirst ? { lat: a, lon: b } : { lat: b, lon: a };
  }
  const nums = s.match(/-?\d+(?:[.,]\d+)?/g);
  if (nums && nums.length === 2) {
    let [a, b] = nums.map((x) => parseFloat(x.replace(',', '.')));
    if (Math.abs(a) > 90) [a, b] = [b, a];
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
  }
  return null;
}

const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const ring = (r) => r.map((c) => `${c[0]},${c[1]},0`).join(' ');

function geomKml(g) {
  if (g.type === 'Point') return `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]},0</coordinates></Point>`;
  if (g.type === 'LineString') return `<LineString><tessellate>1</tessellate><coordinates>${ring(g.coordinates)}</coordinates></LineString>`;
  if (g.type === 'Polygon') return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(g.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs>${g.coordinates.slice(1).map((h) => `<innerBoundaryIs><LinearRing><coordinates>${ring(h)}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`;
  if (g.type === 'MultiPolygon') return `<MultiGeometry>${g.coordinates.map((p) => geomKml({ type: 'Polygon', coordinates: p })).join('')}</MultiGeometry>`;
  return '';
}

export function toKML(features, docName = 'Bản đồ KTKGTT Đà Nẵng') {
  const body = features.map((f) => {
    const p = f.properties || {};
    const desc = Object.entries(p).filter(([k]) => !['id', 'name'].includes(k)).map(([k, v]) => `${k}: ${v}`).join('\n');
    return `<Placemark><name>${esc(p.name)}</name><description>${esc(desc)}</description><Style><LineStyle><color>ff1e1ed0</color><width>2</width></LineStyle><PolyStyle><color>553030d0</color></PolyStyle></Style>${geomKml(f.geometry)}</Placemark>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(docName)}</name>\n${body}\n</Document></kml>`;
}

export function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
