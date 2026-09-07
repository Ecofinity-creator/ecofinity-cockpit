# Ecofinity — Order & Project Cockpit

Cockpit voor Ecofinity's bestaande zeven Teamleader-projectfasen (Bij bestelling → ... →
Administratie afgewerkt). Teamleader blijft overal de *source of truth*; deze repo voegt
geen nieuwe of alternatieve fasenstructuur toe.

## Structuur

- **`frontend/ecofinity-cockpit.html`** — de cockpit zelf: dashboard, bestelwachtrij,
  planningswachtrij, kanban, doorlooptijd en fase-instellingen. Eén standalone HTML-bestand,
  gewoon te openen in een browser. Draait standaard in demo-modus (voorbeelddata) en kan via
  de instellingenpagina live gekoppeld worden aan de backend hieronder.
- **`backend/`** — de Node.js/Express-backend die de Teamleader-koppeling verzorgt (OAuth2,
  sync-engine, database, REST-API). Zie `backend/README.md` voor het volledige
  architectuuroverzicht en de opstartinstructies (mock-modus zonder Teamleader-account, of
  live met een echte marketplace-app + Postgres-database).

## Snel starten

```bash
cd backend
npm install
cp .env.example .env      # MOCK_MODE=true staat al standaard aan
node src/server.js
```

Open daarna `frontend/ecofinity-cockpit.html` in de browser, ga naar "Fase-instellingen" en
verbind met `http://localhost:4000`.

## De cockpit openen via GitHub (GitHub Pages)

Deze repo bevat `.github/workflows/publish-pages.yml`, die bij elke push naar `main`
automatisch `frontend/ecofinity-cockpit.html` publiceert als een echte, deelbare webpagina.

**Eénmalig in te stellen** (dit kan ik niet namens jou doen zonder toegang tot je
GitHub-account):
1. Ga in de repo naar **Settings → Pages**.
2. Zet bij **"Build and deployment" → Source** de waarde op **"GitHub Actions"**
   (niet "Deploy from a branch").
3. Push een wijziging naar `main` (of open het tabblad **Actions** en start de workflow
   "Publiceer cockpit op GitHub Pages" handmatig via **"Run workflow"**).

Na een paar minuten verschijnt de link bovenaan onder **Settings → Pages**, in het formaat:
```
https://<jouw-gebruikersnaam>.github.io/<jouw-repo>/
```
Elke volgende push die `frontend/ecofinity-cockpit.html` wijzigt, publiceert automatisch
een bijgewerkte versie op datzelfde adres.

## De backend hosten (zodat de live-koppeling ook vanaf de gepubliceerde link werkt)

De gepubliceerde cockpit-pagina (hierboven) draait standaard in demo-modus, omdat ze vanaf
een andere plek in de wereld geen `localhost:4000` kan bereiken. Om de "Verbinden"-knop op
de instellingenpagina écht te laten werken, moet de backend ergens publiek bereikbaar
draaien. Deze repo bevat `render.yaml`, waarmee **Render.com** dat automatisch doet (gratis
laag, geen creditcard nodig).

**Optie A — Blueprint (automatisch, aanbevolen):**
1. Maak een account op [render.com](https://render.com) en meld je aan met je GitHub-account.
2. Ga naar [dashboard.render.com/select-repo?type=blueprint](https://dashboard.render.com/select-repo?type=blueprint)
   en kies deze repo (`ecofinity-cockpit`).
3. Render leest `render.yaml` automatisch uit en stelt de service voor. Klik **"Apply"**.
4. Wacht tot de eerste build/deploy klaar is (paar minuten) — de dashboard-pagina toont
   dan een publieke URL, in het formaat `https://ecofinity-cockpit-backend.onrender.com`.

**Optie B — Handmatig, als de Blueprint-knop niet beschikbaar is:**
1. Render-dashboard → **New +** → **Web Service** → kies deze repo.
2. **Root Directory**: `backend`
3. **Build Command**: `npm install`
4. **Start Command**: `node src/server.js`
5. **Instance Type**: Free
6. Onder **Environment**: voeg `MOCK_MODE` = `true` toe.
7. **Create Web Service**.

**Daarna, in de gepubliceerde cockpit:**
1. Open je GitHub Pages-link.
2. Ga naar **Fase-instellingen** → **Teamleader-koppeling**.
3. Vul de Render-URL in (bv. `https://ecofinity-cockpit-backend.onrender.com`) en klik
   **Verbinden**.

Let op: op de gratis laag van Render "slaapt" de service na ± 15 minuten zonder verkeer.
De eerste request daarna duurt 30–60 seconden (opstarttijd) — dat is normaal, geen fout.

Zodra jullie klaar zijn voor de échte Teamleader-koppeling (i.p.v. mock-data), zet dan in
Render's **Environment**-instellingen `MOCK_MODE=false` en vul de overige variabelen aan
zoals beschreven in `backend/README.md` (inclusief een Postgres-database — Render biedt
daar ook een gratis laag voor via **New + → PostgreSQL**).
