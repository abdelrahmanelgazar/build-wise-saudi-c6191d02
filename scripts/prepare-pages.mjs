import fs from 'node:fs';
import path from 'node:path';

console.log('=== Preparing static assets for GitHub Pages ===');

const candidates = [
  '.output/public',
  'dist/client',
  'dist',
  'docs',
];

let outDir = '';
for (const c of candidates) {
  if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
    outDir = c;
    break;
  }
}

if (!outDir) {
  outDir = 'dist';
}

console.log(`Selected output directory: ${outDir}`);

const assetsDir = path.join(outDir, 'assets');
let cssFile = '';
let jsFiles = [];

if (fs.existsSync(assetsDir)) {
  const files = fs.readdirSync(assetsDir);
  const cssList = files.filter(f => f.endsWith('.css'));
  if (cssList.length > 0) {
    cssFile = cssList[0];
    console.log(`Found CSS file: ${cssFile}`);
  }

  // Find index-*.js or client-*.js entry scripts
  const indexJs = files.find(f => f.startsWith('index-') && f.endsWith('.js'));
  const clientJs = files.find(f => f.startsWith('client-') && f.endsWith('.js'));
  
  if (clientJs) jsFiles.push(clientJs);
  if (indexJs) jsFiles.push(indexJs);

  if (jsFiles.length === 0) {
    const largestJs = files
      .filter(f => f.endsWith('.js'))
      .map(f => ({ name: f, size: fs.statSync(path.join(assetsDir, f)).size }))
      .sort((a, b) => b.size - a.size)[0];
    if (largestJs) jsFiles.push(largestJs.name);
  }
  console.log(`Found JS entry files: ${jsFiles.join(', ')}`);
}

const indexPath = path.join(outDir, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.log(`Generating index.html in ${outDir}...`);
  const cssTag = cssFile ? `<link rel="stylesheet" href="./assets/${cssFile}">` : '';
  const jsTags = jsFiles.map(f => `<script type="module" src="./assets/${f}"></script>`).join('\n  ');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>تقديري — منصة تسعير وإدارة المناقصات | Taqdiri Platform</title>
  <meta name="description" content="منصة احترافية لتقدير تكاليف المقاولات وإدارة المناقصات وتحليل الأسعار للسوق السعودي.">
  <meta name="theme-color" content="#0b1220">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800;900&display=swap">
  ${cssTag}
  <script type="text/javascript">
    // GitHub Pages SPA routing: handle /?/ redirects from 404.html
    (function(){
      var search = location.search;
      if (search.startsWith('?/')) {
        var query = search.slice(2).replace(/~and~/g, '&');
        var hashIndex = query.indexOf('#');
        var hash = hashIndex >= 0 ? query.slice(hashIndex) : '';
        var path = hashIndex >= 0 ? query.slice(0, hashIndex) : query;
        var ampIndex = path.indexOf('&');
        var route = '/' + (ampIndex >= 0 ? path.slice(0, ampIndex) : path);
        var qs = ampIndex >= 0 ? '?' + path.slice(ampIndex + 1) : '';
        var parts = location.pathname.split('/').filter(Boolean);
        var repo = parts.length > 0 ? '/' + parts[0] : '';
        history.replaceState(null, null, repo + route + qs + hash);
      }
    })();
  </script>
</head>
<body>
  <div id="root"></div>
  ${jsTags}
</body>
</html>`;

  fs.writeFileSync(indexPath, html, 'utf-8');
  console.log('Successfully generated index.html');
}

// Ensure 404.html
const public404 = path.join('public', '404.html');
const out404 = path.join(outDir, '404.html');
if (fs.existsSync(public404)) {
  fs.copyFileSync(public404, out404);
  console.log('Copied public/404.html to output');
} else if (fs.existsSync(indexPath) && !fs.existsSync(out404)) {
  fs.copyFileSync(indexPath, out404);
  console.log('Copied index.html to 404.html');
}

// Ensure .nojekyll
fs.writeFileSync(path.join(outDir, '.nojekyll'), '', 'utf-8');
console.log('Created .nojekyll');

// GitHub Output
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `outdir=${outDir}\n`, 'utf-8');
  console.log(`Set GITHUB_OUTPUT outdir=${outDir}`);
}

console.log('Done preparing static pages.');
