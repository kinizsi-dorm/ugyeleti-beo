# Ügyeleti tábla

Havi ügyeleti beosztás öt embernek. Mindenki bejelöli, mikor ér rá, Vanda kiosztja a napokat és véglegesíti, utána a kész beosztás letölthető naptárfájlként.

---

## ⚠️ Először ezt

A képernyőképen megosztott **Client secret (`GOCSPX-…`) nyilvánosságra került, cseréld le.** Google Cloud Console → Clients → *KinizsiSSO* → a meglévő secret törlése, majd **Add secret**. Az új értéket csak a Supabase felületére másold be (2/3. lépés), a kódba soha.

## 1. Google OAuth beállítása

A már létrehozott *KinizsiSSO* klienshez két dolgot kell megadni:

1. **Authorized redirect URIs** → `https://<projekt-ref>.supabase.co/auth/v1/callback`
   A `<projekt-ref>` a Supabase projekt azonosítója, a Project URL-ből olvasható ki.
2. **Authorized JavaScript origins** → `https://<felhasznalonev>.github.io`

Ezután **Google Auth Platform → Audience**: mivel az alkalmazás tesztelési módban van, a belépés csak a felvett tesztfelhasználóknak működik. **Vedd fel mind az öt e-mail-címet tesztfelhasználóként**, különben a saját fiókjukkal sem tudnak belépni. (Alternatíva: az app közzététele, de öt embernél a tesztfelhasználós mód egyszerűbb és egyben plusz védelem.)

> A Google figyelmeztet, hogy a beállítások érvényesülése pár perctől néhány óráig tarthat. Ha az első próbálkozás `redirect_uri_mismatch` hibát ad, várj pár percet.

## 2. Supabase projekt

1. [supabase.com](https://supabase.com) → **New project**, európai régióval.
2. **SQL Editor** → **New query** → a `supabase/schema.sql` teljes tartalma → **Run**. Ez létrehozza a táblákat, a jogosultsági szabályokat és az öt embert.
   Ellenőrzés: `select name, email, role from people order by sort_order;` — öt sort kell adnia.
3. **Authentication → Sign In / Providers → Google**: bekapcsol, majd be a **Client ID** és az **új Client secret**. Mentés.
4. **Authentication → URL Configuration**:
   - *Site URL*: `https://<felhasznalonev>.github.io/<repo>/`
   - *Redirect URLs*: ugyanez a cím (érdemes `http://localhost:*` is, ha helyben is próbálod)
5. **Project Settings → API**: innen másold ki a **Project URL**-t és az **anon / publishable** kulcsot az `assets/config.js`-be:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGci..."
};
```

Ez a két érték nyugodtan lehet nyilvános: az anon kulccsal bejelentkezés nélkül semmit nem lehet olvasni vagy írni. A `service_role` kulcs viszont soha nem kerülhet ide.

## 3. GitHub Pages

1. Új repó (pl. `ugyelet`), a mappa tartalmának feltöltése (**Add file → Upload files** is jó).
2. **Settings → Pages** → *Deploy from a branch* → `main` / `/ (root)` → **Save**.
3. Pár perc múlva él: `https://<felhasznalonev>.github.io/ugyelet/`. Ez a link megy körbe az ötüknek.

---

## Használat

### Admin szerepkör – meglévő projekt frissítése

1. Supabase Dashboard → **SQL Editor → New query**: másold be a
   **[supabase/admin-role.sql](supabase/admin-role.sql)** teljes tartalmát, majd **Run**.
   Ez szükséges az új szerephez, a jogosultságokhoz és a névsor mentéséhez is.
   A meglévő névsort, jelöléseket és beosztást megtartja; **senkit nem tesz automatikusan adminná**.
   Új projektnél elég a friss `schema.sql`, amely már tartalmazza ugyanezeket a szabályokat.
2. Amikor szeretnél admint kijelölni: **Table Editor → people** → a megfelelő személy
   `role` mezőjét állítsd **`admin`** értékre, a `can_duty` maradjon **true**. Az illető
   frissítse az oldalt. Az első admint így, a Supabase-ben tudod kijelölni.
3. **Authentication → URL Configuration → Redirect URLs**: a főoldal és OTP-cím mellé
   vedd fel a `https://<felhasznalonev>.github.io/ugyeleti-beo/settings/` címet is.
4. Pushold a módosított fájlokat a GitHub Pages ágra. Az OTP Edge Functiont ehhez a
   frissítéshez nem kell módosítani vagy újratelepíteni.

Az admin továbbra is beosztható ügyelő, alapból ügyelői nézettel. Csak neki jelenik meg
a fejléc **Ügyelő / Admin** kapcsolója. **Admin** nézetben ugyanúgy kioszthat, véglegesíthet,
feloldhat és szerkesztheti a névsort, mint a véglegesítő. A nézetválasztást az adott
böngészőlapon, felhasználónként megjegyezzük az oldalak közötti navigálásnál; kilépéskor töröljük.
A kapcsoló a felület nézetét váltja, az adatbázis-jogosultságot mindig a `people.role` adja.

**Adminjogot csak admin adhat és vonhat vissza a felületen.** A véglegesítő ügyelő,
véglegesítő és megtekintő szerepeket állíthat be; adminfiók adatait nem módosíthatja és
adminfiókot nem törölhet. Ezeket a szabályokat a szerver is kikényszeríti. A névsor
mentése egyetlen tranzakció, így hiba esetén a törlések is visszagördülnek. A felületen
az utolsó admin nem törölheti vagy fokozhatja le önmagát; előbb másik admint kell kijelölnie.

A **Névsor** kizárólag személyeket és szerepeket kezel. A **Hónap nézete** az admin nézetben
megjelenő külön **Beállítások** fülre (`/ugyeleti-beo/settings/`) került. Ez a teljes csapat
nézetét befolyásolja; a véglegesítő sem módosíthatja. A **Statisztika** fül egyelőre
inaktív, „hamarosan” jelzéssel. A tervezett `/ugyeleti-beo/stats/` aloldal még nem készült el.

### OTP-aloldal – egyszeri beállítás

A fejléc alatti **Beosztás / OTP** navigáció mindkét oldalon elérhető. Az új oldal címe
`https://<felhasznalonev>.github.io/ugyeleti-beo/otp/` (a záró perjel nélküli címet
a GitHub Pages ide irányítja). Jobb felül ugyanaz a bejelentkezett felhasználó látszik.
A kódra kattintva a hat számjegy szóköz nélkül kerül a vágólapra, a kezdő nullákkal együtt.

**Javasolt tárolás: Supabase → Edge Functions → Secrets.** GitHub Pagesen nincs szerveroldali
titoktárolás: a JavaScriptbe épített GitHub secret is kiolvasható lenne. Itt csak az aktuális
kód jut el a böngészőbe, a secret kizárólag az Edge Function környezetében marad.
Nem szükséges új adatbázistábla vagy a meglévő séma újbóli futtatása.

1. Supabase Dashboard → **Edge Functions → Secrets**: hozz létre egy **`OTP_SECRET`** nevű
   secretet. Értéke a célrendszer hitelesítő alkalmazáshoz adott **Base32 TOTP-kulcsa** legyen
   (a QR-kód `otpauth://…` címének `secret` paramétere, nem a teljes cím, és nem egy aktuális kód).
   A megvalósítás **SHA-1 / 6 számjegy / 30 másodperc** beállítást használ; a célrendszernek
   ugyanezeket kell használnia. Ugyanazt a közös kódot látja minden engedélyezett felhasználó.
2. Supabase Dashboard → **Edge Functions → Deploy a new function → Via Editor**.
   A függvény neve pontosan **`otp`** legyen. A szerkesztő `index.ts` fájljának teljes
   tartalmát cseréld le a repóban található
   **[supabase/functions/otp/index.ts](supabase/functions/otp/index.ts)** teljes tartalmára,
   majd kattints a **Deploy function** gombra. Ez egyetlen önálló fájl: nincs szükség
   másik fájlra, importra, csomagtelepítésre vagy CLI-re.
   Ezután az **otp → Details → Function configuration** résznél kapcsold **OFF** állásba
   a **Verify JWT with legacy secret** kapcsolót, és mentsd a beállítást.
   Ez csak a régi gateway-ellenőrzést kapcsolja ki; a függvény **maga
   ellenőrzi a tokent a Supabase Auth szolgáltatásával**, majd a meglévő `whoami` RPC-vel
   ellenőrzi a névsor-tagságot. Bejelentkezés nélkül és névsoron kívüli fiókkal nincs kód.
   A névsor összes szerepe, a megtekintő is használhatja az OTP-oldalt.
3. **Authentication → URL Configuration → Redirect URLs**: a főoldal meglévő címe mellé
   vedd fel a **teljes OTP-címet is, záró perjellel**, például
   `https://<felhasznalonev>.github.io/ugyeleti-beo/otp/`.
   A Google Cloud callback címe változatlan marad.
4. Pushold a módosított fájlokat a meglévő GitHub Pages ágra. Az `assets/config.js`
   jelenlegi értékei megfelelőek; **OTP secretet ne írj ebbe a fájlba**.
   Az Edge Function későbbi módosításakor az **otp → Code** böngészős szerkesztőben
   cseréld a fájl tartalmát, majd **Deploy updates**. Ellenőrizd, hogy a fenti JWT-kapcsoló
   továbbra is OFF állásban van. Az OTP secret cseréjéhez elég a Supabase Secretsben átírni.
   Nincs deployment vagy ébren tartó GitHub Action; az üzembe helyezéshez GitHub secret sem kell.

**A push önmagában az új felületet teszi közzé.** A működő OTP-hez az első három lépést
is el kell végezni. Beállítás előtt az oldal érthető hibaüzenetet mutat, nem készít hamis kódot.

Próbáld ki a weboldalon Google-belépés után az **OTP** menüpontot. A Dashboard tesztelőjének
alapértelmezett anon vagy service-role kulcsa önmagában nem felhasználói munkamenet:
azzal a függvény szándékosan `401` választ ad.

A kód a szerver órája alapján készül, automatikusan frissül, és lejáratkor azonnal eltűnik.
Háttérbe tett lapon nem kérdezgetjük a szervert; visszatéréskor friss kódot kérünk.
Az OTP nem kerül helyi tárolóba vagy naplóba. A hagyományos TOTP egy időablakon belül
ugyanazt a kódot adja; az egyszeri felhasználás kikényszerítése a kódot fogadó rendszer feladata.

Opcionális fejlesztői ellenőrzés helyben: `node --test tests/otp-server.test.mjs`
(Node.js 22.18+ vagy 24+). Az üzembe helyezéshez ez nem szükséges.
A tesztek nyilvános RFC-tesztkulcsot használnak, éles szolgáltatást nem hívnak.

Opcionális böngészőtesztek (szintén tesztadatokkal):

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node --test tests/otp-browser.test.cjs
```

A böngészőteszt a navigációt, másolást, lejáratot, hibakezelést, hozzáférést és a
mobilos elrendezést ellenőrzi. Képernyőképei a Gitből kizárt `test-results/` mappába kerülnek.

Háttér: [Supabase secrets](https://supabase.com/docs/guides/functions/secrets),
[Edge Function böngészős szerkesztő](https://supabase.com/docs/guides/functions/quickstart-dashboard),
[RFC 6238 – TOTP](https://www.rfc-editor.org/rfc/rfc6238.html).

### Beosztás

**Megnyitáskor** az oldal magától átdob a Google-belépésre. Utána a fiók e-mail-címe alapján azonosít: nincs névválasztás, nincs jelszó. Ha valaki nem szereplő fiókkal lép be, azt kiírja, és tud másik fiókkal próbálkozni.

**Jelölés (ügyelők és a véglegesítő):** kattints egy napra, a saját jelölésed körbeér: *ráér → ha muszáj → nem ér rá → üres*. A cellák alján lévő öt négyzet a névsor sorrendjében mutatja, ki hogyan jelölt — ugyanaz a logika, mint a régi táblázat oszlopaié, csak egy cellába sűrítve. A sajátodat vastag keret jelöli.

**Telefonon** a hét nem hét oszlopra, hanem hét sorra bomlik: naponként egy sor a dátummal, a nap nevével, a beosztott emberrel és a jelölésekkel. Ugyanaz az elrendezés, mint a régi táblázatban, így semmi nem csúszik össze.

**Megtekintő (Viktor):** csak azt látja, ki melyik napra van beosztva. Jelölések, névsorstatisztika, kiosztás és véglegesítés nála meg sem jelenik.

**Kiosztás (Vanda):** a *Kiosztás* módban a kattintás lépteti, ki legyen aznap ügyeletes — először azok jönnek, akik ráérnek, utána a „ha muszáj" jelölésűek. A *Saját jelölés* módra váltva Vanda ugyanúgy tudja jelölni a saját ráéréseit, mint bárki más. A *Javaslat kitöltése* az üres napokat tölti fel a legkevesebb ügyeletet kapóval, kerülve az egymást követő két napot; ez csak javaslat, szabadon átírható.

**Bármelyik nap részletei:** hosszú nyomás (mobilon) vagy jobb klikk. Itt látszik mindenki jelölése névvel, és innen olyan embert is be lehet osztani, aki nemet mondott.

**Véglegesítés hetenként:** minden hét külön zárul le, a hét fejlécében lévő *Véglegesítés* gombbal. A lezárt héten senki nem tud jelölni és a beosztás sem módosul, a többi hét viszont nyitva marad. A *Feloldás* visszavonja. A mai naphoz képest **következő hét sárga kiemelést kap**, hogy mindig látszódjon, melyikkel kell foglalkozni.

**Naptárba küldés:** véglegesítés után a hét fejlécében a *Naptárba* gomb nyílik meg. Itt emberenként egy **Naptárba** gomb van: megnyitja a Google Naptárat a kész, egész napos eseménnyel, és egy koppintás elmenteni. Ez fájl nélkül működik, telefonon is — iPhone-on ez a javasolt út. Ugyanitt letölthető `.ics` fájl is, ami asztali Google Naptárba (*Beállítások → Importálás és exportálás*) és Outlookba importálható. Az egymást követő ügyeleti napok egy eseménybe kerülnek, és van hozzá emlékeztető az előző nap délre.

**Hónap határa:** egy hónap tábláját azok a hetek adják, amelyek hétfője az adott hónapra esik — 2026 januárja így 01.05-től 02.01-ig tart, pontosan úgy, mint a korábbi táblázatban. Az admin a Beállítások fülön válthat naptári hónapra.

**Névsor:** a véglegesítő és az admin (Admin nézetben) szerkesztheti. Itt lehet nevet, Google-címet és szerepet módosítani, embert felvenni vagy törölni. Adminjogot és adminfiókot csak admin kezelhet. Új ember felvételekor ne feledd őt tesztfelhasználóként is felvenni a Google Auth Platformon.

## Ha valami nem működik

| Tünet | Ok |
|---|---|
| `redirect_uri_mismatch` | A Google kliensben nem pontosan a Supabase callback URL szerepel, vagy még nem lépett érvénybe. |
| „Access blocked / nem tesztfelhasználó" | Az adott cím nincs felvéve tesztfelhasználóként a Google Auth Platform → Audience alatt. |
| „Nincs hozzáférés" képernyő | A fiók e-mail-címe nincs a `people` táblában. Betűre egyeznie kell. |
| Üres oldal, hosszú töltés | Ellenőrizd a Supabase projekt állapotát; szünetelés esetén a dashboardon *Restore*. |
| A többiek jelölése nem frissül | A valós idejű kapcsolat nem épült fel; 45 másodpercenként és a *Frissítés* gombra így is betölt. |
| `.ics` nem tölt le | Csak véglegesített hétre érhető el. |
| iPhone nem nyitja meg az `.ics`-t | Használd helyette a *Naptárba* gombot: az a Google Naptárat nyitja meg kész eseménnyel. |

## Költség

Mindkét szolgáltatás ingyenes csomagja bőven elég: az egész évi adat néhány száz kilobájt. Bankkártya egyikhez sem kell.
