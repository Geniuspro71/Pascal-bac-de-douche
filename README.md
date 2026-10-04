# Pascal — Bac de douche

Applicazione statica per importare una pianta DXF, modificare il perimetro e le aperture in 2D, controllare lo stesso modello in 3D ed esportare DXF, GLB e JSON.

## Avvio locale

```sh
npm ci
npm run serve
```

Aprire `http://127.0.0.1:4173`. La versione fissata di Three.js è inclusa sotto `vendor/`; il primo caricamento 3D non dipende da un CDN esterno.

## Modello geometrico

`src/geometry.mjs` è la fonte condivisa per:

- unità interne in metri;
- vertici e pareti con identificativi stabili durante la sessione;
- direzione, normale, lunghezza e spessore di ogni parete;
- aperture collegate tramite `wallId` e offset metrico lungo il segmento;
- margini, altezza e collisioni;
- suddivisione delle superfici murarie attorno a fori reali;
- riferimenti DXF supportati e non classificati.

Il renderer SVG 2D e la scena Three.js consumano lo stesso oggetto. Le aperture 3D non sono pannelli sovrapposti a un muro pieno: le porzioni di muro che ricadono nel rettangolo dell'apertura non vengono generate.

Nell'editor 2D i vertici verdi modificano il perimetro e le aperture restano collegate alla parete tramite l'identificativo stabile. I riferimenti DXF esterni al perimetro sono visibili per controllo, ma non sono riscritti dall'editor. Il selettore tetto puramente decorativo della baseline è stato rimosso: non generava alcuna geometria e avrebbe descritto una funzione inesistente.

## Importazione DXF

Sono gestiti in modo locale e deterministico i DXF ASCII con:

- `LINE`;
- `LWPOLYLINE` e `POLYLINE`;
- `ARC` e `CIRCLE` con approssimazione controllata;
- `ELLIPSE` come riferimento approssimato;
- layer e `$INSUNITS` per metri, centimetri, millimetri, pollici e piedi.

Solo una `LWPOLYLINE` o `POLYLINE` chiusa, semplice e con area valida può diventare il perimetro della stanza. Tra più candidati validi viene usata quella con area maggiore; cerchi e annotazioni non possono sostituirla. Se `$INSUNITS` manca, l'utente deve scegliere l'unità nell'interfaccia prima che il DXF sostituisca la stanza corrente. Un import fallito non muta il progetto precedente.

Limiti dichiarati: DXF binario, OCS/extrusion 3D, bulge delle polilinee, `SPLINE`, hatch, quote e blocchi `INSERT` non vengono convertiti in pareti. Le coppie DXF originali delle entità non classificate sono conservate nel modello e conteggiate nel riepilogo.

## Test

```sh
npm run check:syntax
npm run test:unit
npx playwright install chromium
npm run test:browser
# oppure l'intero gate locale:
npm test
```

I test unitari coprono conversione unità, header `$INSUNITS` malformato, campionamento curve limitato, selezione del contorno, geometrie inclinate, proiezione punto-segmento, identità delle pareti, margini, collisioni, topologia invalida, file troncati e fori murari. I test Playwright eseguono il percorso utente, importano un DXF sintetico dichiarato, verificano il blocco delle misure invalide, la collisione tra aperture, la mesh 3D realmente forata, il bac a quattro pendenze con scarico 10×10 cm anche in un perimetro concavo, il senso porta in 2D/3D, i materiali, gli export JSON/DXF/GLB, il round-trip delle aperture e il viewport mobile.

Le fixture sotto `tests/fixtures/` sono sintetiche e non provengono da Magicplan o da clienti reali.

## Pubblicazione

GitHub Pages pubblica il contenuto statico del repository secondo le impostazioni del progetto. La workflow `.github/workflows/3d-site-check.yml` esegue il gate automatico sul codice inviato; GitHub Pages e la CI restano due processi distinti e lo stato della demo deve essere verificato separatamente dopo ogni pubblicazione.
