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

  return (
    <main>
      <nav><a href={back}>← {locale === "de" ? "Zurück" : "Back"}</a></nav>
      <h1>{title}</h1>
      {desc && <p className="lead">{desc}</p>}
      <section>
        <h2>{locale === "de" ? "Details" : "Details"}</h2>
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
