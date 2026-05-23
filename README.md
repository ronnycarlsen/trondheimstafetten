# Trondheimstafetten webapp uten brukerkonto

Dette er en gratis, mobilvennlig nettside. Den kan kjøres på GitHub Pages og bruke Supabase som gratis database. Brukerne trenger ikke konto; de åpner bare lenken.

## Rask test uten database

Åpne `index.html` i nettleseren. Da lagres alt lokalt på enheten.

## Live-løsning med én lenke

### 1. Lag Supabase-prosjekt

1. Gå til supabase.com
2. Lag gratis konto/prosjekt
3. Åpne SQL Editor
4. Lim inn innholdet fra `supabase.sql`
5. Trykk Run

### 2. Finn Supabase URL og anon key

I Supabase:

Project Settings → API

Kopier:

- Project URL
- anon public key

### 3. Lim inn i `config.js`

```js
window.STAFETT_CONFIG = {
  SUPABASE_URL: "DIN_SUPABASE_URL",
  SUPABASE_ANON_KEY: "DIN_ANON_KEY",
  EVENT_ID: "trondheimstafetten-2026"
};
```

### 4. Publiser gratis på GitHub Pages

1. Lag repository på github.com, for eksempel `trondheimstafetten`
2. Last opp disse filene i repoet:
   - `index.html`
   - `style.css`
   - `app.js`
   - `config.js`
3. Gå til Settings → Pages
4. Velg Deploy from branch
5. Velg `main` og `/root`
6. Etter kort tid får du en offentlig lenke

## Bruk på løpsdagen

1. Åpne lenken på mobil
2. Fyll inn/endrer løpernavn, distanse og hastighet
3. Når løper kommer til veksling, velg etappe og trykk `Bruk nå` + `Registrer veksling`
4. Starttidene videre beregnes automatisk
5. Trykk `Synk` hvis en mobil ikke har oppdatert

## Viktig om sikkerhet

Denne varianten er åpen for alle med lenken. Den passer for et kort arrangement, men ikke for sensitive data.
