import { useEffect, useState } from "react";
import { useLang } from "./hooks/useLang";

const SECTIONS = [
  { key: "research_programs", labelEn: "Research Programs", labelDe: "Forschungsprogramme", route: "research" },
  { key: "frameworks", labelEn: "Frameworks", labelDe: "Frameworks", route: "frameworks" },
  { key: "systems", labelEn: "Systems", labelDe: "Systeme", route: "systems" },
  { key: "methods", labelEn: "Methods", labelDe: "Methoden", route: "methods" },
  { key: "case_studies", labelEn: "Evidence", labelDe: "Evidenz", route: "evidence" },
  { key: "publications", labelEn: "Publications", labelDe: "Publikationen", route: "publications" },
  { key: "datasets", labelEn: "Datasets", labelDe: "Datensätze", route: "datasets" },
  { key: "profiles", labelEn: "Laura", labelDe: "Laura", route: "laura" },
];

function useRoute() {
  const [route, setRoute] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return route;
}

function parseRoute(path: string) {
  const m = path.match(/^\/(en|de)\/([a-z]+)\/([^/]+)\/?$/);
  if (m) return { locale: m[1], type: m[2], slug: m[3] };
  const locale = path.startsWith("/de") ? "de" : "en";
  return { locale, type: path === "/" ? "home" : "unknown", slug: null };
}

function field(entity: any, locale: string, field: string) {
  return entity[`${field}_${locale}`] || entity[field] || "";
}

function metaRow(label: string, value: string | null | undefined) {
  if (!value) return null;
  return (
    <div className="meta-row" key={label}>
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
}

function EntityView({ data, locale, type, slug }: { data: any; locale: string; type: string; slug: string | null }) {
  const map: Record<string, string> = {
    research: "research_programs",
    evidence: "case_studies",
    publications: "publications",
    frameworks: "frameworks",
    systems: "systems",
    methods: "methods",
    datasets: "datasets",
    laura: "profiles",
  };
  const key = map[type];
  if (!key) return <p>Not found</p>;
  const items = data[key] || [];
  const item = items.find((e: any) => e.slug === slug);
  if (!item) return <p>Not found</p>;

  const title = field(item, locale, "title") || field(item, locale, "name");
  const desc = field(item, locale, "description") || field(item, locale, "abstract") || field(item, locale, "bio");
  const back = `/${locale}/`;

  const related: string[] = [];
  for (const s of SECTIONS) {
    for (const e of (data[s.key] || [])) {
      if (e.slug === item.slug) continue;
      const t = e[`title_${locale}`] || e[`name_${locale}`] || e.title_en || e.name_en;
      if (t) related.push(`/${locale}/${s.route}/${e.slug}/`);
    }
  }

  let details: React.ReactNode = null;
  if (type === "research") {
    details = (
      <>
        {metaRow(locale === "de" ? "Kernfrage" : "Core Question", field(item, locale, "core_question"))}
        {metaRow(locale === "de" ? "Status" : "Status", item.status)}
        {metaRow(locale === "de" ? "Reife" : "Maturity", item.maturity)}
        {metaRow(locale === "de" ? "Lebenszyklus" : "Lifecycle", item.lifecycle)}
        {metaRow(locale === "de" ? "Kontext" : "Context", item.research_context)}
        {metaRow(locale === "de" ? "Typ" : "Type", item.program_type)}
      </>
    );
  } else if (type === "evidence") {
    details = (
      <>
        {metaRow(locale === "de" ? "Systemklasse" : "System Class", item.system_class)}
        {metaRow(locale === "de" ? "Frage" : "Claim or Question", field(item, locale, "claim_or_question"))}
        {metaRow(locale === "de" ? "Verfügbare Signale" : "Available Signals", field(item, locale, "available_signals"))}
        {metaRow(locale === "de" ? "Epistemischer Status" : "Epistemic Status", item.epistemic_status)}
        {metaRow(locale === "de" ? "Zugang" : "Evidence Access", item.evidence_access)}
        {metaRow(locale === "de" ? "Limitationen" : "Limitations", field(item, locale, "limitations"))}
        {metaRow(locale === "de" ? "Negative Evidenz" : "Negative Evidence", item.negative_evidence ? "✓" : null)}
      </>
    );
  } else if (type === "publications") {
    details = (
      <>
        {metaRow(locale === "de" ? "Typ" : "Type", item.publication_type)}
        {metaRow(locale === "de" ? "Status" : "Status", item.publication_status)}
        {metaRow("DOI", item.doi ? `https://doi.org/${item.doi}` : null)}
        {metaRow(locale === "de" ? "Veröffentlicht" : "Published", item.published ? (locale === "de" ? "Ja" : "Yes") : (locale === "de" ? "Nein" : "No"))}
        {metaRow(locale === "de" ? "Datum" : "Date", item.publication_date)}
        {metaRow(locale === "de" ? "URL" : "URL", item.url)}
        {metaRow(locale === "de" ? "Zitierformat" : "Citation", item.citation)}
        {metaRow(locale === "de" ? "Version" : "Version", item.publication_version)}
      </>
    );
  } else if (type === "frameworks") {
    details = (
      <>
        {metaRow(locale === "de" ? "Typ" : "Type", item.framework_type)}
        {metaRow(locale === "de" ? "Status" : "Status", item.status)}
        {metaRow(locale === "de" ? "Reife" : "Maturity", item.maturity)}
        {metaRow(locale === "de" ? "Lebenszyklus" : "Lifecycle", item.lifecycle)}
        {metaRow(locale === "de" ? "Publiziert" : "Published", item.published ? (locale === "de" ? "Ja" : "Yes") : (locale === "de" ? "Nein" : "No"))}
        {metaRow(locale === "de" ? "Operationalisiert" : "Operationalized", item.operationalized ? (locale === "de" ? "Ja" : "Yes") : (locale === "de" ? "Nein" : "No"))}
        {metaRow(locale === "de" ? "In Fällen verwendet" : "Used in Cases", item.used_in_cases ? (locale === "de" ? "Ja" : "Yes") : (locale === "de" ? "Nein" : "No"))}
        {metaRow(locale === "de" ? "Evaluiert" : "Evaluated", item.evaluated ? (locale === "de" ? "Ja" : "Yes") : (locale === "de" ? "Nein" : "No"))}
        {metaRow(locale === "de" ? "Version" : "Version", item.version)}
      </>
    );
  } else if (type === "systems") {
    details = (
      <>
        {metaRow(locale === "de" ? "Klasse" : "Class", item.system_class)}
        {metaRow(locale === "de" ? "Rolle" : "Laura Role", item.laura_role)}
        {metaRow(locale === "de" ? "Realisierung" : "Technical Realization", item.technical_realization)}
        {metaRow(locale === "de" ? "Realisierungsstand" : "Realization Stage", item.realization_stage)}
        {metaRow(locale === "de" ? "Lebenszyklus" : "Lifecycle", item.lifecycle)}
        {metaRow(locale === "de" ? "Kontext" : "Research Context", item.research_context)}
        {metaRow(locale === "de" ? "Status" : "Status", item.status)}
        {metaRow(locale === "de" ? "Version" : "Version", item.version)}
      </>
    );
  } else if (type === "methods") {
    details = (
      <>
        {metaRow(locale === "de" ? "Status" : "Status", item.status)}
        {metaRow(locale === "de" ? "Reife" : "Maturity", item.maturity)}
        {metaRow(locale === "de" ? "Lebenszyklus" : "Lifecycle", item.lifecycle)}
        {metaRow(locale === "de" ? "Version" : "Version", item.version)}
      </>
    );
  } else if (type === "datasets") {
    details = (
      <>
        {metaRow(locale === "de" ? "Zugang" : "Access", item.access)}
        {metaRow(locale === "de" ? "Herkunft" : "Provenance", field(item, locale, "provenance"))}
        {metaRow(locale === "de" ? "Typ" : "Data Type", item.data_type)}
        {metaRow(locale === "de" ? "Methode" : "Collection Method", item.collection_method)}
        {metaRow(locale === "de" ? "Analyseeinheit" : "Unit of Analysis", item.unit_of_analysis)}
        {metaRow(locale === "de" ? "Zeitraum" : "Time Range", item.time_range)}
        {metaRow(locale === "de" ? "Größe" : "Size", item.size)}
        {metaRow(locale === "de" ? "Methodik" : "Methodology", item.methodology)}
        {metaRow(locale === "de" ? "Anonymisierung" : "Anonymization", item.anonymization)}
        {metaRow(locale === "de" ? "Repository" : "Repository", item.repository)}
        {metaRow(locale === "de" ? "Limitationen" : "Limitations", field(item, locale, "limitations"))}
        {metaRow(locale === "de" ? "Version" : "Version", item.version)}
      </>
    );
  } else if (type === "laura") {
    details = (
      <>
        {metaRow(locale === "de" ? "Rolle" : "Role", item.role)}
        {metaRow(locale === "de" ? "Öffentliche Rolle" : "Public Role", field(item, locale, "public_role"))}
        {metaRow(locale === "de" ? "Status" : "Status", item.status)}
      </>
    );
  }

  return (
    <main>
      <nav><a href={back}>← {locale === "de" ? "Zurück" : "Back"}</a></nav>
      <h1>{title}</h1>
      {desc && <p className="lead">{desc}</p>}
      {details && <section className="meta"><h2>{locale === "de" ? "Details" : "Details"}</h2>{details}</section>}
      {related.length ? (
        <section>
          <h2>{locale === "de" ? "Verwandt" : "Related"}</h2>
          <ul>
            {related.slice(0, 12).map((href, idx) => (
              <li key={idx}><a href={href}>{href.split("/").filter(Boolean).pop()?.replace(/-/g, " ")}</a></li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h2>{locale === "de" ? "Rohdaten" : "Raw"}</h2>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "system-ui" }}>
          {JSON.stringify(item, null, 2)}
        </pre>
      </section>
    </main>
  );
}

function Home({ data, locale }: { data: any; locale: string }) {
  return (
    <main>
      <h1>Emergent Interaction Lab</h1>
      <p className="claim">Different systems. Same analytical core.</p>
      {SECTIONS.map((s) => {
        const items = data[s.key] || [];
        if (!items.length) return null;
        const label = locale === "de" ? s.labelDe : s.labelEn;
        return (
          <section key={s.key}>
            <h2>{label}</h2>
            <ul>
              {items.map((e: any) => {
                const title = e[`title_${locale}`] || e[`name_${locale}`] || e.title_en || e.name_en;
                return (
                  <li key={e.id}>
                    <a href={`/${locale}/${s.route}/${e.slug}/`}>{title}</a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <nav>
        <a href="/en/">English</a> · <a href="/de/">Deutsch</a>
      </nav>
    </main>
  );
}

export default function App() {
  const route = useRoute();
  const { lang } = useLang();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/index.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({}));
  }, []);

  if (!data) return <div>Loading…</div>;
  const r = parseRoute(route);
  const locale = r.locale || lang || "en";

  if (r.type === "home") return <Home data={data} locale={locale} />;
  if (r.type === "unknown") return <main><h1>404</h1><nav><a href="/en/">English</a> · <a href="/de/">Deutsch</a></nav></main>;
  return <EntityView data={data} locale={locale} type={r.type} slug={r.slug} />;
}
