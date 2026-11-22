#!/bin/bash
set -e

echo "=== Listing workspace root ==="
ls -la

# Determine the client output directory
OUTDIR=""
if [ -d ".output/public" ] && [ -f ".output/public/index.html" ]; then
  OUTDIR=".output/public"
elif [ -d "dist/client" ]; then
  OUTDIR="dist/client"
elif [ -d "dist" ] && [ -d "dist/assets" ]; then
  OUTDIR="dist"
elif [ -d "dist" ]; then
  if [ -d "dist/client" ]; then
    OUTDIR="dist/client"
  else
    OUTDIR="dist"
  fi
elif [ -d ".vinxi/build/client" ]; then
  OUTDIR=".vinxi/build/client"
elif [ -d "docs" ]; then
  OUTDIR="docs"
else
  OUTDIR="dist"
fi

echo "Selected OUTDIR: $OUTDIR"
echo "=== Content of $OUTDIR ==="
ls -la "$OUTDIR"

# If index.html does not exist in $OUTDIR, generate it from the built assets
if [ ! -f "$OUTDIR/index.html" ]; then
  echo "index.html not found in $OUTDIR, generating from build assets..."

  CSS_FILE=$(ls "$OUTDIR/assets/"*.css 2>/dev/null | head -1 | xargs -n 1 basename || true)
  echo "Detected CSS file: $CSS_FILE"

  # Look for entry JS file: index-*.js or client-*.js or largest JS file
  JS_FILE=$(ls "$OUTDIR/assets/"index-*.js 2>/dev/null | head -1 | xargs -n 1 basename || true)
  if [ -z "$JS_FILE" ]; then
    JS_FILE=$(ls "$OUTDIR/assets/"client-*.js 2>/dev/null | head -1 | xargs -n 1 basename || true)
  fi
  if [ -z "$JS_FILE" ]; then
    JS_FILE=$(ls -S "$OUTDIR/assets/"*.js 2>/dev/null | head -1 | xargs -n 1 basename || true)
  fi
  echo "Detected JS entry: $JS_FILE"

  cat << 'EOF' > "$OUTDIR/index.html"
<!DOCTYPE html>
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
EOF

  if [ -n "$CSS_FILE" ]; then
    echo "  <link rel=\"stylesheet\" href=\"./assets/$CSS_FILE\">" >> "$OUTDIR/index.html"
  fi

  cat << 'EOF' >> "$OUTDIR/index.html"
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
EOF

  if [ -n "$JS_FILE" ]; then
    echo "  <script type=\"module\" src=\"./assets/$JS_FILE\"></script>" >> "$OUTDIR/index.html"
  fi

  cat << 'EOF' >> "$OUTDIR/index.html"
</body>
</html>
EOF
  echo "=== Generated index.html successfully ==="
  cat "$OUTDIR/index.html"
fi

# Always ensure 404.html is present for client-side routing
if [ -f "public/404.html" ]; then
  cp "public/404.html" "$OUTDIR/404.html"
  echo "Copied public/404.html to $OUTDIR/404.html"
elif [ -f "$OUTDIR/index.html" ]; then
  cp "$OUTDIR/index.html" "$OUTDIR/404.html"
  echo "Copied index.html to $OUTDIR/404.html"
fi

# Prevent GitHub Pages from ignoring files or using Jekyll
touch "$OUTDIR/.nojekyll"
echo "Created $OUTDIR/.nojekyll"

if [ -n "$GITHUB_OUTPUT" ]; then
  echo "outdir=$OUTDIR" >> "$GITHUB_OUTPUT"
fi
