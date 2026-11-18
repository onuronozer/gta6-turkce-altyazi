# Ekran Çevirmen

iPhone Safari'de çalışan, TV'deki İngilizce oyun altyazılarını kamerayla okuyup
Türkçeye çeviren ve isteğe bağlı seslendiren GitHub Pages uygulaması.

## GitHub Pages'te yayınlama

1. Bu klasörü yeni bir GitHub deposuna gönderin.
2. Depoda **Settings → Pages → Source** bölümünü **GitHub Actions** yapın.
3. `main` veya `master` dalına gönderim yapıldığında uygulama otomatik yayınlanır.
4. Verilen `https://kullanici.github.io/depo/` adresini iPhone Safari'de açın.
5. Safari paylaş menüsünden **Ana Ekrana Ekle** seçeneğini kullanın.

## Kullanım

1. Telefonu yatay çevirip **Kamerayı başlat** düğmesine dokunun.
2. Kamera iznini verin ve telefonu TV'ye sabitleyin.
3. GTA VI'da İngilizce altyazıları açın.
4. Sarı tarama alanını ayarlar düğmesiyle altyazının üzerine getirin.
5. Hoparlör düğmesi Türkçe seslendirmeyi açıp kapatır.

OCR, iPhone üzerinde Tesseract.js ile çalışır. Kamera görüntüsü yüklenmez. Algılanan
kısa İngilizce metin çeviri için MyMemory API'ye gönderilir. Servisin kullanım
limiti veya geçici kesintisi olursa çeviri durabilir.

## Hız ve doğrulama

İlk okunabilir OCR sonucu hemen çevrilir ve **Kontrol ediliyor** etiketiyle
gösterilir. Uygulama sonraki kamera karelerini taramaya devam eder; daha güvenilir
veya daha tamamlanmış bir metin bulursa mevcut Türkçe altyazıyı otomatik düzeltir.
Eski çeviri istekleri yeni diyaloğun üzerine yazamaz.
