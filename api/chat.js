export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'Missing messages' });

  const LIBRARY_URL = 'https://perpustakaan.smafg.sch.id/';

  // Ambil pesan terakhir dari user
  const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';

  // Deteksi apakah user sedang mencari buku
  const searchKeywords = ['cari', 'buku', 'ada', 'tersedia', 'koleksi', 'judul', 'mencari', 'temukan', 'punya', 'kalo', 'kalau'];
  const isSearching = searchKeywords.some(k => lastUserMessage.toLowerCase().includes(k));

  // Ekstrak kata kunci pencarian
  const stopWords = ['cari', 'buku', 'ada', 'apakah', 'apa', 'yang', 'di', 'ke', 'dari', 'untuk', 'dengan', 'tersedia', 'koleksi', 'judul', 'mencari', 'temukan', 'punya', 'kalo', 'kalau', 'tentang'];
  const keyword = lastUserMessage
    .toLowerCase()
    .split(' ')
    .filter(w => !stopWords.includes(w) && w.length > 2)
    .join(' ')
    .trim();

  // Fetch data OPAC jika user sedang mencari buku
  let opacContext = '';
  if (isSearching && keyword) {
    try {
      const opacRes = await fetch(`${LIBRARY_URL}index.php?keywords=${encodeURIComponent(keyword)}&search=search`);
      const html = await opacRes.text();

      // Parse judul buku - sesuai struktur SLiMS
      const titleMatches = [...html.matchAll(/class="card-link text-dark"[^>]*>([^<]+)<\/a>/g)];

      // Parse penulis
      const authorMatches = [...html.matchAll(/class="btn btn-outline-secondary btn-rounded">([^<]+)<\/a>/g)];

      // Parse link detail buku
      const linkMatches = [...html.matchAll(/href="(\/index\.php\?p=show_detail&id=\d+[^"]+)"/g)];

      if (titleMatches.length > 0) {
        // Kelompokkan penulis per buku (bisa lebih dari 1 penulis)
        let authorIndex = 0;
        const books = titleMatches.slice(0, 8).map((match, i) => {
          const title = match[1].trim();
          const link = linkMatches[i] ? `${LIBRARY_URL}${linkMatches[i][1].replace(/^\//, '')}` : '';

          // Ambil penulis (bisa lebih dari 1)
          const authors = [];
          while (authorMatches[authorIndex]) {
            authors.push(authorMatches[authorIndex][1].trim());
            authorIndex++;
            // Batasi maksimal 3 penulis per buku
            if (authors.length >= 3) break;
          }

          return `${i + 1}. *${title}*\n   Penulis: ${authors.join(', ') || 'Tidak diketahui'}\n   Detail: ${link}`;
        });

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
- Jika ada data buku dari OPAC, tampilkan langsung daftar bukunya kepada user secara lengkap
- Jangan mengarang data buku yang tidak ada
- Jawab dalam Bahasa Indonesia yang ramah dan singkat
- Selalu sertakan link pencarian OPAC di akhir jawaban${opacContext}`;

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
