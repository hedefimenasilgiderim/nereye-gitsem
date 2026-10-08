import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Başlıkları
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { query } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is missing' });
    }

    // Overpass API'ye istek
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'data=' + encodeURIComponent(query)
    });

    const responseText = await response.text();

    if (!response.ok) {
      // Yedek sunucu
      const fallbackRes = await fetch('https://overpass.kumi.systems/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'data=' + encodeURIComponent(query)
      });
      const fallbackText = await fallbackRes.text();
      return res.status(fallbackRes.status).send(fallbackText);
    }

    return res.status(200).send(responseText);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
}
