export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'Missing messages' });

  const LIBRARY_URL = 'https://perpustakaan.smafg.sch.id/';
  const ADMIN_URL = 'https://perpustakaan.smafg.sch.id/admin/';

  const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
  const allUserMessages = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');

  const searchKeywords = ['cari', 'buku', 'ada', 'tersedia', 'koleksi', 'judul', 'mencari', 'temukan', 'punya', 'kalo', 'kalau', 'dipinjam', 'pinjam'];
  const followUpKeywords = ['nomor', 'apakah tersedia', 'status', 'yang pertama', 'yang kedua', 'yang ketiga', 'itu tersedia', 'bisa dipinjam', 'masih ada'];
  const loanKeywords = [
    'pinjaman', 'sisa waktu', 'jatuh tempo', 'keterlambatan',
    'terlambat', 'masa pinjam', 'cek pinjaman', 'pinjaman anggota',
    'anggota pinjam', 'masa peminjaman', 'peminjamannya',
    'meminjam buku', 'cek masa', 'berapa lama', 'kapan kembali',
    'tanggal kembali', 'waktu pinjam', 'lama pinjam', 'nama meminjam',
    'atas nama', 'sedang meminjam', 'masih meminjam'
  ];

  const isSearching = searchKeywords.some(k => lastUserMessage.toLowerCase().includes(k));
  const isFollowUp = followUpKeywords.some(k => lastUserMessage.toLowerCase().includes(k));
  const isLoanCheck = loanKeywords.some(k => lastUserMessage.toLowerCase().includes(k));

  const stopWords = ['cari', 'buku', 'ada', 'apakah', 'apa', 'yang', 'di', 'ke', 'dari', 'untuk', 'dengan', 'tersedia', 'koleksi', 'judul', 'mencari', 'temukan', 'punya', 'kalo', 'kalau', 'tentang', 'dipinjam', 'pinjam', 'mana', 'nomor', 'status', 'masih', 'bisa', 'pertama', 'kedua', 'ketiga'];

  const sourceMessage = isFollowUp ? allUserMessages : lastUserMessage;
  const keyword = sourceMessage
    .toLowerCase()
    .split(' ')
    .filter(w => !stopWords.includes(w) && w.length > 2)
    .join(' ')
    .trim();

  // Fungsi login admin SLiMS
  async function loginAdmin() {
    try {
      // Langkah 1: Ambil halaman login untuk dapatkan CSRF token dan cookie awal
      const loginPageRes = await fetch(`${LIBRARY_URL}index.php?p=login`);
      const loginHtml = await loginPageRes.text();
      const cookieInit = loginPageRes.headers.get('set-cookie') || '';

      // Ambil CSRF token
      const csrfMatch = loginHtml.match(/name="(_csrf_token_[^"]+)"\s+value="([^"]+)"/);
      if (!csrfMatch) return null;
      const csrfName = csrfMatch[1];
      const csrfValue = csrfMatch[2];

      // Langkah 2: Login dengan CSRF token
      const loginRes = await fetch(`${LIBRARY_URL}index.php?p=login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookieInit
        },
        body: `userName=${encodeURIComponent(process.env.SLIMS_USERNAME)}&passWord=${encodeURIComponent(process.env.SLIMS_PASSWORD)}&${csrfName}=${encodeURIComponent(csrfValue)}&logMeIn=Masuk`,
        redirect: 'follow'
      });

      const cookie = loginRes.headers.get('set-cookie') || cookieInit;
      return cookie;
    } catch (e) {
      return null;
    }
  }

  // Fungsi ambil data keterlambatan
  async function getOverduedList(cookie, memberName = '') {
    try {
      const today = new Date().toISOString().split('T')[0];
      const url = `${ADMIN_URL}modules/reporting/customs/overdued_list.php?reportView=true&startDate=2000-01-01&untilDate=${today}&id_name=${encodeURIComponent(memberName)}`;
      const overdueRes = await fetch(url, {
        headers: cookie ? { 'Cookie': cookie } : {}
      });
      const html = await overdueRes.text();

      const memberMatches = [...html.matchAll(/<div style="font-weight: bold[^>]*>([^<]+)<\/div>/g)];
      const loanMatches = [...html.matchAll(/<tr><td valign="top" width="10%">([^<]+)<\/td><td valign="top" width="40%">([^<]+)<div>/g)];
      const overdueMatches = [...html.matchAll(/Keterlambatan: (\d+) hari/g)];
      const dateMatches = [...html.matchAll(/Tanggal Pinjam: ([^&]+) &nbsp; Tanggal Kembali: ([^<]+)<\/td>/g)];

      if (memberMatches.length === 0) return 'Tidak ada data keterlambatan.';

      const results = memberMatches.map((m, i) => {
        const member = m[1].trim();
        const bookCode = loanMatches[i]?.[1]?.trim() || '-';
        const bookTitle = loanMatches[i]?.[2]?.trim() || '-';
        const overdue = overdueMatches[i]?.[1] || '0';
        const loanDate = dateMatches[i]?.[1]?.trim() || '-';
        const dueDate = dateMatches[i]?.[2]?.trim() || '-';
        return `- ${member}\n  Buku: ${bookTitle} (${bookCode})\n  Tanggal Pinjam: ${loanDate} | Jatuh Tempo: ${dueDate}\n  Keterlambatan: ${overdue} hari`;
      });

      return results.join('\n\n');
    } catch (e) {
      return `Gagal mengambil data keterlambatan: ${e.message}`;
    }
  }

  // Fungsi ambil data jatuh tempo
  async function getDueDateWarning(cookie, memberName = '') {
    try {
      const url = `${ADMIN_URL}modules/reporting/customs/due_date_warning.php?reportView=true&id_name=${encodeURIComponent(memberName)}`;
      const dueRes = await fetch(url, {
        headers: cookie ? { 'Cookie': cookie } : {}
      });
      const html = await dueRes.text();

      if (html.includes('Tidak Ada Data')) return 'Tidak ada peminjaman yang akan jatuh tempo dalam 3 hari ke depan.';

      const memberMatches = [...html.matchAll(/<div style="font-weight: bold[^>]*>([^<]+)<\/div>/g)];
      if (memberMatches.length === 0) return 'Tidak ada data jatuh tempo.';

      return memberMatches.map(m => `- ${m[1].trim()}`).join('\n');
    } catch (e) {
      return `Gagal mengambil data jatuh tempo: ${e.message}`;
    }
  }

  // Fungsi ambil ketersediaan buku
  async function getAvailability(bookId) {
    try {
      const detailRes = await fetch(`${LIBRARY_URL}index.php?p=show_detail&id=${bookId}`);
      const html = await detailRes.text();
      const rowMatches = [...html.matchAll(/<tr><td class="biblio-item-code">([^<]+)<\/td><td class="biblio-call-number">([^<]+)<\/td><td class="biblio-location">([^<]+)<\/td><td[^>]*><b[^>]*>([^<]+)<\/b><\/td><\/tr>/g)];
      if (rowMatches.length === 0) return 'Tidak ada data ketersediaan';
      return rowMatches.map(r => `Lokasi: ${r[3]} | Status: ${r[4]}`).join(' & ');
    } catch {
      return 'Gagal mengambil ketersediaan';
    }
  }

  let opacContext = '';
  let loanContext = '';

  // Fetch data peminjaman jika user bertanya tentang pinjaman
  if (isLoanCheck) {
    const cookie = await loginAdmin();

    // Ekstrak nama anggota dari pesan user
    const memberName = lastUserMessage
      .toLowerCase()
      .replace(/pinjaman|anggota|cek|saya|keterlambatan|terlambat|masa pinjam|jatuh tempo|sisa waktu|masa peminjaman|bisakah|kamu|mengecek|buku|atas nama|meminjam|peminjamannya|mau|apakah|bisa|saya mau|sedang|masih|meminjam|nama|lama|berapa|kapan|kembali|tanggal|waktu/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const [overdued, dueWarning] = await Promise.all([
      getOverduedList(cookie, memberName),
      getDueDateWarning(cookie, memberName)
    ]);

    loanContext = `\n\nData Peminjaman Real-time dari SLiMS:\n\n📋 Anggota yang Terlambat:\n${overdued}\n\n⏰ Akan Jatuh Tempo (3 hari ke depan):\n${dueWarning}`;
  }

  // Fetch data OPAC jika user mencari buku
  if ((isSearching || isFollowUp) && keyword) {
    try {
      const opacRes = await fetch(`${LIBRARY_URL}index.php?keywords=${encodeURIComponent(keyword)}&search=search`);
      const html = await opacRes.text();

      const titleMatches = [...html.matchAll(/class="card-link text-dark"[^>]*>([^<]+)<\/a>/g)];
      const authorMatches = [...html.matchAll(/class="btn btn-outline-secondary btn-rounded">([^<]+)<\/a>/g)];
      const linkMatches = [...html.matchAll(/href="(\/index\.php\?p=show_detail&id=(\d+)[^"]+)"/g)];

      if (titleMatches.length > 0) {
        const bookPromises = titleMatches.slice(0, 8).map(async (match, i) => {
          const title = match[1].trim();
          const bookId = linkMatches[i]?.[2];
          const link = linkMatches[i] ? `${LIBRARY_URL}${linkMatches[i][1].replace(/^\//, '')}` : '';
          const author = authorMatches[i]?.[1]?.trim() || 'Tidak diketahui';
          const availability = bookId ? await getAvailability(bookId) : 'Tidak diketahui';
          return `${i + 1}. *${title}*\n   Penulis: ${author}\n   ${availability}\n   Detail: ${link}`;
        });

        const books = await Promise.all(bookPromises);
        opacContext = `\n\nData buku dari OPAC untuk kata kunci "${keyword}" (${titleMatches.length} buku ditemukan):\n${books.join('\n')}\n\nLink pencarian lengkap: ${LIBRARY_URL}index.php?keywords=${encodeURIComponent(keyword)}&search=search`;
      } else {
        opacContext = `\n\nHasil pencarian OPAC untuk kata kunci "${keyword}": Tidak ditemukan buku yang sesuai.\nLink pencarian: ${LIBRARY_URL}index.php?keywords=${encodeURIComponent(keyword)}&search=search`;
      }
    } catch (e) {
      opacContext = `\n\nGagal mengambil data OPAC. Arahkan user ke: ${LIBRARY_URL}index.php?keywords=${encodeURIComponent(keyword)}&search=search`;
    }
  }

  const SYSTEM_PROMPT = `Kamu adalah asisten virtual yang ramah untuk Perpustakaan Future Gate.
Informasi perpustakaan:
- Nama: Perpustakaan Future Gate
- Website OPAC: ${LIBRARY_URL}
- Alamat: JL YUDISTIRA KOMP PEMDA BLOK A, Jatiasih, Kota Bekasi, Jawa Barat
- Sistem: SLiMS (Senayan Library Management System)
Kategori Koleksi (Dewey Decimal):
100: Filsafat & Psikologi | 200: Agama | 300: Ilmu Sosial | 400: Bahasa
500: Sains & Matematika | 600: Teknologi & Ilmu Terapan | 700: Seni & Olahraga
800: Sastra | 900: Sejarah & Geografi
Lokasi: Future Gate Institut, Ma'had Bawwabatul Mustaqbal, Perpustakaan SMA FG, Pojok Pustaka Ruang Guru, Pojok Pustaka Ruang Terbuka Umum
Tipe: Buku Bacaan, E-Book, Buku Referensi, Buku Teks, Jurnal, Majalah, Prosiding, Surat Kabar
Instruksi:
- Jika ada data buku dari OPAC, tampilkan langsung daftar bukunya beserta status ketersediaannya
- Jika ada data peminjaman, tampilkan dengan jelas nama anggota, judul buku, tanggal jatuh tempo, dan sisa hari
- Tampilkan status "Tersedia" atau "Tidak Tersedia" dengan jelas untuk setiap buku
- Jika user bertanya tentang buku tertentu dari daftar, jawab berdasarkan data yang sudah ada
- Jangan mengarang data yang tidak ada
- Jawab dalam Bahasa Indonesia yang ramah dan singkat
- Selalu sertakan link pencarian OPAC di akhir jawaban jika relevan${opacContext}${loanContext}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'API error' });
    }

    const replyText = data.choices?.[0]?.message?.content || '';
    return res.status(200).json({ reply: replyText.trim() });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
