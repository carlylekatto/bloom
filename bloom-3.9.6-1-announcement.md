## 🌸 Bloom — bản `3.9.6-1` (bản test nội bộ)

Bản này **thêm khá nhiều thứ**, và một thứ **đổi hành vi mặc định**. Đọc phần "Đọc trước" nhé.

| | |
|---|---|
| **Phiên bản** | `3.9.6-1` |
| **Dung lượng** | `16.74` MB |
| **SHA256** | `05A74E8CE512BF7E232FDC1699F279030C63C43CFBB7BD4374EE8909A9E1DF9F` |

---

## ⚠️ Đọc trước khi cài

### 1. Thoát Bloom trước khi gỡ bản cũ
Bloom đang **ẩn taskbar Windows**. Nếu gỡ khi app còn chạy mà nó không kịp trả taskbar về, bạn sẽ mất taskbar và phải vào Task Manager để gỡ.

Chuột phải icon Bloom trên tray → **Quit Bloom**.

Lỡ gỡ rồi mà mất taskbar: `Win+R` → `cmd` → `taskkill /f /im bloom.exe` → Enter.

### 2. Gỡ bản cũ, đừng cài đè
**Gỡ hẳn rồi cài lại.**

### 3. Tắt tự cập nhật
Bản test đang trỏ updater về release của tác giả gốc. Bật tự cập nhật thì Bloom có thể tự tải bản gốc về thay bản này. Vào **Settings** và tắt **Auto update**.

### 4. Wi-Fi và Bluetooth mới, chưa ai test đầy đủ
Phần này lấy nguyên từ [PR #201](https://github.com/SehajveerSingh2005/bloom/pull/201) của tác giả khác đóng góp, và **cả tác giả lẫn người build đều chưa test được** mấy case này:

- nối mạng mới có mật khẩu
- bật/tắt tai nghe Bluetooth
- ghép nối thiết bị có PIN
- thông báo khi thiếu quyền vị trí (Windows 11 24H2 chặn quét mạng)

Còn lại thì chạy bình thường. Nếu Wi-Fi đang là thứ bạn cần dùng hằng ngày thì cứ bỏ qua, phần này không ảnh hưởng gì.

---

## 🆕 Thêm mới

### 📶 Wi-Fi trong notch
Một ô mới cạnh Bluetooth. Thấy được mạng nào đang phát, mạng nào đang kết nối, mạng nào có sẵn trong máy.

- Bấm mạng đã lưu để kết nối luôn
- Mạng mới thì gõ mật khẩu **ngay trong notch**
- Mạng có ký hiệu ổ khoá 🔒 là cần mật khẩu; có dấu ⚠ là mạng công cộng
- Nối bằng mật khẩu sai thì báo sai mật khẩu, **không** để lại mạng hỏng trong danh sách
- Mạng cần xác thực (802.1X, WEP) thì chuyển sang Settings của Windows, không tự xử lý

### 🔵 Bluetooth trong notch
Thấy thiết bị đã ghép, có trạng thái kết nối và pin. Bật/tắt kết nối tai nghe và loa. Ghép thiết bị mới bằng PIN trả lời trong notch.

Thiết bị ghép bằng cả Classic lẫn LE được gộp thành một dòng. Thiết bị không phải tai nghe/loa thì chỉ hiện trạng thái và nút Remove — vì Windows không có API công khai để kết nối chúng.

### 🗂 Shelf xem trước mọi loại file
Shelf trước chỉ xem trước được ảnh. Giờ xem được:

- **PDF** — render bằng Windows
- **Office / LibreOffice** — lấy ảnh thumbnail bên trong file
- **Video, font** — lấy qua provider của Explorer
- **Tài liệu, bảng tính, file code** — hiện phần mở đầu nội dung

File không xem trước được thì hiện **icon theo loại file**, không phải ô trống.

### ↕️ Shelf cuộn được
Trước đó chỉ 3 ô đầu là chạm được. Giờ phần còn lại cuộn được, có thanh cuộn mảnh hiện ra khi tràn — để biết là còn món nữa.

### 💡 Độ sáng chỉnh từng màn hình
Thanh độ sáng nay nói chung cho mọi màn. Giờ có thể chỉnh riêng từng màn:

- Bấm **icon màn hình nhỏ** cạnh thanh độ sáng
- Mỗi màn một dòng riêng, tên model hiện khi rê chuột vào

⚠️ Chỉ màn nào hỗ trợ **DDC/CI** mới chỉnh được. Màn laptop thường không có, nên nếu bạn dùng laptop thì có thể thấy 1 màn hoặc không thấy icon.

### 🎛️ App trong tray — tắt mặc định
App nào tự thu mình vào tray Windows giờ **không** hiện trong dock nữa. Đây là hành vi mặc định mới, khác bản trước.

Lý do: chuột phải vào app đó sẽ mở **menu tray của Windows**, trong đó có mục *"Thoát"* — bấm nhầm là mất app. Muốn trả lại hành vi cũ: **Settings → Dock → "Tray Apps in Dock"**.

### 🗑 Menu chuột phải cho dock extras
Chuột phải vào icon Thùng rác, ổ đĩa hay thư mục trong dock, trước chỉ có "Open". Giờ thêm:

| Mục | Áp dụng cho |
|---|---|
| **Show in File Explorer** | ổ đĩa, thư mục — mở thư mục cha và chọn sẵn món đó |
| **Copy Path** | tất cả — copy đường dẫn vào clipboard |
| **Empty Recycle Bin** | thùng rác — **có hỏi lại trước**, không hoàn tác được |

Mục Eject vẫn có cho ổ USB và ổ đĩa, Remove from Dock vẫn có cho thư mục tự thêm.

### 🐛 Sửa lỗi dock và tray

**Menu tray mở đúng chỗ bấm.** Trước đó app mở menu tray tại icon thông báo của nó — mà icon đó nằm ở góc taskbar đang bị Bloom giấu. Nên bấm chuột phải vào app trong dock thì menu cứ nhảy về **góc phải dưới màn hình**. Giờ nó mở ngay cạnh icon, và giữ đúng màn hình bạn đang bấm.

**Bấm app đã cài dạng MSIX giờ chạy được.** Claude, WhatsApp và các app đóng gói khác trước đây bấm vào **không làm gì cả**, vì Bloom đoán sai ID. Giờ tra đúng ID thật trong Windows.

**Tên app đúng như Start menu.** Trước là tên file nội bộ: *"WhatsApp.Root"*, *"localsend_app"*, *"AppleMusic"*. Giờ lấy đúng tên Start menu hiện. App bạn ghim sẵn cũng được sửa lại tên một lần nữa.

**App tray không có tên không còn bị từ chối.** Một số app không đặt tooltip cho icon tray, hoặc đăng ký lại sau khi Explorer khởi động — trước đó mọi thao tác trên icon đó đều báo lỗi *"Windows returned an unnamed tray icon"*. Giờ vẫn chạy, vẫn kiểm tra đúng app không bị nhầm.

---

## 🐞 Sửa

**Thanh độ sáng dài hơn thanh volume** trên máy chỉ có 1 màn. Lệch 28px, số % bị lệch sang phải. Giờ hai thanh bằng nhau.

*(Lỗi này chỉ thấy ở máy 1 màn — máy nhiều màn chỉ lệch 2px nên gần như không ai để ý.)*

---

## 📥 Cách cài

1. Chuột phải file `.msi` → **Properties** → tick **"Unblock"** ở cuối → OK
   *(bắt buộc — file tải qua Discord sẽ bị Windows chặn)*
2. Nhấp đúp để cài
3. Thấy cảnh báo *"Windows protected your PC"* → **More info** → **Run anyway**
   *(bản này chưa ký chứng thư, nên Windows cảnh báo là đúng)*

Xác nhận cài xong: **Settings → About** phải hiện `Currently running v3.9.6-1`.

---

## ❓ Câu hỏi thường gặp

**Máy không có WebView2 thì sao?**
Không cần làm gì, bộ cài tự tải về.

**Cài có mất cấu hình cũ không?**
Bản này dùng chung identifier với bản chính thức, nếu từng cài Bloom chính thức thì `settings.json` dùng chung và sẽ bị ghi đè.

**Mất taskbar sau khi gỡ?**
Xem mục 1 ở trên — lệnh `taskkill /f /im bloom.exe`.

**Sao tự cập nhật không hoạt động?**
Đúng rồi, và đó là chủ ý. Bản nội bộ này không đẩy release lên kênh updater, nên nó không tự cập nhật gì cả. Cứ để yên.

**Sau khi cài bản này thì sao khi tác giả gốc ra bản mới?**
Các bản này là build nội bộ, không ai bảo trì sau đó. Nếu cần thì cài bản chính thức.

**Báo lỗi gì thì làm sao?**
Chụp màn hình lỗi + phiên bản Windows (Settings → System → About), gửi lại.