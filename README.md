# Bản đồ kinh tế không gian tầm thấp – Thành phố Đà Nẵng

Trang tĩnh (Vite + Leaflet + Turf). Nền vệ tinh Esri, địa hình OpenTopoMap, đường OpenStreetMap; không cần khóa API.

## Chạy và build
    npm install
    npm run dev
    npm run build      # kiểm tra dữ liệu rồi build ra dist/

## Cập nhật dữ liệu từ Google Earth Pro
1. Vẽ vùng trong Google Earth Pro, đặt tên (ví dụ "hoa-vang-hoa-phu"), Save Place As -> .kml.
2. Đặt tệp vào `data-src/kml/`.
3. `npm run build:data` (chuyển sang `public/data/hoa_vang.geojson`, in diện tích, chu vi, kiểm tra hợp lệ).
4. Đẩy mã lên Git; Vercel tự triển khai.

Nhãn hành chính sửa trong `public/data/labels.json`; nguồn trong `public/data/sources.json`.
