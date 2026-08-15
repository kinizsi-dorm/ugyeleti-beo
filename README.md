# Ügyeleti tábla

Havi ügyeleti beosztás öt embernek. Mindenki bejelöli, mikor ér rá, Vanda kiosztja a napokat és véglegesíti, utána a kész beosztás letölthető naptárfájlként.

Belépés Google-fiókkal. Csak az alábbi öt cím fér hozzá — ezt nem a böngészőben futó kód, hanem az adatbázis szabályai kényszerítik ki, tehát a linket ismerve sem lát bele senki más.

| Név | Google-fiók | Szerep |
|---|---|---|
| Vanda | vanda.buri@gmail.com | véglegesítő, ügyeletre is beosztható |
| Bálint | takacsbalint0202@gmail.com | ügyelő |
| Peti | ppalotai4@gmail.com | ügyelő |
| Barbi | barbara.kalanova@gmail.com | ügyelő |
| Bandi | laandro3@gmail.com | ügyelő |

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

## 4. Ébren tartás

A Supabase ingyenes csomagján **egy hét tétlenség után szünetel a projekt**, és amíg valaki kézzel vissza nem állítja, az oldal nem tölt be. Havonta használt beosztónál ez biztosan bekövetkezne, ezért van a repóban ütemezett feladat, ami háromnaponta lefuttat egy apró lekérdezést.

**Settings → Secrets and variables → Actions** alatt vedd fel ugyanazt a két értéket, mint a `config.js`-ben: `SUPABASE_URL` és `SUPABASE_ANON_KEY`. Utána **Actions** fül → engedélyezés → egyszer **Run workflow** kézzel, hogy lásd, zöld-e.

> A GitHub 60 nap repó-tétlenség után felfüggeszti az ütemezett feladatokat, és erről e-mailt küld. Egy kattintás újraindítani.

---

## Használat

**Megnyitáskor** az oldal magától átdob a Google-belépésre. Utána a fiók e-mail-címe alapján azonosít: nincs névválasztás, nincs jelszó. Ha valaki nem szereplő fiókkal lép be, azt kiírja, és tud másik fiókkal próbálkozni.

**Jelölés (mindenki):** kattints egy napra, a saját jelölésed körbeér: *ráér → ha muszáj → nem ér rá → üres*. A cellák alján lévő öt négyzet a névsor sorrendjében mutatja, ki hogyan jelölt — ugyanaz a logika, mint a régi táblázat oszlopaié, csak egy cellába sűrítve. A sajátodat vastag keret jelöli.

**Kiosztás (Vanda):** a *Kiosztás* módban a kattintás lépteti, ki legyen aznap ügyeletes — először azok jönnek, akik ráérnek, utána a „ha muszáj" jelölésűek. A *Saját jelölés* módra váltva Vanda ugyanúgy tudja jelölni a saját ráéréseit, mint bárki más. A *Javaslat kitöltése* az üres napokat tölti fel a legkevesebb ügyeletet kapóval, kerülve az egymást követő két napot; ez csak javaslat, szabadon átírható.

**Bármelyik nap részletei:** hosszú nyomás (mobilon) vagy jobb klikk. Itt látszik mindenki jelölése névvel, és innen olyan embert is be lehet osztani, aki nemet mondott.

**Véglegesítés:** a *Hónap véglegesítése* lezárja a hónapot, utána senki nem tud jelölni, és megjelenik a letöltés. A *Feloldás* visszavonja.

**Naptár:** a letöltött `.ics` Google Naptárban a *Beállítások → Importálás és exportálás → Importálás* pontnál tölthető be. Az egymást követő ügyeleti napok egy eseménybe kerülnek, minden esemény egész napos, emlékeztetővel az előző nap délre. Mindenki letöltheti csak a saját napjait is.

**Hónap határa:** egy hónap tábláját azok a hetek adják, amelyek hétfője az adott hónapra esik — 2026 januárja így 01.05-től 02.01-ig tart, pontosan úgy, mint a korábbi táblázatban. A Névsor ablakban átváltható naptári hónapra.

**Névsor:** csak a véglegesítő szerkesztheti. Itt lehet nevet, színt, Google-címet módosítani, embert felvenni vagy törölni, és átadni a véglegesítői szerepet. Új ember felvételekor ne feledd őt tesztfelhasználóként is felvenni a Google Auth Platformon.

## Ha valami nem működik

| Tünet | Ok |
|---|---|
| `redirect_uri_mismatch` | A Google kliensben nem pontosan a Supabase callback URL szerepel, vagy még nem lépett érvénybe. |
| „Access blocked / nem tesztfelhasználó" | Az adott cím nincs felvéve tesztfelhasználóként a Google Auth Platform → Audience alatt. |
| „Nincs hozzáférés" képernyő | A fiók e-mail-címe nincs a `people` táblában. Betűre egyeznie kell. |
| Üres oldal, hosszú töltés | Szünetel a Supabase projekt: dashboardon *Restore*, és állítsd be az ébren tartást. |
| A többiek jelölése nem frissül | A valós idejű kapcsolat nem épült fel; 45 másodpercenként és a *Frissítés* gombra így is betölt. |
| `.ics` nem tölt le | Csak véglegesített hónapra érhető el. |

## Költség

Mindkét szolgáltatás ingyenes csomagja bőven elég: az egész évi adat néhány száz kilobájt. Bankkártya egyikhez sem kell.
