# Difetti riproducibili prima del ripristino

Baseline verificata sul commit `f2f78ea0858a23219d0b06797f64ccbf7ad5c0c7`.

| Priorità | Riproduzione | Risultato ottenuto | Risultato atteso |
| --- | --- | --- | --- |
| P0 | Importare un contorno inclinato e trascinare un'apertura sul lato obliquo. | L'hit-test resta vincolato a quattro pareti cardinali rettangolari; il 3D posiziona l'apertura su un rettangolo diverso dal DXF. | Stesso `wallId`, stessa proiezione e stesso offset in 2D e 3D. |
| P0 | Aggiungere una porta o finestra e osservare la parete 3D dal lato opposto. | La parete resta piena; un pannello scuro o trasparente viene sovrapposto. | Il centro dell'apertura deve essere realmente vuoto nella mesh della parete. |
| P0 | Ricostruire o riordinare i segmenti DXF. | Le pareti DXF non hanno identità; le aperture usano `north/east/south/west`. | Pareti e aperture devono avere identificativi stabili condivisi. |
| P1 | Importare un rettangolo chiuso più un piccolo cerchio. | Il candidato chiuso con più punti, spesso il cerchio campionato, diventa il perimetro stanza. | Solo polilinee chiuse valide sono candidate; vince l'area valida più grande. |
| P1 | Importare un DXF 3200×2400 con `$INSUNITS=4` (millimetri). | I valori grezzi diventano 3200×2400 metri. | Conversione esplicita in 3,2×2,4 m. |
| P1 | Importare un file misto con entità supportate e non supportate. | Le entità sconosciute possono sparire senza riepilogo. | Ogni entità deve essere conservata come riferimento classificato o non classificato. |
| P1 | Importare un DXF valido, poi uno malformato. | Il vecchio stato geometrico rimane visibile senza indicare chiaramente che il nuovo import non è stato applicato. | Commit atomico del nuovo modello oppure mantenimento esplicitamente dichiarato del precedente. |
| P1 | Creare due aperture sovrapposte sulla stessa parete. | Entrambe vengono accettate. | Collisione rifiutata con messaggio utile. |
| P1 | Inserire misure stanza non valide e premere “Visualizza risultato”. | La navigazione al 3D avviene anche se l'aggiornamento dimensioni fallisce. | Restare nell'editor finché il modello è valido. |
| P1 | Eseguire il workflow GitHub Actions al commit baseline. | Il run `37164891688` fallisce: attende `__openingCount() >= 11` dopo aver creato soltanto due aperture. | La CI deve verificare invarianti reali, non un conteggio impossibile. |
| P2 | Trascinare una geometria DXF oltre i bounds iniziali. | I bounds non vengono ricalcolati durante il drag. | Bounds e viste 2D/3D devono essere derivati nuovamente dopo ogni modifica. |

Il flusso baseline era: parser DXF → globali mutabili `window.__dxf*` → SVG 2D separato → mesh 3D separate. Non esisteva un modello geometrico condiviso.
