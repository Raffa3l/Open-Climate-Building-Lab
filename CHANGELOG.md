# Änderungen

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

Zusätzlich zur Projektversion trägt **jedes Rechenverfahren eine eigene
Version** in seinem `MethodRef`. Sie wird erhöht, sobald sich Ergebnisse für
gleiche Eingaben ändern — auch bei einer Fehlerkorrektur, damit publizierte
Werte zuordenbar bleiben. Solche Änderungen stehen unten unter
**Verfahrensversionen** und sind für Nutzerinnen der API die wichtigste Rubrik:
ein erhöhter Verfahrensstand ändert alle davon abhängigen Berechnungs-Hashes.

## [Unveröffentlicht]

### Hinzugefügt
- **Download** (`core/src/export.ts`, [010](docs/methods/010-export.md)): je
  Klimastand eine Stundenreihe als CSV und ein Manifest als JSON, im Frontend
  unter «Daten herunterladen». Das Manifest führt für Simulation,
  Übertemperaturstunden, Komfortband und gleitendes Mittel je Hash, kanonische
  Form, Verfahren, Parameter und Eingangsdaten, dazu die SHA-256 der CSV und die
  vollständigen Quellenangaben. Die Prüfanleitung in 010 braucht nur die
  Python-Standardbibliothek.
- Der Serialisierer liegt im Kern, damit ein Aufruf aus der Kommandozeile
  dieselben Bytes erzeugen kann wie der Browser. Das Manifest hat keinen
  Erstellungszeitpunkt: Zwei Exporte desselben Sachverhalts sind byte-gleich.
  Acht Tests, darunter die Summenprobe gegen die Kennzahl für beide
  Zeitkonventionen.
- **Export aus der Kommandozeile** (`core/scripts/export.ts`): nimmt einen
  Permalink und schreibt dieselben Dateien wie der Download im Browser. Dafür
  liegen Referenzraum, Belegungsfenster, Reglerbereiche und die Lesart des
  Permalinks jetzt in `core/src/reference-case.ts` statt in `web/app.js`;
  Browser und Skript rufen dieselbe Funktion `referenceCaseExport()` auf. Eine
  Reglerstellung, die es nicht gibt, bricht im Skript ab, statt still gerundet
  zu werden. Der Export lehnt Einstellungen ab, die nicht zur Simulation passen.
  Neun Tests, einer davon hält die Regler in `web/index.html` auf die Stellungen
  und Vorgaben des Kerns fest.
- **Vergleichsmodus im Frontend:** Ein zweiter Klimastand liegt über demselben
  Verlauf, gemessenes Jahr gegen Szenario oder Szenario gegen Szenario. Beide
  Reihen rechnen denselben Raum mit denselben Parametern; verschieden ist
  allein das Aussenklima. Jede Kennzahl trägt den Vergleichswert und die
  Differenz, «Berechnung anzeigen» führt beide Berechnungs-Hashes und beide
  Eingangsdatensätze, die Tabelle stellt die überschrittenen Tage beider
  Reihen nebeneinander. Der Zustand steht im Permalink (`compare=`); ohne
  Vergleich bleibt die Adresse unverändert wie zuvor.
- **Jede Reihe bringt ihre eigene Komfortgrenze mit.** Das adaptive Band folgt
  dem gleitenden Mittel der Aussentemperatur und liegt im wärmeren Klimastand
  höher. Mit nur einer Grenze läse man die Überschreitung des zweiten
  Klimastands an der falschen Schwelle ab.
- `series.alignDailyToCalendarYear()` bildet eine Tagesreihe über (Monat,
  Tag) auf ein anderes Kalenderjahr ab. Ein DRY hat 365 Tage, ein Messjahr
  möglicherweise 366; über den Laufindex gezeichnet verschöbe sich die zweite
  Kurve ab dem 1. März um einen Tag. Ein 29. Februar ohne Gegenstück bleibt
  `NaN` statt interpoliert. Im Kern, nicht im Frontend: Zeitkonventionen
  gehören zum Rechenkern.
- **Farbrolle `--series-2`** (`#008300`) und ein Abschnitt zum Vergleich in
  [007](docs/methods/007-visualisierung.md).
- `solar` — Sonnenstand nach Michalsky/NOAA, Diffusanteil nach Erbs (1982),
  Einstrahlung auf geneigte Flächen im isotropen Himmelsmodell (Liu & Jordan).
- `building` — Raummodell **5R1C nach EN ISO 13790:2008**, Simple Hourly
  Method: Bauartklassen nach Tabelle 12, Sonnenschutzregelung an einer
  Bestrahlungsschwelle, Nachtlüftungsregelung, Belegungsprofil mit
  Wochenendaussparung, `warmupHours()` für die Einschwingphase.
- `core/scripts/overheating.ts` — Übertemperaturstunden für Parametervarianten
  eines Raums an einer realen Station.
- Methodenseiten [005](docs/methods/005-solar.md) und
  [006](docs/methods/006-room-model-5r1c.md).
- **Messreihe ab 1991** für die 41 Stationen mit Szenariodaten: 1972
  Stationsjahre, 2242 Dateien insgesamt, 353 MB. Damit steht als
  Vergleichsbasis eine echte Normalperiode 1991–2020 statt einer Handvoll
  aktueller Jahre.
- **Messreihe ab 1991 für alle Stationen**: 2'177 weitere Stationsjahre für die
  117 Stationen, die bisher nur 2020–2024 hatten, zusammen 4'154 Stationsjahre
  und 594 MB. 70 Stationen reichen bis 1991 zurück, viele erst bis 2010–2015.
  257 Jahre fehlen, weil die Dekadendatei vor dem Messbeginn der Station
  beginnt. Die 1'977 bisherigen Dateien blieben byte-gleich. Fürs Raummodell
  taugen nur Jahre mit Temperatur und Globalstrahlung (`roomModelYears`), weil
  viele Stationen die Strahlung erst seit etwa 2010 messen.
- **Vordach oder Balkon über dem Fenster** ([011](docs/methods/011-vordach.md)),
  im Frontend als Regler von 0 bis 2 m Auskragung. Der Schatten folgt dem
  Profilwinkel, der gleichmässige Himmel verliert Sichtfaktor nach der
  Fadenmethode, Aufhellung um die Sonne wird wie Direktstrahlung beschattet,
  Horizont und Boden bleiben unberührt. Dafür liefert die Einstrahlung ihren
  Diffusanteil jetzt in drei Teilen. Ohne Vordach fehlt das Feld im Fenster, und
  alle bisherigen Hashes bleiben gleich. Sieben Tests, darunter eine
  Strahlverfolgung über 324 Sonnenstände und die Bemessung aus dem NREL-Handbuch.
  Zürich/Fluntern 2023 ohne Sonnenschutz: 1'308 Übertemperaturstunden, mit 1 m
  Vordach 478; mit Sonnenschutz 501 und 385.
- **Szenarien im Mehrjahresverlauf** ([012](docs/methods/012-mehrjahresverlauf.md#szenarien)):
  An den Szenariostationen stehen rechts neben den Messjahren die sechs
  DRY-Szenarien, Punkt für das Referenzjahr, Ring für den warmen Sommer, dazu
  das Mittel der Normalperiode 1991–2020 als Linie über die ganze Breite.
  Das Mittel ist eine eigene `Computation` (`stats.periodMean`) mit jedem Jahr
  als Vorgänger und gilt erst ab 24 der 30 Jahre. `trend.ts` gibt Mittel und
  Szenarien mit Hash aus; Browser und Skript stimmen überein. Zürich/Fluntern:
  Mittel 1991–2020 343 h, 2060 RCP 8.5 Referenzjahr 465 h (+122), warmer
  Sommer 624 h (+281); das Mittel 2015–2024 liegt mit 425 h schon nahe am
  Referenzjahr 2060 RCP 8.5.
- **Mehrjahresverlauf** ([012](docs/methods/012-mehrjahresverlauf.md)): derselbe
  Raum in jedem Messjahr der Station, im Frontend als Säulen mit linearem Trend
  unter «Übertemperaturstunden je Messjahr». Geladen wird erst auf Knopfdruck,
  der die Datenmenge nennt (Zürich/Fluntern 34 Jahre, rund 6 MB); danach
  rechnet der Verlauf bei jedem Reglerzug mit, 34 Jahre in rund 115 ms. Der
  Trend ist eine eigene `Computation` (`stats.linearTrend`) mit jedem Jahr als
  Vorgänger im Hash, verankert an Anscombes vier Datensätzen. Es zählen Jahre
  mit mindestens 95 % Temperatur und Strahlung; die Regel liegt im Kern
  (`isCompleteMeasuredYear`) und gilt auch in `stations.ts`, `climate-change.ts`
  und dem neuen `core/scripts/trend.ts`. Ein Permalink mit `trend=1` lädt den
  Verlauf mit. Zürich/Fluntern, Voreinstellung: +46 Übertemperaturstunden pro
  Jahrzehnt, r² 0.31, Mittel 289 h in 1991–2000 und 425 h in 2015–2024.
- **Verbauung gegenüber** ([011](docs/methods/011-vordach.md#verbauung)), im
  Frontend als Verbauungswinkel von 0° bis 60° über dem Horizont, von der
  Fenstermitte aus. Unter dem Winkel fallen Direktstrahlung und Aufhellung um
  die Sonne weg, der Horizontstreifen ebenso; der Himmel wird zusammen mit dem
  Vordach in geschlossener Form über die Fensterhöhe gemittelt. Die
  Sichtfaktorregel ist an Okes Strassenschlucht verankert (ψ = cos β). Ohne
  Verbauung bleiben alle Hashes gleich, auch die mit Vordach. Zürich/Fluntern
  2023 ohne Sonnenschutz, Westfassade: 1'099 Übertemperaturstunden frei, 697
  bei 30°; Südfassade 1'308 und 1'154.

### Geändert
- **Tagstunden ohne Globalstrahlung sind nicht rechenbar.**
  `building.simulate5R1C` 1.4.0 setzt fehlende Strahlung bei Sonne über dem
  Horizont nicht mehr still auf 0 W/m², sondern behandelt die Stunde wie eine
  fehlende Aussentemperatur
  ([006](docs/methods/006-room-model-5r1c.md#fehlende-messwerte)). Vals 2021
  misst die Globalstrahlung an 6 % der Stunden und wies 1'464 bewertete Stunden
  aus, gerechnet für einen Raum ohne Sonne; jetzt sind es 19. Das Frontend nennt
  die nicht gerechneten Tagstunden unter der Kennzahl und im Nachweis, das
  Manifest führt sie als `missingSolarHours`. Nachgerechnet für alle 3'098
  tauglichen Stationsjahre: 2'911 unverändert, 187 verlieren Stunden, davon 149
  weniger als 100, und 52 ändern die Übertemperaturstunden, am stärksten
  Grenchen 2010 von 63 auf 0. Alle Simulations-Hashes sind neu; Zürich/Fluntern
  2024 mit 40 % und 70 % Fensteranteil trägt `609ae7766214` und `a83613f02679`,
  bei unveränderten 403 und 662 h.
- **Zyklischer Vorlauf statt verworfener Einschwingphase**
  ([ADR 0008](docs/adr/0008-zyklischer-vorlauf.md)). `building.simulate5R1C`
  1.3.0 rechnet vor der ersten Stunde das Ende derselben Reihe durch, so lange
  wie die bisherige Einschwingphase (mittlere Bauart 840 h). Jede Stunde des
  Jahres ist gültig: Diagramm, Tagestabelle, Spitzentemperatur und CSV-Export
  beginnen am 1. Januar statt Anfang Februar. `spinUpHours` steht in den
  Parametern, `0` stellt das alte Verhalten her. `comfort.exceedanceHours` 2.1.0
  rechnet den Vorlauf an und verwirft nichts mehr. Keine Kennzahl ändert sich,
  alle Hashes schon. Vier Tests, einer weist nach, dass der Vorlauf exakt dem
  vorangestellten Reihenende entspricht.
- **Verkettete Berechnungs-Hashes**
  ([ADR 0007](docs/adr/0007-verkettete-berechnungs-hashes.md)). `Computation`
  hat ein optionales Feld `upstream` mit den Berechnungen, auf denen sie
  aufbaut. Deren kanonische Form steht verschachtelt in der eigenen, der Hash
  umfasst damit die ganze Kette. Ohne Vorgänger entfällt das Feld, und der Hash
  bleibt byte-gleich; ein fester Anker im Test hält das fest.
- **`comfort.exceedanceHours` auf 2.0.0:** nimmt Simulation und Komfortband als
  `Computation` statt nackter Reihen. Die Einschwingphase verwirft die Funktion
  selbst (`params.warmupHours`), die Kategorie kommt aus dem Band. Die Werte
  für gleiche Eingaben sind unverändert, die Hashes neu.
- **`comfort.adaptiveComfortBand` auf 2.0.0:** nimmt das gleitende Mittel als
  `Computation`, damit α in den Hash eingeht.
- Die Exportdateien tragen den Hash der Übertemperaturstunden statt des
  Simulations-Hashes. Er umfasst jetzt Raum, Komfortband und Datensatz.
- `core/scripts` ist in der Typprüfung. Dabei zwei Typfehler in
  `climate-change.ts` behoben: `loadSeries()` verlangte den ganzen `YearMeta`,
  braucht aber nur Pfad und Prüfsumme.
- Die Bezeichnung eines Szenarios kommt jetzt überall aus derselben Funktion.
  Der Untertitel las zuvor `meta.label` aus dem Detailindex („RCP85"), das
  Auswahlfeld dagegen „RCP 8.5"; nebeneinander gestellt fiel die
  Doppelschreibweise auf.
- **`building.simulate5R1C` auf 1.2.0**, weil Perez das neue Standard-Modell
  ist. Zuvor 1.1.0 wegen der Himmelsabstrahlung.
- **`solar.tiltedIrradiance` auf 1.0.1:** Die Direktnormalstrahlung ist auf
  1.035 · 1367 W/m² begrenzt — die extraterrestrische Bestrahlungsstärke im
  Perihel. Ohne Grenze erzeugte die Zerlegung I_bn = I_b/sin(h) bei flachem
  Sonnenstand Werte von mehreren tausend W/m². Betrifft 5 von 26'078
  Sonnenstunden an Zürich/Fluntern (0.019 %).
- **`building.simulate5R1C` auf 1.1.0**, weil die Himmelsabstrahlung die
  Ergebnisse für gleiche Eingaben ändert. Alle davon abhängigen
  Berechnungs-Hashes ändern sich mit. `skyViewFactor: 0` schaltet den Term ab,
  reproduziert aber nicht den 1.0.0-Hash — das ist beabsichtigt.
- `SimulationResult.skyLoss` meldet den **wirksamen** Verlust F_r · Φ_r, nicht
  den ungewichteten. Die erste Fassung war hier zweideutig.
- **Normzuordnung korrigiert:** Das 5R1C-Modell stammt aus EN ISO 13790:2008,
  nicht aus ISO 52016-1. 52016-1 hat 13790 abgelöst, verwendet aber ein
  anderes, knotenbasiertes Stundenverfahren. Die früheren Verweise waren
  falsch und sind in allen Dokumenten berichtigt.

### Behoben
- Das Stylesheet liess Elemente mit eigenem `display` trotz `hidden` stehen:
  `.tile-delta` und die neue Ladezeile des Mehrjahresverlaufs setzen
  `display: flex`, und das schlägt die Regel des Browsers für `[hidden]`. Bei
  den Kacheln blieb das unsichtbar, weil das Element ohne Vergleich leer ist.
  Jetzt gilt `[hidden] { display: none !important; }`.
- **`climate-change.ts` brach an Stationen mit Jahren ohne Globalstrahlung
  ab**, etwa Grenchen, weil es jedes Jahr mit vollständiger Temperatur rechnete.
  Das Skript nimmt jetzt nur `roomModelYears` und verlangt wie `stations.ts` 95 %
  Vollständigkeit auch bei der Strahlung; ein lückenhaftes Jahr rechnet seit
  `simulate5R1C` 1.4.0 weniger Stunden und drückte das Mittel der Basis.
  Ausgelassene Jahre werden gemeldet. Die Ausgaben für alle 41 Szenariostationen
  und `stations.ts` 2023 und 1995 sind Zeichen für Zeichen gleich geblieben.
- **Stationsfähigkeiten galten für die ganze Station statt je Jahr.** Der
  Katalog bildete sie aus der Vereinigung der Variablen über alle Jahre. Mit
  der längeren Historie hätte das Frontend 641 Stationsjahre an 39 Stationen
  angeboten, denen Temperatur oder Globalstrahlung fehlt; sie brechen beim
  Laden ab. St. Chrischona galt als raummodellfähig, ohne ein einziges Jahr mit
  beidem. Schon vorher bot das Frontend Bergün 2020 und Vals 2020 an, beide ohne
  Strahlungsmessung. Eine Fähigkeit gilt jetzt, wenn ein einzelnes Jahr sie
  erfüllt, und der Katalog führt die tauglichen Jahre in `roomModelYears`.
  Frontend, `export.ts` und `stations.ts` bieten nur diese an; ein Test prüft
  jede Station gegen die Detaildatei.
- Ein Permalink mit einer Station oder einem Jahr, das die Auswahl nicht
  anbietet, leerte das Auswahlfeld, und das Frontend meldete « hat keinen
  Datensatz». Die Werte wurden nach der Prüfung ein zweites Mal ungeprüft
  gesetzt. Jetzt fällt ein solcher Link auf die Voreinstellung zurück, die
  Regler übernimmt er weiterhin. Die Kommandozeile bricht in beiden Fällen mit
  den tauglichen Jahren ab.
- **Nächtliche Strahlungswerte bis 2003 fielen als Fehlwerte aus.** Die
  Gültigkeitsgrenze der Global- und Diffusstrahlung lag bei 0 W/m². MeteoSchweiz
  liefert bis 2003 aber den Nullpunktversatz der Pyranometer mit, vor allem −1
  bis −4 W/m² in der Nacht, rund 1.34 Mio. Werte. Zürich/Fluntern 1991 erschien
  dadurch zu 83.6 % vollständig, obwohl keine Stunde fehlt, und eine echte Lücke
  am Tag war von einer verworfenen Nacht nicht zu unterscheiden. Die Grenze liegt
  jetzt bei −30 W/m², dem zulässigen Nullpunktversatz der Klasse C nach
  ISO 9060:2018 ([004](docs/methods/004-binary-format.md#negative-strahlung-ist-ein-messwert)).
  929 Stationsjahre sind neu gepackt, ihre Prüfsummen und Berechnungs-Hashes neu.
  Werte unter −30 W/m², bis −1'666'666, bleiben verworfen. **Kein Ergebnis
  ändert sich:** Das Raummodell setzt negative Einstrahlung auf 0. Nachgerechnet
  am Referenzfall für alle 3'098 Stationsjahre mit Temperatur und Strahlung:
  Übertemperaturstunden, bewertete Stunden, Spitzentemperatur und Zahl der
  gültigen Stunden sind überall gleich.
- **Der Nachweis im Frontend beschriftete Diffusstrahlung und Himmelstemperatur
  nach den Fähigkeiten der Station**, nicht nach der gerechneten Reihe. Schon im
  bisherigen Datenstand erschienen 506 Stationsjahre als «Diffusstrahlung
  gemessen», obwohl die Reihe keine führt, etwa Adelboden 1991; mit der längeren
  Historie wären es 995 gewesen. Bei 454 Stationsjahren fehlte der Hinweis
  «Pauschalwert der Norm» zur Himmelstemperatur. Gerechnet wurde richtig: Das
  Modell nimmt, was die Reihe führt. Die Beschriftung folgt jetzt der geladenen
  Reihe und der Simulation.
- **`core/scripts/overheating.ts` rechnete mit halb so viel Sonnendurchlass wie
  beschriftet.** Die Zeile «Sonnenschutz g_tot 0.15» setzte 0.15 als
  Abminderungsfaktor ein; bei g = 0.5 ergibt das g_tot 0.075. Das Frontend
  rechnet g_tot richtig in den Faktor 0.3 um. Nachgewiesen über den Hash: Der
  Referenzraum mit g_tot 0.075 trägt exakt den Hash der alten Basiszeile.
  Zürich/Fluntern 2023, Basis 1'773 statt 1'624 Übertemperaturstunden, mit
  Nachtlüftung 501 statt 319. Die Varianten ohne Sonnenschutz waren richtig.
  `overheating.ts`, `stations.ts` und `climate-change.ts` bauen den Raum jetzt
  nicht mehr selbst, sondern nehmen Referenzraum und Auswertung aus
  `core/src/reference-case.ts` wie der Browser. Die Zeile mit Nachtlüftung
  trägt damit denselben Hash wie die Voreinstellung der App. `stations.ts` und
  `climate-change.ts` rechneten schon richtig; ihre Ausgabe ist Zeichen für
  Zeichen gleich geblieben. Die README-Tabelle ist nachgeführt, sie war
  bereits vorher veraltet.
- **Quellenangabe in ASCII-Umschrift.** Autor und Titel standen als «Bundesamt
  fuer Meteorologie und Klimatologie MeteoSchweiz» und «Klimaszenarien fuers
  zukuenftige Innenraumklima (SIA 2028)» in den Datensätzen, damit auch in jeder
  Quellenangabe, in der Fusszeile und im Manifest des Downloads. Der Header
  schreibt UTF-8, die Umschrift war keine Absicht. Weil die Texte im Header und
  damit in der Prüfsumme stehen, **ändern sich alle Prüfsummen und alle
  Berechnungs-Hashes**; Werte und CSV-Exporte bleiben gleich. Korrigiert vor der
  ersten Publikation, damit kein Permalink bricht. Die Falle steht in
  [004](docs/methods/004-binary-format.md#die-quellenangabe-gehört-zur-prüfsumme)
  und in CLAUDE.md.
- **Der Kopf von `catalog.json` behielt die alte Quellenangabe.** `load()`
  übernahm Sammlung, Lizenz und Autor aus dem bestehenden Katalog und setzte
  sie nur beim ersten Anlegen aus dem Code. Nach dem Neubau trugen alle
  Datensätze die korrigierte Schreibweise, die Fusszeile des Frontends aber
  weiter «fuer». Aufgefallen bei der Prüfung der Fusszeile, weil der
  Wertevergleich nur die `.ocbl`-Dateien umfasste. Die Angaben kommen jetzt bei
  jedem Laden aus dem Code; die Fusszeile zeigt den Katalogstand zudem als
  Datum im Schweizer Format statt als ISO-Zeitstempel.
- Beim Neubau nach Rezept kam die Station **Uetliberg (UEB)** hinzu, eine
  reine Strahlungsmessstelle mit gemessener Diffusstrahlung. Im Frontend
  erscheint sie nicht, weil ihr die Temperatur fehlt. Stand damit 158 Stationen
  und 1'977 Stationsjahre.
- **`core/scripts/model-effects.ts` lief nicht mehr.** Es griff direkt auf
  `entry.years["2023"].path` zu; seit der Aufteilung des Katalogs in Index und
  Detaildateien ist `years` eine Liste. Umgestellt auf `station()` wie die
  übrigen Skripte. Die Ausgabe deckt sich mit den dokumentierten Zahlen:
  Himmelsabstrahlung Neubau −8.9 %, Altbau −25.5 %, Perez gegen isotrop +4.4 %
  und +5.7 %.
- **Die Tagestabelle wies bei Szenarien zu viele Übertemperaturstunden aus.**
  Das Frontend zählte die Stunden je Tag selbst und leitete die Lokalstunde aus
  dem Zeitstempel ab. Für Messreihen (Stempel am Intervallende) war das
  zufällig richtig, für die DRY-Szenarien (Intervallbeginn, Stichzeitpunkt
  hh:10) lag das Belegungsfenster eine Stunde zu früh. Zürich/Fluntern: 423
  statt 369 Stunden (2035 RCP 8.5), 529 statt 465 (2060 RCP 8.5). Die Kennzahl
  in der Kachel war nie betroffen, sie kam immer aus dem Kern. Die Zählung
  steht seit `ea05b7f` im Frontend, wirksam wurde der Fehler mit `c74e6a1`:
  Die Szenarien sind die erste Quelle mit Stempel am Intervallbeginn.
- `comfort.exceedanceHours` liefert dafür neu `dailyHours` und
  `dailyKelvinHours` aus derselben Schleife wie die Jahressummen. Tabelle und
  Tooltip lesen nur noch diese Werte; das Frontend hat keine eigene
  Stundenzuordnung mehr. **Ohne Versionssprung:** Keine bestehende Zahl ändert
  sich für gleiche Eingaben, und ein Sprung hätte über den Berechnungs-Hash
  jeden Permalink gebrochen. Drei neue Tests, einer davon mit der
  Zeitkonvention der Szenarien.
- **Das Diagramm verdoppelte auf Bildschirmen mit `devicePixelRatio > 1` bei
  jedem Neuzeichnen seine Höhe.** `drawChart()` las die Sollhöhe aus dem
  `height`-Attribut des Canvas und schrieb in derselben Funktion
  `canvas.height = cssHeight · dpr`, also in genau dieses Attribut. Beim
  ersten Laden fiel das nicht auf, beim ersten Reglerzug wuchs das Bild auf das
  Doppelte, nach acht Zügen auf 21'760 px. Die Sollhöhe steht jetzt in
  `data-height`, das der Code nie beschreibt. Gefunden beim Browsertest des
  Vergleichsmodus; der Fehler ist älter und betrifft jede Zeigerbewegung.
- **Alle Prüfsummen haben sich geändert**, weil Titel und Link in den
  `.ocbl`-Header wandern. Damit ändern sich auch alle Berechnungs-Hashes.
  Vor der ersten Publikation ist das folgenlos — später wäre es das nicht.
- Drei Skripte hingen nach der Katalogtrennung noch an der alten Struktur.
  `report.ts` und `overheating.ts` scheiterten, `stations.ts` war bereits
  angepasst. Der Zugriff liegt jetzt in `core/scripts/catalog.ts`, damit es
  beim nächsten Formatwechsel eine Stelle statt vier sind.
- `catalog.load()` setzte fehlende Detaildateien still auf `{}` zurück und
  überschrieb damit beim nächsten `save()` den gesamten Index. Passiert genau
  einmal, beim Einführen der Trennung selbst. Fehlende Detaildateien brechen
  jetzt laut ab.
- `scripts/build-web.sh` kopierte den Datenstand; bei 138 MB in einem
  synchronisierten Ordner ist das untragbar. Jetzt ein Symlink.

### Gemessen
- **Vorlauf, Zürich/Fluntern:** 2023, 2024 und Szenario 2060 RCP 8.5, je in
  drei Bauarten. Ohne Vorlauf lag die Raumtemperatur in der ersten Stunde 1.7
  bis 7.5 K unter dem Wert mit Vorlauf. Nach der bisherigen Einschwingphase
  unterscheiden sich beide Rechnungen um höchstens 1.3·10⁻⁶ K;
  Übertemperaturstunden und bewertete Stunden sind in allen neun Fällen gleich,
  ebenso die Ausgaben von `overheating.ts`, `stations.ts`, `climate-change.ts`
  und `model-effects.ts`. Gegen einen Vorlauf aus dem echten Dezember des
  Vorjahres (2022–2024, fünf Fälle) weicht der zyklische Vorlauf im Januar im
  Mittel um 0.10 bis 0.77 K ab, am 1. Januar 2024 um 7.6 K, nach 6 bis 15 Tagen
  um weniger als 0.1 K. Die Kennzahlen sind gleich. Die ÜTS-Hashes für 40 %
  und 70 % Fensteranteil 2024 waren damit `d34b3cea91a4` und `dc8301f5c4e1`,
  bis `simulate5R1C` 1.4.0; das Prüfbeispiel aus 010 bestand gegen den neuen
  Export.
- **Neubau mit korrigierter Quellenangabe, 14.09.2026:** alle 2'242 bisherigen
  Dateien (1'972 Stationsjahre, 270 Szenarien) über den Rechenkern decodiert
  und gegen den Stand davor verglichen. Zeitachse, Station, Höhe, Quelle
  ausser Autor und Titel sowie jede Variable Stunde für Stunde sind gleich;
  jede Prüfsumme ist neu, keine Datei trägt mehr die Umschrift. `verify`
  prüft 2'247 Dateien ohne Beanstandung. Die Exporte der beiden Permalinks aus
  dem Vergleich Browser gegen Kommandozeile ergeben byte-gleiche CSV-Dateien
  und dieselben Kennzahlen, unter neuen Hashes: 40 % und 70 % Fensteranteil
  2024 `26af2efcec98` und `e6906664b0ab`. Die Hashes weiter unten in dieser
  Rubrik gehören zum Datenstand davor.
- **Export Browser gegen Kommandozeile, Zürich/Fluntern:** zwei Permalinks, die
  Voreinstellung mit 2024 gegen 2060 RCP 8.5 und eine Stellung mit jedem Regler
  verändert mit 2023 gegen 2035 RCP 8.5 warmer Sommer. Die acht Dateien des
  Skripts sind byte-gleich zu denen des Frontends, und beide byte-gleich zu den
  Exporten vor dem Umbau. Keine Zahl und kein Hash hat sich verschoben.
- **Export Zürich/Fluntern, Voreinstellung:** gemessen 2024 ergibt 8'784
  Zeilen, 647 kB CSV und 11.4 kB Manifest, Szenario 2060 RCP 8.5 ergibt 8'760
  Zeilen und 648 kB. In beiden Dateien summieren die Zeilen mit Überschreitung
  genau auf die Kennzahl (403 und 465 h). Das Python-Beispiel aus 010, wörtlich
  aus der Doku extrahiert, besteht gegen beide Dateien alle drei Prüfungen.
- **Nachmessung ADR 0007, Zürich/Fluntern 2024, Voreinstellung:** Simulation
  (`a2fc5ec2f2ac`) und gleitendes Mittel (`5911973a7211`) behalten ihren Hash,
  Komfortband und Übertemperaturstunden erhalten neue. 40 % und 70 %
  Fensteranteil ergeben 403 und 662 h unter den ÜTS-Hashes `1239df88adda` und
  `81f396dc6568`; vorher trugen beide `5e2124ea304d`. Die Werte selbst sind
  unverändert, die Tabellensummen treffen die Kennzahl, und das Python-Beispiel
  aus 010 besteht gegen die neu benannten Exporte.
- **Warum der Vergleichsmodus einen Hinweis braucht.** Derselbe Raum in der
  Voreinstellung des Frontends, Zürich/Fluntern, Übertemperaturstunden:

  | Klimastand | UTS | Kh | Spitze |
  |---|---:|---:|---:|
  | gemessen 2003 | 526 | 1'066 | 36.7 °C |
  | gemessen 2023 | 501 | 801 | 36.3 °C |
  | gemessen 2024 | 403 | 596 | 33.7 °C |
  | Szenario 2060 RCP 2.6 | 336 | 504 | 35.0 °C |
  | Szenario 2035 RCP 8.5 | 369 | 599 | 35.6 °C |
  | Szenario 2060 RCP 8.5 | 465 | 825 | 37.5 °C |
  | Szenario 2060 RCP 8.5, warmer Sommer | 624 | 1'329 | 38.9 °C |

  **Innerhalb** des Szenariensatzes ist die Reihenfolge monoton und lesbar.
  **Gegen einzelne Messjahre** kippt sie: 2003 und 2023 liegen über dem
  Szenario 2060 RCP 8.5, weil ein DRY ein typisches Jahr abbildet und kein
  Extremjahr. Die Spitzentemperatur zeigt die Erwärmung trotzdem: Sie steigt
  auch dort, wo die Stundenzahl fällt. Genau deshalb erscheint der Hinweis nur
  beim Vergleich Messjahr ↔ Szenario, nicht zwischen zwei Szenarien.
- **Verfügbarkeit der Messgrössen** über alle 157 Stationen: Temperatur und
  Feuchte an 149, Globalstrahlung an 132, Diffusstrahlung an 82, langwellige
  Einstrahlung an nur 46. Die dokumentierten Rückfallebenen — Erbs für die
  Diffusstrahlung, Pauschalwert für die Himmelstemperatur — sind damit der
  Normalfall, nicht der Randfall.
- **784 Stationsjahre belegen 138 MB**, im Mittel 172 kB je Stationsjahr.
  Bestätigt die Annahme aus ADR 0003.
- **Derselbe Raum an 130 Stationen, 2023:** Lugano 778 Übertemperaturstunden,
  Zürich/Fluntern 501, Jungfraujoch 0. Der Jahresmittelwert allein erklärt die
  Rangfolge nicht — Vevey (13.4 °C) liegt vor Magadino (13.3 °C) mit 765 zu
  707 Stunden, der Unterschied kommt aus der Einstrahlung.
- **Jahressummen der Einstrahlung** als unabhängiger Anker, Zürich/Fluntern:
  horizontal 1198–1253 kWh/m², Südfassade 979–1033 (Perez), 30° Südneigung
  1403–1476. Die Grössenordnungen decken sich mit publizierten Werten für
  Zürich. Horizontal liefern beide Modelle identische Summen — das muss so
  sein und ist der schärfste Selbsttest.
- **Perez gegen isotrop:** Süd +8 %, Ost/West +4 %, Nord −12 %. Auf die
  Überhitzung wirkt das mit +4 bis +6 % Übertemperaturstunden — das isotrope
  Modell lag auf der optimistischen Seite.
- Wirkung der Himmelsabstrahlung, Südbüro Zürich 2023: beim **Neubau** −9 %
  Übertemperaturstunden und −0.15 K Spitzentemperatur, beim **ungedämmten
  Altbau** −26 %. Der Schritt von „gar nicht" zu „pauschal 11 K" wiegt dabei
  schwerer als der von „pauschal" zu „gemessen" (2–3 %).
- Δθ_sky an Zürich/Fluntern 2023: Mittel 9.78 K, aber Spannweite 1.4 bis
  25.3 K — der Pauschalwert der Norm kann eine bedeckte Nacht nicht von einer
  klaren unterscheiden.

### Validierung
- **Geschlossene Energiebilanz im Beharrungszustand** auf besser als 10⁻⁶ W —
  die schärfste verfügbare Prüfung des Raummodells.
- Sonnenstand gegen astronomisch nachprüfbare Stützstellen für Zürich:
  Mittagshöhe 66.06° / 19.18° an den Wendepunkten, Tageslänge 15.9 h / 8.5 h,
  Kulmination im Süden am wahren Ortsmittag.

- **Frontend** (`web/`) — Regler für Fensterflächenanteil, Sonnenschutz,
  interne Lasten, Nachtlüftung, Bauart und Ausrichtung; Jahresdiagramm mit
  Fadenkreuz und Tooltip; Kennzahlen; Tabelle der überschrittenen Tage;
  «Berechnung anzeigen» mit Verfahren, Version, Parametern, Prüfsumme der
  Eingangsdaten und Berechnungs-Hash. Der Zustand steht im Permalink.
  Kein Framework, keine Diagrammbibliothek.
- `scripts/build-web.sh` — übersetzt `core/src` per `tsc` nach nativem ESM und
  legt die Stationsjahre daneben.
- [ADR 0006](docs/adr/0006-browser-emit.md) und
  [Methode 007](docs/methods/007-visualisierung.md).
- `sky` — **langwellige Abstrahlung gegen den Himmel** nach EN ISO 13790
  §11.3.5. Himmelstemperatur aus der gemessenen Einstrahlung `oli000h0`, sonst
  Pauschalwert 11 K der Norm. Neuer Parameter `skyViewFactor` (0.5 senkrecht).
- `core/scripts/model-effects.ts` — beziffert die Wirkung der
  Modellverfeinerungen an echten Daten; Grundlage für die Zahlen in
  [Methode 005](docs/methods/005-solar.md) und
  [008](docs/methods/008-langwellige-abstrahlung.md).
- **Anisotropes Himmelsmodell nach Perez (1990)** als eigenes Verfahren
  `solar.tiltedIrradiancePerez` — zirkumsolare Aufhellung und
  Horizontaufhellung, Koeffizienten über die Himmelsklarheit ε, Luftmasse nach
  Kasten & Young. Seit `building.simulate5R1C@1.2.0` der Standard;
  `skyModel: "isotrop"` schaltet zurück. Im Frontend wählbar.

- **Alle SwissMetNet-Stationen**: 157 Stationen, 784 Stationsjahre für
  2020–2024, 138 MB. ETL um `--jobs` (parallele Downloads), `--cache-dir` und
  `--quiet` erweitert.
- **Katalog zweistufig**: leichter Index (70 kB statt 680 kB) plus
  `smn/<slug>/index.json` je Station. Siehe
  [ADR 0003, Nachtrag](docs/adr/0003-keine-datenbank.md).
- **Stationsfähigkeiten** im Katalog: `climate`, `moisture`, `roomModel`,
  `measuredDiffuse`, `measuredSky`, abgeleitet aus den vorhandenen Variablen.
  Das Frontend zeigt nur Stationen, an denen das Raummodell rechenbar ist.
- `core/scripts/stations.ts` — derselbe Referenzraum an allen Stationen,
  nach Übertemperaturstunden rangiert.

- **Vollständige Quellenangabe**: `DatasetRef` trägt jetzt `title` und `url`;
  `citations()` baut daraus Autor · Titel · Link · Lizenz. Sowohl CC BY 4.0 als
  auch die opendata.swiss-Stufe `terms_by` verlangen das — ein blosser Name
  genügt beiden nicht. Sichtbar unter «Berechnung anzeigen».
- `core/scripts/catalog.ts` — gemeinsamer Katalogzugriff für alle Skripte.

- **Klimaszenarien** (`data/ocbl_data/dry.py`): die DRY-Datensätze der
  Collection `ch.meteoschweiz.klimaszenarien-raumklima` — 45 Stationen,
  Perioden 2035 und 2060, RCP 2.6 und 8.5, je als Referenzjahr und als
  „1 in 10 warmer Sommer". 270 Szenariojahre, eigener Katalog
  `scenarios.json`, neuer Befehl `python3 -m ocbl_data scenarios`.
- `core/scripts/climate-change.ts` — derselbe Raum gegen die gemessene
  Vergangenheit und gegen beide Zukunftsperioden.
- `TimeAxis.sampleOffsetMin` — ein ausdrücklicher Stichzeitpunkt im Intervall,
  wo die Intervallmitte nicht gemeint ist. Wird im `.ocbl`-Header mitgeführt.
- QA: `check_radiation_decomposition()` prüft `gls = diffus + direkt · sin(h)`
  bei jedem Szenarienbau. Eine zweite, unabhängig getippte Sonnenhöhe in
  Python validiert dabei `core/src/solar.ts` mit.

### Erschlossen
Zwei Konventionen des Szenariendatensatzes stehen in **keiner Metadatendatei**
und mussten empirisch bestimmt werden — Herleitung in
[Methode 009](docs/methods/009-klimaszenarien.md):

- **Der Zeitstempel bezeichnet den Intervallbeginn**, der repräsentative
  Zeitpunkt liegt bei `hh:10`. Das ist die **umgekehrte** Konvention der
  SwissMetNet-Messreihen. Bestimmt über das Minimum des Fehlers von
  `gls − diffus − direkt · sin(h)` über Versätze von −120 bis +120 min:
  scharfes Minimum bei +10 min, an sechs Dateien ausnahmslos, Restfehler
  bis hinunter zu 1.03 W/m².
- **`str.direkt` ist die Direktnormalstrahlung**, nicht die horizontale:
  13.65 gegen 105.17 W/m² mittlerer Fehler.

### Geklärt
- **Die Lizenzfrage zu `ch.meteoschweiz.klimaszenarien-raumklima` ist
  beantwortet.** Der Datensatz steht unter *„Freie Nutzung. Quellenangabe ist
  Pflicht."* — nicht kommerzielle **und** kommerzielle Nutzung erlaubt, Quelle
  verpflichtend. Alle sieben Ressourcen auf opendata.swiss tragen `terms_by`,
  die Datensatzseite zeigt es als Abzeichen.

  Das `proprietary` im STAC-Katalog war **kein Widerspruch**: Im
  STAC-Vokabular bedeutet es nur „keine SPDX-Standardkennung", und der
  Lizenzlink zeigt auf die allgemeinen Bundesbedingungen. Uninformativ, nicht
  einschränkend.

  Damit ist das Zukunftsklima nicht mehr durch eine Lizenzfrage blockiert;
  offen bleibt allein der Publikationsstand von SIA 4028. Siehe
  [ADR 0004, Nachtrag](docs/adr/0004-v0-nur-vergangenheit.md).

### Zu beachten
- **Ein Design Reference Year ist kein Mittel gemessener Jahre.** Der erste
  Vergleich lief gegen 2020–2024 — fünf Jahre mit zwei Rekordsommern — und sah
  dadurch aus wie ein Rechenfehler. Mit der Normalperiode 1991–2020 als Basis
  wird das Bild kohärent.
- **Die beobachtete Erwärmung ist der Projektion vorausgeeilt.** Zürich/
  Fluntern liegt 2021–2024 mit 10.9 °C bereits über dem, was CH2018 für 2035
  unter RCP 8.5 als typisches Jahr ausweist (10.6 °C). Die Referenzjahre sind
  deshalb eher als untere Schranke zu lesen.
- Die Stationshöhen der Szenariometadaten weichen von SwissMetNet ab
  (Zürich/Fluntern 556 m gegen 604 m). Für das Raummodell folgenlos, aber
  notiert.
- Die DRY-Dateien haben 365 Tage; 2060 ist ein Schaltjahr. Die Reihe wird
  deshalb auf das nächste Nicht-Schaltjahr gelegt (2061), damit die
  Datumsangaben und mit ihnen der Sonnenstand nicht verrutschen.

### Geplant
- Seitliche Laibungen; Vordach und Verbauung begrenzter Breite; Reflexion von
  Vordach und Gegenüber ([011](docs/methods/011-vordach.md#grenzen))

### Verfahrensversionen
- `comfort.adaptiveComfortBand` **1.0.0 → 2.0.0**: Signatur und Hash, Werte
  unverändert
- `comfort.exceedanceHours` **1.0.0 → 2.1.0**: 2.0.0 Signatur und Hash, Werte
  unverändert; 2.1.0 rechnet den Vorlauf der Simulation auf die
  Einschwingphase an
- `building.simulate5R1C` **1.2.0 → 1.4.0**: 1.3.0 zyklischer Vorlauf aus dem
  Ende der Reihe, gültige Werte ab der ersten Stunde (ADR 0008); 1.4.0
  Tagstunden ohne Globalstrahlung nicht gerechnet statt mit 0 W/m²
- Unverändert: `comfort.runningMeanOutdoorTemperature` 1.0.0 und alle übrigen
  Verfahren

## [0.1.0] — 2026-08-22

Erste lauffähige Fassung der vollständigen Kette von MeteoSchweiz-OGD bis zum
Kennwert mit Berechnungs-Hash. Kein Frontend, kein Raummodell.

### Hinzugefügt

**Rechenkern (`core/`, TypeScript, ohne Build-Schritt)**
- `provenance` — `Computation<T>`, stabile Serialisierung mit sortierten
  Schlüsseln, Berechnungs-Hash über Verfahren, Version, Parameter und
  Prüfsummen der Eingangsdaten. Ergebniswert und `doc`-Pfad gehen bewusst nicht
  ein.
- `psychro` — Sättigungsdampfdruck nach Magnus/Sonntag, Taupunkt, Feuchtegehalt,
  Enthalpie, absolute Feuchte, Feuchtkugeltemperatur über Bisektion der
  Psychrometergleichung.
- `series` — Zeitachse mit expliziter Intervallkonvention, Intervallmitte für
  Sonnenstände, Lokalzeit als fester Offset ohne Sommerzeit.
- `indicators` — Tagesmittel und -extreme, Sommer- und Hitzetage, Tropennächte,
  Kühlgradstunden, Nachtlüftungspotenzial, gleitendes Aussentemperaturmittel und
  adaptives Komfortband nach EN 16798-1, Übertemperaturstunden.
- `pack` — Leseseite des `.ocbl`-Formats mit Prüfsummenverifikation und
  Erkennung beschädigter Dateien.
- `scripts/report.ts` — Kennwerttabelle je Station mit Berechnungs-Hash.

**ETL (`data/`, Python, nur Standardbibliothek)**
- STAC-Abfrage von `data.geo.admin.ch`, Downloads mit Plattencache.
- Stationsverzeichnis aus `ogd-smn_meta_stations.csv` (157 Stationen).
- Stundendateien: Dekaden- und `recent`-File werden zusammengesetzt, späteres
  File gewinnt.
- 13 Variablen mit Gültigkeitsbereich; `_self_check()` prüft beim Import, dass
  die Int16-Skalierung den Bereich trägt.
- `.ocbl`-Schreibseite, Katalog mit SHA-256 und Vollständigkeit je Stationsjahr.
- CLI: `stations`, `build`, `verify`.
- QA: Taupunkt-Kreuzvergleich gegen `tde200h0` mit zweiter, unabhängig
  getippter Fassung der Formeln.

**Dokumentation**
- Fünf Methodenseiten: Zeitkonventionen, Feuchte Luft, Hitzekennwerte,
  adaptiver Komfort, Binärformat.
- `docs/methods/sources.md` mit allen Zitierschlüsseln, Datenlizenzen und den
  offenen Lizenzfragen.
- Fünf ADRs mit Begründung und verworfenen Alternativen.
- README, CONTRIBUTING, CLAUDE.md, CI mit Typprüfung und echtem
  Integrationslauf.
- `scripts/check-references.sh` — prüft, dass jeder `MethodRef.doc` auf eine
  existierende Überschrift zeigt und jeder `sources`-Schlüssel in
  `docs/methods/sources.md` aufgelöst ist.

### Behoben
- Zwei `MethodRef.doc`-Verweise zeigten auf nicht existierende Überschriften
  (`#spezifische-enthalpie`, `#hitze--und-sommertage`), gefunden vom neuen
  Prüfskript. Da `doc` nicht in den Berechnungs-Hash eingeht, brechen dadurch
  keine Permalinks und es war kein Versionssprung nötig.

### Entschieden
- Kern offen unter **Apache-2.0** ([0001](docs/adr/0001-open-source-apache-2.md))
- Rechenkern in **TypeScript**, ETL in Python ([0002](docs/adr/0002-rechenkern-in-typescript.md))
- **Keine Datenbank** im heissen Pfad ([0003](docs/adr/0003-keine-datenbank.md))
- v0 rechnet **nur Vergangenheit** ([0004](docs/adr/0004-v0-nur-vergangenheit.md))
- Klimaachse als **Erwärmungsniveau**, nicht als Jahreszahl
  ([0005](docs/adr/0005-globale-erwaermungsniveaus.md))

### Validierung
- Taupunkt-Kreuzvergleich Zürich/Fluntern 2023, 8760 Stunden: mittlere
  Abweichung **+0.002 K**, maximal 0.434 K, 100 % innerhalb 0.5 K. Die
  Reststreuung entspricht der Publikationsrundung.
- Feuchtkugeltemperatur gegen Stützstellen des h,x-Diagramms; über den gesamten
  Bereich ist $T_d \le T_w \le T$ geprüft.
- 42 Tests grün, `tsc --noEmit` sauber im strict-Modus.

### Gemessen
- Ein Stationsjahr mit elf Variablen: **189.4 kB** (Zürich/Fluntern 2023).
  Bestätigt die Architektur ohne Datenbank.

### Bekannte Einschränkungen
- `exceedanceHours()` ist implementiert und geprüft, aber ohne Raummodell nicht
  produktiv nutzbar — sie verlangt eine Raumtemperaturreihe.
- SIA 180 hat eigene Grenzkurven; umgesetzt ist vorerst nur EN 16798-1.
- Diffusstrahlung `ods000h0` wird nicht an allen Stationen gemessen — bei
  Zürich/Fluntern fehlt sie vollständig.
- Ältere Jahrgänge führen `prestah0` und `tde200h0` teils nicht; die
  Rückfallebene über die Stationshöhe ist dokumentiert.

### Verfahrensversionen
Alle Verfahren starten bei `1.0.0`:
`psychro.saturationVapourPressure`, `psychro.wetBulbTemperature`,
`psychro.specificEnthalpy`, `indicator.tropicalNights`,
`indicator.thresholdDays`, `indicator.coolingDegreeHours`,
`indicator.nightVentilationPotential`,
`comfort.runningMeanOutdoorTemperature`, `comfort.adaptiveComfortBand`,
`comfort.exceedanceHours`.

Neu in Unveröffentlicht bei `1.0.0`: `solar.position`,
`solar.diffuseFraction`, `solar.tiltedIrradiance`, `sky.temperature`.

Neu bei `1.0.0`: `solar.tiltedIrradiancePerez`.

**`building.simulate5R1C` steht bei `1.2.0`, `solar.tiltedIrradiance` bei
`1.0.1`.**

Das Frontend führt keine eigenen Verfahren: Es ruft denselben Rechenkern auf
und zeigt dessen `MethodRef` an. Ein Versionssprung dort schlägt unmittelbar
auf die angezeigten Hashes durch.

`.ocbl`-Formatversion: **1**.
