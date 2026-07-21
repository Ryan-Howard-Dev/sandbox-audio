/**
 * Patches feed page i18n keys and offline.feed copy across all locales.
 * Run: node scripts/patch-feed-i18n.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const FEED_PAGE = {
  en: {
    title: 'Feed',
    subtitle: 'New releases from your self-hosted Tier34 server when it is online.',
    loading: 'Loading feed…',
    offlineLabel: 'Feed unavailable',
    sections: { new: 'New updates', week: 'Last week', month: 'Last month' },
    empty: {
      title: 'Nothing new yet',
      message: 'When your Tier34 server indexes new releases, they will appear here.',
    },
  },
  zh: {
    title: '动态',
    subtitle: 'Tier34 服务器在线时，显示来自您自托管服务器的新发布。',
    loading: '正在加载动态…',
    offlineLabel: '动态不可用',
    sections: { new: '最新更新', week: '上周', month: '上月' },
    empty: {
      title: '暂无新内容',
      message: '当 Tier34 服务器索引到新发布时，它们会显示在这里。',
    },
  },
  es: {
    title: 'Feed',
    subtitle: 'Nuevos lanzamientos de tu servidor Tier34 autohospedado cuando está en línea.',
    loading: 'Cargando feed…',
    offlineLabel: 'Feed no disponible',
    sections: { new: 'Novedades', week: 'Última semana', month: 'Último mes' },
    empty: {
      title: 'Nada nuevo por ahora',
      message: 'Cuando tu servidor Tier34 indexe nuevos lanzamientos, aparecerán aquí.',
    },
  },
  pt: {
    title: 'Feed',
    subtitle: 'Novos lançamentos do seu servidor Tier34 auto-hospedado quando estiver online.',
    loading: 'Carregando feed…',
    offlineLabel: 'Feed indisponível',
    sections: { new: 'Novidades', week: 'Última semana', month: 'Último mês' },
    empty: {
      title: 'Nada de novo ainda',
      message: 'Quando o servidor Tier34 indexar novos lançamentos, eles aparecerão aqui.',
    },
  },
  ar: {
    title: 'التغذية',
    subtitle: 'إصدارات جديدة من خادم Tier34 المستضاف ذاتيًا عندما يكون متصلًا.',
    loading: 'جارٍ تحميل التغذية…',
    offlineLabel: 'التغذية غير متاحة',
    sections: { new: 'تحديثات جديدة', week: 'الأسبوع الماضي', month: 'الشهر الماضي' },
    empty: {
      title: 'لا جديد بعد',
      message: 'عندما يفهرس خادم Tier34 إصدارات جديدة، ستظهر هنا.',
    },
  },
  ru: {
    title: 'Лента',
    subtitle: 'Новые релизы с вашего сервера Tier34, когда он в сети.',
    loading: 'Загрузка ленты…',
    offlineLabel: 'Лента недоступна',
    sections: { new: 'Новое', week: 'На прошлой неделе', month: 'В прошлом месяце' },
    empty: {
      title: 'Пока ничего нового',
      message: 'Когда сервер Tier34 проиндексирует новые релизы, они появятся здесь.',
    },
  },
  de: {
    title: 'Feed',
    subtitle: 'Neue Veröffentlichungen von Ihrem selbst gehosteten Tier34-Server, wenn er online ist.',
    loading: 'Feed wird geladen…',
    offlineLabel: 'Feed nicht verfügbar',
    sections: { new: 'Neue Updates', week: 'Letzte Woche', month: 'Letzter Monat' },
    empty: {
      title: 'Noch nichts Neues',
      message: 'Wenn Ihr Tier34-Server neue Veröffentlichungen indexiert, erscheinen sie hier.',
    },
  },
  fr: {
    title: 'Fil',
    subtitle: 'Nouvelles sorties de votre serveur Tier34 auto-hébergé lorsqu\'il est en ligne.',
    loading: 'Chargement du fil…',
    offlineLabel: 'Fil indisponible',
    sections: { new: 'Nouveautés', week: 'Semaine dernière', month: 'Mois dernier' },
    empty: {
      title: 'Rien de nouveau pour l\'instant',
      message: 'Lorsque votre serveur Tier34 indexe de nouvelles sorties, elles apparaîtront ici.',
    },
  },
  ja: {
    title: 'フィード',
    subtitle: 'Tier34 サーバーがオンラインのとき、自己ホストサーバーからの新着リリースを表示します。',
    loading: 'フィードを読み込み中…',
    offlineLabel: 'フィードは利用できません',
    sections: { new: '新着', week: '先週', month: '先月' },
    empty: {
      title: 'まだ新着はありません',
      message: 'Tier34 サーバーが新しいリリースをインデックスすると、ここに表示されます。',
    },
  },
  ko: {
    title: '피드',
    subtitle: 'Tier34 서버가 온라인일 때 자체 호스팅 서버의 새 릴리스를 표시합니다.',
    loading: '피드 로딩 중…',
    offlineLabel: '피드를 사용할 수 없음',
    sections: { new: '새 업데이트', week: '지난주', month: '지난달' },
    empty: {
      title: '아직 새 항목 없음',
      message: 'Tier34 서버가 새 릴리스를 인덱싱하면 여기에 표시됩니다.',
    },
  },
  hi: {
    title: 'फ़ीड',
    subtitle: 'जब आपका Tier34 सर्वर ऑनलाइन हो, तो आपके स्व-होस्टेड सर्वर से नए रिलीज़ दिखाए जाते हैं।',
    loading: 'फ़ीड लोड हो रही है…',
    offlineLabel: 'फ़ीड उपलब्ध नहीं',
    sections: { new: 'नए अपडेट', week: 'पिछले सप्ताह', month: 'पिछले महीने' },
    empty: {
      title: 'अभी कुछ नया नहीं',
      message: 'जब आपका Tier34 सर्वर नए रिलीज़ इंडेक्स करेगा, वे यहाँ दिखाई देंगे।',
    },
  },
  id: {
    title: 'Feed',
    subtitle: 'Rilis baru dari server Tier34 yang Anda host sendiri saat server online.',
    loading: 'Memuat feed…',
    offlineLabel: 'Feed tidak tersedia',
    sections: { new: 'Pembaruan baru', week: 'Minggu lalu', month: 'Bulan lalu' },
    empty: {
      title: 'Belum ada yang baru',
      message: 'Saat server Tier34 mengindeks rilis baru, mereka akan muncul di sini.',
    },
  },
  tr: {
    title: 'Akış',
    subtitle: 'Tier34 sunucunuz çevrimiçi olduğunda kendi barındırdığınız sunucudan yeni yayınlar.',
    loading: 'Akış yükleniyor…',
    offlineLabel: 'Akış kullanılamıyor',
    sections: { new: 'Yeni güncellemeler', week: 'Geçen hafta', month: 'Geçen ay' },
    empty: {
      title: 'Henüz yeni bir şey yok',
      message: 'Tier34 sunucunuz yeni yayınları dizine eklediğinde burada görünecekler.',
    },
  },
  it: {
    title: 'Feed',
    subtitle: 'Nuove uscite dal tuo server Tier34 self-hosted quando è online.',
    loading: 'Caricamento feed…',
    offlineLabel: 'Feed non disponibile',
    sections: { new: 'Novità', week: 'Ultima settimana', month: 'Ultimo mese' },
    empty: {
      title: 'Niente di nuovo per ora',
      message: 'Quando il server Tier34 indicizza nuove uscite, appariranno qui.',
    },
  },
  nl: {
    title: 'Feed',
    subtitle: 'Nieuwe releases van je zelf-gehoste Tier34-server wanneer deze online is.',
    loading: 'Feed laden…',
    offlineLabel: 'Feed niet beschikbaar',
    sections: { new: 'Nieuwe updates', week: 'Vorige week', month: 'Vorige maand' },
    empty: {
      title: 'Nog niets nieuws',
      message: 'Wanneer je Tier34-server nieuwe releases indexeert, verschijnen ze hier.',
    },
  },
  pl: {
    title: 'Feed',
    subtitle: 'Nowe wydania z Twojego samodzielnie hostowanego serwera Tier34, gdy jest online.',
    loading: 'Ładowanie feedu…',
    offlineLabel: 'Feed niedostępny',
    sections: { new: 'Nowe aktualizacje', week: 'Ostatni tydzień', month: 'Ostatni miesiąc' },
    empty: {
      title: 'Na razie nic nowego',
      message: 'Gdy serwer Tier34 zaindeksuje nowe wydania, pojawią się tutaj.',
    },
  },
  vi: {
    title: 'Bảng tin',
    subtitle: 'Bản phát hành mới từ máy chủ Tier34 tự lưu trữ khi máy chủ trực tuyến.',
    loading: 'Đang tải bảng tin…',
    offlineLabel: 'Bảng tin không khả dụng',
    sections: { new: 'Cập nhật mới', week: 'Tuần trước', month: 'Tháng trước' },
    empty: {
      title: 'Chưa có gì mới',
      message: 'Khi máy chủ Tier34 lập chỉ mục bản phát hành mới, chúng sẽ xuất hiện ở đây.',
    },
  },
  th: {
    title: 'ฟีด',
    subtitle: 'รีลีสใหม่จากเซิร์ฟเวอร์ Tier34 ที่คุณโฮสต์เองเมื่อเซิร์ฟเวอร์ออนไลน์',
    loading: 'กำลังโหลดฟีด…',
    offlineLabel: 'ฟีดไม่พร้อมใช้งาน',
    sections: { new: 'อัปเดตใหม่', week: 'สัปดาห์ที่แล้ว', month: 'เดือนที่แล้ว' },
    empty: {
      title: 'ยังไม่มีอะไรใหม่',
      message: 'เมื่อเซิร์ฟเวอร์ Tier34 จัดทำดัชนีรีลีสใหม่ จะแสดงที่นี่',
    },
  },
  bn: {
    title: 'ফিড',
    subtitle: 'আপনার স্ব-হোস্টেড Tier34 সার্ভার অনলাইন থাকলে নতুন রিলিজ দেখায়।',
    loading: 'ফিড লোড হচ্ছে…',
    offlineLabel: 'ফিড উপলব্ধ নয়',
    sections: { new: 'নতুন আপডেট', week: 'গত সপ্তাহ', month: 'গত মাস' },
    empty: {
      title: 'এখনও কিছু নতুন নেই',
      message: 'আপনার Tier34 সার্ভার নতুন রিলিজ ইনডেক্স করলে সেগুলো এখানে দেখা যাবে।',
    },
  },
};

const OFFLINE_FEED = {
  en: {
    airGap: 'Air-gap mode blocks the feed. Turn it off in Settings, or run Tier34 on your local network.',
    noInternet: 'The feed needs your Tier34 server on the local network. Open Settings → Diagnostics to check server status.',
    offline: 'Turn on Tier34 in Settings → Addons, or open Diagnostics to check server status.',
  },
  zh: {
    airGap: '气隙模式会阻止动态。请在设置中关闭，或在本地网络运行 Tier34。',
    noInternet: '动态需要本地网络上的 Tier34 服务器。打开设置 → 诊断以检查服务器状态。',
    offline: '在设置 → 插件中开启 Tier34，或打开诊断以检查服务器状态。',
  },
  es: {
    airGap: 'El modo air-gap bloquea el feed. Desactívalo en Ajustes o ejecuta Tier34 en tu red local.',
    noInternet: 'El feed necesita tu servidor Tier34 en la red local. Abre Ajustes → Diagnósticos para comprobar el estado.',
    offline: 'Activa Tier34 en Ajustes → Complementos, o abre Diagnósticos para comprobar el estado del servidor.',
  },
  pt: {
    airGap: 'O modo air-gap bloqueia o feed. Desative em Configurações ou execute o Tier34 na rede local.',
    noInternet: 'O feed precisa do servidor Tier34 na rede local. Abra Configurações → Diagnósticos para verificar o status.',
    offline: 'Ative o Tier34 em Configurações → Complementos ou abra Diagnósticos para verificar o servidor.',
  },
  ar: {
    airGap: 'وضع العزل يحجب التغذية. أوقفه في الإعدادات أو شغّل Tier34 على شبكتك المحلية.',
    noInternet: 'التغذية تحتاج خادم Tier34 على الشبكة المحلية. افتح الإعدادات → التشخيص للتحقق من الحالة.',
    offline: 'فعّل Tier34 في الإعدادات → الإضافات، أو افتح التشخيص للتحقق من حالة الخادم.',
  },
  ru: {
    airGap: 'Режим air-gap блокирует ленту. Отключите в настройках или запустите Tier34 в локальной сети.',
    noInternet: 'Ленте нужен сервер Tier34 в локальной сети. Откройте Настройки → Диагностика для проверки статуса.',
    offline: 'Включите Tier34 в Настройки → Дополнения или откройте Диагностика для проверки сервера.',
  },
  de: {
    airGap: 'Air-Gap-Modus blockiert den Feed. In Einstellungen deaktivieren oder Tier34 im LAN starten.',
    noInternet: 'Der Feed benötigt Ihren Tier34-Server im LAN. Öffnen Sie Einstellungen → Diagnose für den Serverstatus.',
    offline: 'Tier34 unter Einstellungen → Add-ons aktivieren oder Diagnose öffnen, um den Serverstatus zu prüfen.',
  },
  fr: {
    airGap: 'Le mode air-gap bloque le fil. Désactivez-le dans Réglages ou lancez Tier34 sur votre réseau local.',
    noInternet: 'Le fil nécessite votre serveur Tier34 sur le réseau local. Ouvrez Réglages → Diagnostics pour vérifier l\'état.',
    offline: 'Activez Tier34 dans Réglages → Extensions, ou ouvrez Diagnostics pour vérifier le serveur.',
  },
  ja: {
    airGap: 'エアギャップモードはフィードをブロックします。設定でオフにするか、ローカルネットワークで Tier34 を実行してください。',
    noInternet: 'フィードにはローカルネットワーク上の Tier34 サーバーが必要です。設定 → 診断でサーバー状態を確認してください。',
    offline: '設定 → アドオンで Tier34 をオンにするか、診断でサーバー状態を確認してください。',
  },
  ko: {
    airGap: '에어갭 모드는 피드를 차단합니다. 설정에서 끄거나 로컬 네트워크에서 Tier34를 실행하세요.',
    noInternet: '피드는 로컬 네트워크의 Tier34 서버가 필요합니다. 설정 → 진단에서 서버 상태를 확인하세요.',
    offline: '설정 → 애드온에서 Tier34를 켜거나 진단에서 서버 상태를 확인하세요.',
  },
  hi: {
    airGap: 'एयर-गैप मोड फ़ीड को ब्लॉक करता है। सेटिंग्स में बंद करें या स्थानीय नेटवर्क पर Tier34 चलाएँ।',
    noInternet: 'फ़ीड को स्थानीय नेटवर्क पर Tier34 सर्वर चाहिए। सर्वर स्थिति के लिए सेटिंग्स → डायग्नोस्टिक्स खोलें।',
    offline: 'सेटिंग्स → ऐडऑन में Tier34 चालू करें, या सर्वर स्थिति के लिए डायग्नोस्टिक्स खोलें।',
  },
  id: {
    airGap: 'Mode air-gap memblokir feed. Matikan di Pengaturan atau jalankan Tier34 di jaringan lokal.',
    noInternet: 'Feed membutuhkan server Tier34 di jaringan lokal. Buka Pengaturan → Diagnostik untuk memeriksa status.',
    offline: 'Nyalakan Tier34 di Pengaturan → Add-on, atau buka Diagnostik untuk memeriksa server.',
  },
  tr: {
    airGap: 'Air-gap modu akışı engeller. Ayarlardan kapatın veya yerel ağda Tier34 çalıştırın.',
    noInternet: 'Akış yerel ağdaki Tier34 sunucusuna ihtiyaç duyar. Sunucu durumu için Ayarlar → Tanılama\'yı açın.',
    offline: 'Ayarlar → Eklentiler\'de Tier34\'ü açın veya sunucu durumu için Tanılama\'yı açın.',
  },
  it: {
    airGap: 'La modalità air-gap blocca il feed. Disattivala in Impostazioni o avvia Tier34 sulla rete locale.',
    noInternet: 'Il feed richiede il server Tier34 sulla rete locale. Apri Impostazioni → Diagnostica per lo stato.',
    offline: 'Attiva Tier34 in Impostazioni → Componenti aggiuntivi o apri Diagnostica per lo stato del server.',
  },
  nl: {
    airGap: 'Air-gap-modus blokkeert de feed. Zet uit in Instellingen of start Tier34 op je lokale netwerk.',
    noInternet: 'De feed heeft je Tier34-server op het lokale netwerk nodig. Open Instellingen → Diagnostiek voor status.',
    offline: 'Schakel Tier34 in via Instellingen → Add-ons of open Diagnostiek om de server te controleren.',
  },
  pl: {
    airGap: 'Tryb air-gap blokuje feed. Wyłącz w Ustawieniach lub uruchom Tier34 w sieci lokalnej.',
    noInternet: 'Feed wymaga serwera Tier34 w sieci lokalnej. Otwórz Ustawienia → Diagnostyka, aby sprawdzić status.',
    offline: 'Włącz Tier34 w Ustawienia → Dodatki lub otwórz Diagnostyka, aby sprawdzić serwer.',
  },
  vi: {
    airGap: 'Chế độ air-gap chặn bảng tin. Tắt trong Cài đặt hoặc chạy Tier34 trên mạng cục bộ.',
    noInternet: 'Bảng tin cần máy chủ Tier34 trên mạng cục bộ. Mở Cài đặt → Chẩn đoán để kiểm tra trạng thái.',
    offline: 'Bật Tier34 trong Cài đặt → Tiện ích, hoặc mở Chẩn đoán để kiểm tra máy chủ.',
  },
  th: {
    airGap: 'โหมด air-gap บล็อกฟีด ปิดในการตั้งค่าหรือรัน Tier34 บนเครือข่ายท้องถิ่น',
    noInternet: 'ฟีดต้องการเซิร์ฟเวอร์ Tier34 บนเครือข่ายท้องถิ่น เปิดการตั้งค่า → การวินิจฉัยเพื่อตรวจสอบสถานะ',
    offline: 'เปิด Tier34 ในการตั้งค่า → ส่วนเสริม หรือเปิดการวินิจฉัยเพื่อตรวจสอบเซิร์ฟเวอร์',
  },
  bn: {
    airGap: 'এয়ার-গ্যাপ মোড ফিড ব্লক করে। সেটিংসে বন্ধ করুন বা স্থানীয় নেটওয়ার্কে Tier34 চালান।',
    noInternet: 'ফিডের জন্য স্থানীয় নেটওয়ার্কে Tier34 সার্ভার দরকার। সার্ভার স্ট্যাটাসের জন্য সেটিংস → ডায়াগনস্টিক্স খুলুন।',
    offline: 'সেটিংস → অ্যাডঅনে Tier34 চালু করুন, অথবা সার্ভার স্ট্যাটাসের জন্য ডায়াগনস্টিক্স খুলুন।',
  },
};

for (const file of fs.readdirSync(localesDir).filter((f) => f.endsWith('.json'))) {
  const locale = file.replace('.json', '');
  const filePath = path.join(localesDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const feedPage = FEED_PAGE[locale] ?? FEED_PAGE.en;
  const offlineFeed = OFFLINE_FEED[locale] ?? OFFLINE_FEED.en;

  data.feed = feedPage;
  data.offline.feed = offlineFeed;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Patched ${file}`);
}
