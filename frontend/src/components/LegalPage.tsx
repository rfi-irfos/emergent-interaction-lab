interface LegalPageProps {
  slug: string
  brand?: string
  email?: string
  phone?: string
  address?: string
}

export function LegalPage({ slug, brand, email, phone, address }: LegalPageProps) {
  const displayBrand = brand ?? 'Ihr Unternehmen'

  return (
    <div className="static-page">
      <header className="static-page-nav">
        <a href="#" className="static-page-brand">{displayBrand}</a>
        <a href="#" onClick={e => { e.preventDefault(); window.history.back() }} className="static-page-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Zurück
        </a>
      </header>
      <main className="static-page-main">
        <div className="static-page-content">
          {slug === 'impressum' && <ImpressumContent brand={displayBrand} email={email} phone={phone} address={address} />}
          {slug === 'datenschutz' && <DatenschutzContent email={email} />}
          {slug === 'agb' && <AgbContent brand={displayBrand} />}
          {slug !== 'impressum' && slug !== 'datenschutz' && slug !== 'agb' && (
            <p style={{ color: 'var(--muted, #888)', marginTop: '2rem' }}>Diese Seite konnte nicht gefunden werden.</p>
          )}
        </div>
      </main>
    </div>
  )
}

// Ported 1:1 from rfi-irfos.com's own Impressum/Datenschutz (RFI-IRFOS is
// the Medieninhaber of this site — the legally responsible publisher under
// § 25 Mediengesetz — the same registration facts apply here as there, only
// the hosting/processor details differ since this app runs its own Fly
// backend + tracking pixel instead of rfi-irfos-web's stack). `brand`/
// `email`/`phone`/`address` stay as props (from content.json, currently
// unset) for a project-facing contact line; the registered legal details
// below are RFI-IRFOS's real, checkable registry data, not fabricated.
function ImpressumContent({ brand, email, phone, address }: { brand: string; email?: string; phone?: string; address?: string }) {
  return (
    <>
      <h1>Impressum</h1>
      <p><strong>Angaben gemäß § 5 ECG</strong></p>

      <h2>Medieninhaber &amp; Diensteanbieter</h2>
      <p>
        <strong>Research Focus Institute — Interdisciplinary Research Facility for Open Sciences</strong><br />
        Kurzbezeichnung: RFI-IRFOS<br />
        Elisabethinergasse 25/10, 8020 Graz, Österreich<br />
        E-Mail: <a href="mailto:rfi.irfos@gmail.com">rfi.irfos@gmail.com</a><br />
        Website: <a href="https://rfi-irfos.com" target="_blank" rel="noopener">rfi-irfos.com</a>
      </p>

      <h2>Über dieses Projekt</h2>
      <p>
        <strong>{brand}</strong> ist ein Forschungsprojekt von Laura Serna Gaviria; RFI-IRFOS ist gemäß § 25 Mediengesetz Medieninhaber und Betreiber dieser Website.
        {(email || phone || address) && <> Projektbezogene Anfragen:</>}
      </p>
      {address && <p>{address}</p>}
      {phone && <p>Tel: <a href={`tel:${phone.replace(/\s/g, '')}`}>{phone}</a></p>}
      {email && <p>E-Mail: <a href={`mailto:${email}`}>{email}</a></p>}

      <h2>Register- &amp; Gewerbedaten</h2>
      <p>
        Rechtsform: Eingetragener Verein (Non-Profit, gemeinnützig geregelt)<br />
        ZVR-Zahl: 1015608684<br />
        GISA-Zahl (Gewerberegister): 39261441<br />
        GLN: 9110038490191<br />
        UID: ATU83405245<br />
        Steuernummer: 68 696/8736<br />
        Gewerbe: Dienstleistungen in der automatischen Datenverarbeitung und Informationstechnik<br />
        Anzuwendende Rechtsvorschrift: Gewerbeordnung (GewO) · Mitglied der WKO<br />
        Behörde gemäß § 5 Abs 1 Z 5 ECG: Magistrat der Stadt Graz
      </p>

      <h2>Gewerberechtliche Geschäftsführung</h2>
      <p>Simeon-Andreas Johann Manfred Kepp, verantwortlich gemäß GewO für die oben genannte Tätigkeit.</p>

      <h2>Hinweis gemäß EU-Verordnung 524/2013 (OS)</h2>
      <p>
        Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung bereit: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener">ec.europa.eu/consumers/odr</a>.<br />
        Wir sind zur Teilnahme an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle weder verpflichtet noch bereit, da ausschließlich mit Unternehmern kontrahiert wird (siehe AGB).
      </p>

      <h2>Haftungsausschluss</h2>
      <p>Die Inhalte dieser Website wurden mit größter Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte kann jedoch keine Gewähr übernommen werden. Für verlinkte externe Inhalte sind wir nicht verantwortlich, sobald die Seite verlassen wird.</p>

      <h2>Namensnennungen &amp; Marken</h2>
      <p>Auf dieser Website genannte Firmennamen, Produktnamen und Marken gehören den jeweiligen Inhabern. Ihre Nennung dient der inhaltlichen Einordnung und impliziert keine Befürwortung oder Partnerschaft.</p>

      <h2>Urheberrecht</h2>
      <p>Die durch den Seitenbetreiber erstellten Inhalte und Werke auf dieser Website unterliegen dem österreichischen Urheberrecht. Vervielfältigung oder Nutzung über die Grenzen des Urheberrechts hinaus bedarf der schriftlichen Zustimmung.</p>

      <h2>Anwendbares Recht</h2>
      <p>Es gilt das Recht der Republik Österreich sowie das Recht der Europäischen Union.</p>
    </>
  )
}

function DatenschutzContent({ email }: { email?: string }) {
  return (
    <>
      <h1>Datenschutzerklärung</h1>
      <p><strong>Gemäß DSGVO (EU) 2016/679</strong></p>

      <h2>Verantwortlicher</h2>
      <p>
        RFI-IRFOS (Research Focus Institute — Interdisciplinary Research Facility for Open Sciences)<br />
        Elisabethinergasse 25/10, 8020 Graz, Österreich<br />
        E-Mail: <a href="mailto:rfi.irfos@gmail.com">rfi.irfos@gmail.com</a>
        {email && <> · Projektkontakt: <a href={`mailto:${email}`}>{email}</a></>}
      </p>

      <h2>Erhobene Daten</h2>
      <p>
        <strong>Server-Logs:</strong> IP-Adresse, Zugriffszeitpunkt, URL, HTTP-Statuscode — erhoben durch Fly.io (Superfly, Inc., USA) und, für die statische Spiegel-Version dieser Seite, GitHub Pages (GitHub, Inc., USA), als unvermeidbare Folge jeder Anfrage an einen Webserver.<br />
        <strong>Kontaktformular:</strong> Name, E-Mail, Nachricht — übermittelt via Web3Forms (<a href="https://web3forms.com/privacy" target="_blank" rel="noopener">web3forms.com/privacy</a>), nur bei aktiver Übermittlung durch Sie.<br />
        <strong>Zahlungsdaten:</strong> Für Käufe über diese Website werden Zahlungsdaten (Kartendaten, E-Mail, Name) von <strong>Stripe, Inc.</strong> (354 Oyster Point Blvd, South San Francisco, CA 94080, USA) verarbeitet. Kartendaten erhalten oder speichern wir zu keinem Zeitpunkt selbst.<br />
        <strong>Besuchsstatistik:</strong> ein selbst gehosteter Tracking-Pixel (Endpoint dieser Anwendung, nicht Dritte) protokolliert Seitenaufruf, verweisende Quelle (utm-Parameter bzw. Referrer, auf eine grobe Kanal-Kategorie normalisiert) und eine zufällige, in <code>localStorage</code> gespeicherte Kennung ohne Personenbezug — keine IP-Speicherung in dieser Tabelle, keine geräteübergreifende Zuordnung.
      </p>
      <p>
        <strong>Was wir nicht erheben:</strong> keine Standortdaten, kein Device-Fingerprinting, keine Werbe-ID, keine biometrischen Daten, kein Datenverkauf oder -weitergabe an Datenhändler oder Werbenetzwerke — auf dieser Website läuft keine Werbung.
      </p>
      <p>
        <strong>Einordnung von Fall-/Projektdaten:</strong> Unterlagen, die Sie im Rahmen einer Case-Intelligence- oder Systemaudit-Leistung einreichen, werden nicht als generische Unternehmensdaten verarbeitet. Sie fließen in Laura Serna Gavirias Forschung zu Emergent Interaction ein — durch ihre eigene methodische Brille analysiert, um daraus passgenaue Frameworks und Agenten abzuleiten, nicht als anonyme Datenpunkte in einem allgemeinen Firmendatensatz.
      </p>

      <h2>Rechtsgrundlage</h2>
      <p>
        Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO): Zahlungsabwicklung, Kontaktanfragen.<br />
        Berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO): Server-Logs zur Sicherheits- und Fehleranalyse, anonymisierte Seitenaufruf-Statistik.
      </p>

      <h2>Auftragsverarbeiter</h2>
      <p>
        <strong>Stripe, Inc.</strong> — Zahlungsabwicklung. Auftragsverarbeitungsvertrag (Art. 28 DSGVO). Datenübermittlung in die USA auf Basis von Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO).<br />
        <strong>Superfly, Inc. (Fly.io)</strong> — Backend-/API-Hosting inklusive Tracking-Pixel. Datenübermittlung in die USA auf Basis von Standardvertragsklauseln.<br />
        <strong>GitHub, Inc.</strong> — Hosting der statischen Spiegel-Version dieser Seite. Datenübermittlung in die USA auf Basis von Standardvertragsklauseln.<br />
        <strong>Web3Forms</strong> — Zustellung des Kontaktformulars, nur bei aktiver Übermittlung durch Sie.
      </p>

      <h2>Internationale Datenübermittlung</h2>
      <p>Wo ein oben genannter Auftragsverarbeiter in den USA sitzt, erfolgt die Übermittlung auf Basis von Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO), nicht auf Basis eines Angemessenheitsbeschlusses.</p>

      <h2>Cookies</h2>
      <p>
        Diese Website verwendet <strong>keine Cookies</strong>. Theme- und Sprachauswahl werden in <code>localStorage</code> gespeichert (verlässt Ihr Gerät nicht, trägt keine Kennung, ist für uns nicht auslesbar). Der oben beschriebene Tracking-Pixel setzt und liest kein Cookie — die Einwilligungspflicht nach Art. 5 Abs. 3 ePrivacy-Richtlinie greift nur beim Speichern oder Auslesen auf Ihrem Endgerät, was hier nicht geschieht.
      </p>

      <h2>Automatisierte Entscheidungsfindung</h2>
      <p>Es findet kein Profiling und keine automatisierte Entscheidungsfindung mit rechtlicher oder ähnlich erheblicher Wirkung statt.</p>

      <h2>Speicherdauer</h2>
      <p>Kontaktanfragen werden nach Abschluss der Kommunikation, spätestens nach 7 Jahren, gelöscht. Zahlungsbelege werden gemäß § 132 BAO 7 Jahre aufbewahrt. Server-Logs und Pixel-Daten werden nur so lange gespeichert, wie es für Sicherheits- und Traffic-Analyse nötig ist.</p>

      <h2>Kinder</h2>
      <p>Dies ist ein B2B-Forschungs- und Dienstleistungsangebot, nicht an Kinder gerichtet; es werden wissentlich keine Daten von Personen unter dem nach Art. 8 DSGVO erforderlichen Einwilligungsalter erhoben.</p>

      <h2>Ihre Rechte (Art. 15–21 DSGVO)</h2>
      <p>Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch — wenden Sie sich dazu an <a href="mailto:rfi.irfos@gmail.com">rfi.irfos@gmail.com</a>.</p>

      <h2>Beschwerderecht</h2>
      <p>Sie haben das Recht, eine Beschwerde bei der <a href="https://www.dsb.gv.at" target="_blank" rel="noopener">Österreichischen Datenschutzbehörde</a> einzureichen.</p>

      <h2>Änderungen dieser Erklärung</h2>
      <p>Änderungen an der tatsächlichen Datenerhebung werden hier zuerst nachgeführt, mit vorgezogenem Stand-Datum.</p>
    </>
  )
}

function AgbContent({ brand }: { brand: string }) {
  return (
    <>
      <h1>Allgemeine Geschäftsbedingungen</h1>
      <h2>1. Geltungsbereich - nur für Unternehmer (B2B)</h2>
      <p>
        Diese Allgemeinen Geschäftsbedingungen gelten für alle Leistungen von <strong>{brand}</strong>, insbesondere die über diese Website als Payment Link angebotenen Case-Intelligence-, Framework- und Systemleistungen.<br /><br />
        Dieses Angebot richtet sich <strong>ausschließlich an Unternehmer</strong> im Sinne des § 1(2) Konsumentenschutzgesetz (KSchG). Verträge mit Verbrauchern im Sinne des KSchG sind ausgeschlossen. Mit der Bestellung bestätigt der Kunde, im Rahmen seiner gewerblichen oder beruflichen Tätigkeit zu handeln.
      </p>
      <h2>2. Leistungserbringung</h2>
      <p>Die konkreten Leistungen, Preise und Konditionen sind auf dieser Website beschrieben, richten sich im Detail aber nach dem tatsächlich bestellten Produkt. Website-Beschreibungen und Preisangaben sind indikativ; der genaue Leistungsumfang ergibt sich aus dem jeweils bestellten Angebot.</p>
      <h2>3. Zahlung</h2>
      <p>
        Preise verstehen sich in Euro. Die Zahlung erfolgt <strong>vollständig im Voraus</strong>, vor Leistungsbeginn, ausschließlich über die auf dieser Website angebotene Zahlungsmethode (Stripe).<br /><br />
        Die Leistungserbringung beginnt <strong>unmittelbar</strong> nach Zahlungseingang. Der Kunde stimmt diesem sofortigen Beginn ausdrücklich zu. Ein Widerrufsrecht besteht dementsprechend nicht (§ 18(1)(1) Fern- und Auswärtsgeschäfte-Gesetz, FAGG). Eine Stornierung oder Rückerstattung nach Zahlungseingang ist ausgeschlossen.
      </p>
      <h2>4. Haftung</h2>
      <p>Die Haftung beschränkt sich auf Vorsatz und grobe Fahrlässigkeit.</p>
      <h2>5. Anwendbares Recht</h2>
      <p>Es gilt österreichisches Recht. Gerichtsstand ist der Sitz des Unternehmens.</p>
    </>
  )
}
