# Mappa DXF → geometria → 2D → 3D

## Contratto condiviso

La sola fonte geometrica runtime è l'oggetto creato da `src/geometry.mjs`:

```text
RoomModel
├── units: "m"
├── vertices[]
├── walls[]: id, start, end, direction, normal, length, thickness
├── openings[]: id, wallId, offset, width, height, sill, margin, proprietà
├── references[]: entità DXF classificate o non classificate
└── source: origine e stato di modifica
```

Gli identificativi delle pareti dipendono dalle coordinate quantizzate dei due estremi e non dalla posizione della parete nell'array. Un'apertura è quindi collegata a una parete reale tramite `wallId` e a una posizione metrica tramite `offset`.

## Flusso dei dati

```text
DXF ASCII
  │ validazione struttura, limiti e unità
  ▼
parseDxf()
  │ entità + coppie grezze + candidato perimetro valido
  ▼
roomFromDxf() / createRoomModel()
  │ modello in metri, commit atomico
  ├──────────────► SVG 2D
  │                pareti, vertici, riferimenti, aperture
  │
  ├──────────────► Three.js 3D
  │                pavimento, pareti suddivise attorno ai fori,
  │                infissi e bac a quattro pendenze
  │
  └──────────────► export
                   DXF metrico, JSON del modello, GLB della scena
```

Il 2D non trasferisce coordinate al 3D tramite un secondo stato. Ogni modifica produce un nuovo `RoomModel`; entrambi i renderer leggono quel modello. `wallSurfaceRects()` suddivide una superficie muraria e omette le celle interne alle aperture: il foro 3D deriva quindi dalla stessa apertura visibile in pianta.

## Regole di importazione

- Il parser accetta soltanto testo DXF ASCII completo (`ENDSEC` e `EOF`).
- `$INSUNITS` viene convertito in metri; se manca, l'utente deve dichiarare la scala.
- Solo `LWPOLYLINE`/`POLYLINE` chiuse, semplici e di area valida possono diventare il perimetro.
- Se esistono più perimetri validi, viene scelto quello con area maggiore.
- `LINE`, `ARC`, `CIRCLE` ed `ELLIPSE` restano riferimenti; non possono sostituire la stanza.
- Bulge, OCS/extrusion non standard e `SPLINE` non vengono promossi a geometria affidabile.
- Ogni entità non classificata conserva le coppie DXF grezze nel modello per evitare una perdita silenziosa.
- Un errore di parsing non modifica il modello già aperto.

## Invarianti verificati dai test

- conversione mm → m, obbligo di scala per DXF senza unità e isolamento del valore `$INSUNITS` nel relativo record HEADER;
- identità delle pareti stabile al cambio del vertice iniziale;
- proiezione su pareti inclinate;
- margini e collisioni delle aperture;
- rifiuto di poligoni degeneri, auto-intersecanti o file troncati;
- centro dell'apertura non coperto da alcun rettangolo di parete;
- stessa apertura presente nel modello, nel disegno e nella mesh 3D;
- export DXF con unità e metadati delle aperture rileggibili, JSON completo e GLB binario;
- posizionamento finito del bac in un perimetro concavo e parità del senso porta tra 2D e 3D.

## Limiti dichiarati

Il progetto non pretende di ricostruire in modo affidabile DXF binari, blocchi `INSERT`, hatch, quote, OCS 3D, bulge o spline NURBS. Queste geometrie richiedono un motore CAD dedicato e un corpus DXF reale. Nessun file Magicplan reale o dispositivo touch fisico fa parte della fixture di test attuale.
