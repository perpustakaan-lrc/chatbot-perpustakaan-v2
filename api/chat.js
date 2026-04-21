export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'Missing messages' });

  const LIBRARY_URL = 'https://perpustakaan.smafg.sch.id/';
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
- Saat pengguna mencari buku, sertakan link langsung ke hasil pencarian OPAC: ${LIBRARY_URL}index.php?keywords=[kata_kunci]&search=search
- Jawab dalam Bahasa Indonesia yang ramah dan singkat
- Jangan mengarang data buku yang tidak ada`;

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
