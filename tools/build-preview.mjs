/* Egyfájlos, telepítés nélkül kipróbálható változatot készít a forrásokból.
   Futtatás a projekt gyökeréből:  node tools/build-preview.mjs         */
import fs from 'fs';
const html = fs.readFileSync('index.html', 'utf8');
const css  = fs.readFileSync('assets/styles.css', 'utf8');
const js   = fs.readFileSync('assets/app.js', 'utf8');
const out = html
  .replace('<link rel="stylesheet" href="assets/styles.css">', `<style>\n${css}\n</style>`)
  .replace('<script src="assets/config.js"></script>', '<script>window.APP_CONFIG={SUPABASE_URL:"",SUPABASE_ANON_KEY:""};</script>')
  .replace('<script type="module" src="assets/app.js"></script>', `<script type="module">\n${js}\n</script>`)
  .replace('<title>Ügyeleti tábla</title>', '<title>Ügyeleti tábla – bemutató</title>');
fs.writeFileSync('preview.html', out);
console.log('preview.html kész –', (out.length / 1024).toFixed(0), 'kB');
