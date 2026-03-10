const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config({ override: true });

const PORT = Number(process.env.PORT || 3000);

const SITES = [
  {
    zip: '60434',
    name: 'Victory house (8401 Foxbourgh Way Joliet IL)',
    lat: 41.5546253,
    lon: -88.2870740
  },
  {
    zip: '60642',
    name: 'Miracle centre (1165 N Milwaukee Avenue Chicago 60642 APT 2105)',
    lat: 41.9030998,
    lon: -87.6654782
  }
];

function contentType(filePath){
  const ext = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  }[ext] || 'application/octet-stream');
}

function safePathFromRequest(urlPath){
  const raw = (urlPath || '/').split('?')[0];
  const normalized = raw === '/' ? '/index.html' : path.normalize(raw);
  if(normalized.includes('..')) return null;
  return path.join(__dirname, normalized);
}

function serveStatic(req, res){
  const filePath = safePathFromRequest(req.url);
  if(!filePath){
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  fs.stat(filePath, (err, stats)=>{
    if(err || !stats.isFile()){
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      // Prevent stale browser cache from serving outdated form markup.
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function requestPathname(req){
  try{
    return new URL(req.url || '/', 'http://localhost').pathname;
  }catch(err){
    return '/';
  }
}

function isSubmitPath(pathname){
  return pathname === '/api/submit' || pathname === '/api/submit/';
}

function writeJson(res, statusCode, payload, extraHeaders = {}){
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function apiCorsHeaders(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function fetchJson(url){
  return new Promise((resolve, reject)=>{
    const options = new URL(url);
    options.headers = {
      'User-Agent': 'zip-assignment-app/1.0 (contact: localdev@example.com)'
    };
    https
      .get(options, (res)=>{
        let data = '';
        res.on('data', (chunk)=>{ data += chunk; });
        res.on('end', ()=>{
          try{
            resolve(JSON.parse(data));
          }catch(err){
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function haversine(lat1, lon1, lat2, lon2){
  const toRad = (value)=> (value * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function normalizePhone(phone){
  const digits = String(phone || '').replace(/\D/g, '');
  if(digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function fallbackByZipDistance(zip){
  const target = Number(zip);
  if(Number.isNaN(target)) return SITES[0].name;

  let best = SITES[0];
  let bestDelta = Infinity;
  for(const site of SITES){
    const current = Number(site.zip);
    if(Number.isNaN(current)) continue;
    const delta = Math.abs(current - target);
    if(delta < bestDelta){
      bestDelta = delta;
      best = site;
    }
  }
  return best.name;
}

async function assignByZip(zip){
  const exact = SITES.find((site)=> site.zip === zip);
  if(exact) return exact.name;

  try{
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(zip);
    const data = await fetchJson(url);
    if(!Array.isArray(data) || data.length === 0) return fallbackByZipDistance(zip);

    const targetLat = parseFloat(data[0].lat);
    const targetLon = parseFloat(data[0].lon);
    let best = null;
    let bestDist = Infinity;

    for(const site of SITES){
      const dist = haversine(targetLat, targetLon, site.lat, site.lon);
      if(dist < bestDist){
        bestDist = dist;
        best = site;
      }
    }
    return best ? best.name : null;
  }catch(err){
    return fallbackByZipDistance(zip);
  }
}

function loadServiceAccountCredentials(){
  if(process.env.GOOGLE_SERVICE_ACCOUNT_KEY){
    try{
      return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    }catch(err){
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON.');
    }
  }

  if(process.env.SERVICE_ACCOUNT_FILE){
    const filePath = path.join(__dirname, process.env.SERVICE_ACCOUNT_FILE);
    try{
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    }catch(err){
      throw new Error('Could not read SERVICE_ACCOUNT_FILE: ' + filePath);
    }
  }

  throw new Error('Google Sheets credentials are not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY or SERVICE_ACCOUNT_FILE.');
}

async function appendToSheet(row){
  const sheetId = process.env.SHEET_ID;
  const sheetName = process.env.SHEET_NAME || 'Sheet1';
  if(!sheetId) throw new Error('SHEET_ID is not configured.');

  const credentials = loadServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  try{
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: sheetName + '!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [row] }
    });
  }catch(err){
    throw new Error('Sheets append failed: ' + (err && err.message ? err.message : String(err)));
  }
}

async function handleSubmit(req, res){
  let body = '';
  req.on('data', (chunk)=>{ body += chunk; });
  req.on('end', async ()=>{
    let data = {};
    try{
      data = JSON.parse(body || '{}');
    }catch(err){
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'invalid JSON' }));
      return;
    }

    try{
      const name = String(data.name || '').trim();
      const phone = normalizePhone(data.phone || data.phoneNumber || '');
      const street = String(data.street || '').trim();
      const city = String(data.city || '').trim();
      const state = String(data.state || '').trim();
      const zipMatch = String(data.zip || '').match(/\d{5}/);
      const zip = zipMatch ? zipMatch[0] : '';

      if(!name || !street || !zip){
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'name, street, and valid 5-digit zip are required' }));
        return;
      }

      if(phone && !/^\d{10}$/.test(phone)){
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'phone must be 10 digits when provided' }));
        return;
      }

      const assignedLocation = await assignByZip(zip);
      if(!assignedLocation){
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Could not assign location for the provided ZIP.' }));
        return;
      }
      const assignedZip = zip;

      await appendToSheet([
        name,
        phone,
        street,
        city,
        state,
        zip,
        assignedLocation,
        assignedZip,
        new Date().toISOString()
      ]);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ assignedLocation, assignedZip }));
    }catch(err){
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err && err.message ? err.message : 'Failed to process submission' }));
    }
  });
}

const server = http.createServer((req, res)=>{
  const pathname = requestPathname(req);
  if(isSubmitPath(pathname)){
    const corsHeaders = apiCorsHeaders();
    if(req.method === 'OPTIONS'){
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if(req.method === 'POST'){
      Object.entries(corsHeaders).forEach(([key, value])=> res.setHeader(key, value));
      handleSubmit(req, res);
      return;
    }

    writeJson(res, 405, { error: 'Method Not Allowed. Use POST /api/submit.' }, corsHeaders);
    return;
  }

  if(pathname.startsWith('/api/')){
    writeJson(res, 404, { error: 'API endpoint not found.' });
    return;
  }

  if(req.method === 'GET'){
    serveStatic(req, res);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
});

server.listen(PORT, ()=>{
  console.log('Server running at http://localhost:' + PORT);
});
