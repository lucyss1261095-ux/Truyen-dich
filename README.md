# Truyện Dịch (APK)

Dịch truyện Trung/Anh sang Việt trên điện thoại, kiểu Quick Translator.

- **Offline**: dịch bằng từ điển (Tên riêng > Cụm từ > Hán-Việt từng chữ). Nạp trực tiếp các file Names.txt, VietPhrase.txt, ChinesePhienAmWords.txt của Quick Translator.
- **Chạm một từ** để xem chữ gốc, nghĩa khác, Hán-Việt và sửa nghĩa. Mục sửa được lưu lại và ưu tiên cao nhất.
- **File lớn (hàng chục MB)**: tab Truyện, nhập file .txt, app tự tách chương (第N章, Chương N, Chapter N...). Đọc/dịch từng chương, nhớ chương đang đọc, hoặc "Dịch cả truyện ra file".
- **Dịch trang web**: dán link ở tab Dịch. App tự nhận mã hóa GBK/UTF-8, lấy phần chữ chính của truyện, và tìm nút "chương sau / chương trước" của trang để bạn chuyển trang bằng nút Trước/Sau. Trang cần đăng nhập hoặc tải nội dung bằng JavaScript thì không lấy được.
- **Từ điển Quick Translator**: tab Từ điển, nạp file .txt (VietPhrase, Names, ChinesePhienAmWords...), hoặc nạp cả thư mục nén thành .zip, hoặc dán link tải. App tự nhận loại theo tên file. File như IgnoredChinesePhrases, Pronouns chưa được hỗ trợ và sẽ bị bỏ qua.
- **Luật nhân (LuatNhan.txt)**: đảo trật tự câu kiểu Quick Translator, ví dụ `{0}的{1}={1} của {0}` đổi "我的书" thành "Sách của ta". Mỗi `{n}` khớp đúng một từ đã tách. Luật dài/cụ thể hơn được ưu tiên.
- **Kiểu dịch**: chọn VietPhrase hoặc Hán-Việt, bật/tắt Luật nhân, bật "Nhiều nghĩa" để hiện `[nghĩa1/nghĩa2]` ngay trong bản dịch. Đổi tùy chọn là dịch lại ngay.
- **Tối ưu bằng AI (cần mạng)**: tab AI, nhập Base URL + API key + tên model của dịch vụ tương thích OpenAI (FurAI nếu có endpoint này), hoặc dùng Google Gemini.

## Build APK bằng GitHub (không cần cài gì trên máy)

1. Tạo repo GitHub mới (private cũng được), đẩy toàn bộ thư mục này lên.
2. Vào tab **Actions** > **Build APK** > **Run workflow**.
3. Chờ vài phút, tải file `TruyenDich-apk` ở mục **Artifacts**, giải nén ra `app-debug.apk`.
4. Chép vào điện thoại, mở file để cài (cho phép "cài từ nguồn không rõ").

## Build trên máy tính

Cần Node 20, JDK 17, Android SDK.

```
npm install
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```
APK nằm ở `android/app/build/outputs/apk/debug/app-debug.apk`.

## Từ điển

Mỗi dòng `gốc=nghĩa1/nghĩa2`. Thư mục `mau/` chỉ là từ điển mẫu rất nhỏ để thử. Để dịch tốt, hãy nạp từ điển đầy đủ trong tab **Từ điển**.
